/**
 * Parses an MFL commissioner setup page (csetup?C=... or options?O=...) into the
 * exact field list a browser would submit, so a script can change a few fields
 * and POST the rest back unchanged. MFL csetup forms hold many settings each;
 * posting only the changed fields could reset the others.
 * Shared by every league: nothing here knows a league ID.
 */

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// Attribute value, '' for a bare attribute, or undefined if absent.
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?(?=[\\s/>])`, 'i'));
  if (!m) return undefined;
  const raw = m[1] ?? m[2] ?? m[3] ?? '';
  return decodeEntities(raw);
}

/**
 * Returns { fields: [[name, value], ...], checkboxValues: {name: value},
 * selectOptions: {name: [values]} } for the
 * form whose hidden C field equals c. fields are in page order and include only
 * what a browser sends: checked boxes/radios, each select's selected option, and
 * the submit button.
 */
export function parseCsetupForm(html, c) {
  return parseMflForm(html, form => (form.match(/<input\b[^>]*>/gi) || []).some(t => attr(t, 'name') === 'C' && attr(t, 'value') === c), `csetup C=${c}`);
}

/**
 * Same as parseCsetupForm for the first form where matches(formHtml) is true.
 * Also returns the form's action (absolute or relative URL, '' if none), its
 * enctype, and submits: every submit button as [name, value]. A browser sends
 * only the button that was clicked, so fields holds just the first one (some
 * MFL forms also have a "Delete Selected" button).
 */
export function parseMflForm(html, matches, label = 'MFL form') {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) || [];
  const form = forms.find(matches);
  if (!form) {
    throw new Error(`${label}: form not found (not in commissioner mode?).`);
  }

  const fields = [];
  const checkboxValues = {};
  const selectOptions = {};
  const submits = [];
  const controls = /<input\b[^>]*>|<select\b[^>]*>[\s\S]*?<\/select>|<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi;
  for (const control of form.match(controls) || []) {
    const openTag = control.match(/^<\w+\b[^>]*>/)[0];
    const name = attr(openTag, 'name');
    if (!name || attr(openTag, 'disabled') !== undefined) continue;
    const kind = openTag.match(/^<(\w+)/)[1].toLowerCase();

    if (kind === 'select') {
      const options = control.match(/<option\b[^>]*>[^<]*/gi) || [];
      selectOptions[name] = options.map(o => {
        const optTag = o.match(/^<option\b[^>]*>/i)[0];
        return attr(optTag, 'value') ?? decodeEntities(o.slice(optTag.length)).trim();
      });
      const chosen = options.filter(o => attr(o.match(/^<option\b[^>]*>/i)[0], 'selected') !== undefined);
      for (const option of (chosen.length ? chosen : options.slice(0, 1))) {
        const optTag = option.match(/^<option\b[^>]*>/i)[0];
        fields.push([name, attr(optTag, 'value') ?? decodeEntities(option.slice(optTag.length)).trim()]);
      }
    } else if (kind === 'textarea') {
      fields.push([name, decodeEntities(control.replace(/^<textarea\b[^>]*>/i, '').replace(/<\/textarea>$/i, ''))]);
    } else {
      const type = (attr(openTag, 'type') || 'text').toLowerCase();
      if (['button', 'reset', 'image', 'file'].includes(type)) continue;
      const value = attr(openTag, 'value');
      if (type === 'submit') {
        submits.push([name, value ?? '']);
        if (submits.length === 1) fields.push([name, value ?? '']);
      } else if (type === 'checkbox' || type === 'radio') {
        if (type === 'checkbox') checkboxValues[name] = value ?? 'on';
        if (attr(openTag, 'checked') !== undefined) fields.push([name, value ?? 'on']);
      } else {
        fields.push([name, value ?? '']);
      }
    }
  }
  const formTag = form.match(/^<form\b[^>]*>/i)[0];
  const action = attr(formTag, 'action') ?? '';
  const enctype = (attr(formTag, 'enctype') ?? '').toLowerCase();
  return { fields, checkboxValues, selectOptions, submits, action, enctype };
}

/**
 * Lists every form's fields on a page, for --inspect modes that find the field
 * names to automate. Action logs may be public, so emails are masked and
 * password-like fields are skipped.
 */
export function describeForms(html) {
  const mask = v => v.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');
  const out = [];
  for (const form of html.match(/<form\b[\s\S]*?<\/form>/gi) || []) {
    const openTag = form.match(/^<form\b[^>]*>/i)[0];
    out.push(`FORM method=${attr(openTag, 'method') ?? ''} action=${attr(openTag, 'action') ?? ''}${attr(openTag, 'enctype') ? ` enctype=${attr(openTag, 'enctype')}` : ''}`);
    const controls = /<input\b[^>]*>|<select\b[^>]*>[\s\S]*?<\/select>|<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi;
    for (const control of form.match(controls) || []) {
      const tag = control.match(/^<\w+\b[^>]*>/)[0];
      const kind = tag.match(/^<(\w+)/)[1].toLowerCase();
      const name = attr(tag, 'name');
      if (!name || /pass|cookie|token/i.test(name)) continue;
      const type = kind === 'input' ? (attr(tag, 'type') || 'text') : kind;
      let value = attr(tag, 'value') ?? '';
      if (kind === 'select') {
        const options = control.match(/<option\b[^>]*>[^<]*/gi) || [];
        const selected = options.find(o => attr(o.match(/^<option\b[^>]*>/i)[0], 'selected') !== undefined);
        const shown = options.slice(0, 6).map(o => attr(o.match(/^<option\b[^>]*>/i)[0], 'value') ?? '').join('/');
        value = `${selected ? attr(selected.match(/^<option\b[^>]*>/i)[0], 'value') : ''} (${options.length} options: ${shown}${options.length > 6 ? '/…' : ''})`;
      } else if (kind === 'textarea') {
        const text = decodeEntities(control.replace(/^<textarea\b[^>]*>/i, '').replace(/<\/textarea>$/i, ''));
        const lines = text.split(/\r?\n/).filter(Boolean);
        value = `${lines.length} lines, first: ${JSON.stringify(lines[0] ?? '')}, last: ${JSON.stringify(lines[lines.length - 1] ?? '')}`;
      }
      const checked = attr(tag, 'checked') !== undefined ? ' [checked]' : '';
      out.push(`  ${type} ${name} = ${mask(value).slice(0, 120)}${checked}`);
    }
  }
  return out.join('\n') || '  (no forms found: not logged in as commissioner?)';
}

/**
 * Applies changes to a parsed form (returns a new field list).
 * changes: { NAME: 'value' } sets a field (adds it if absent),
 *          { NAME: true } checks a checkbox with its own value,
 *          { NAME: false } unchecks it.
 */
export function applyFormChanges(parsed, changes) {
  const fields = parsed.fields.map(f => [...f]);
  for (const [name, change] of Object.entries(changes)) {
    if (change === false) {
      for (let i = fields.length - 1; i >= 0; i--) if (fields[i][0] === name) fields.splice(i, 1);
      continue;
    }
    if (change === true && parsed.checkboxValues[name] === undefined) {
      throw new Error(`Form has no checkbox named ${name}.`);
    }
    const value = change === true ? parsed.checkboxValues[name] : String(change);
    if (parsed.selectOptions?.[name] && !parsed.selectOptions[name].includes(value)) {
      throw new Error(`${name} has no option "${value}" (options: ${parsed.selectOptions[name].join(', ')}).`);
    }
    const existing = fields.find(f => f[0] === name);
    if (existing) existing[1] = value;
    else fields.push([name, value]);
  }
  return fields;
}

// Changed fields as "NAME old → new" lines (for logs; only fields we set).
export function describeFormChanges(before, after) {
  const get = (list, name) => list.find(f => f[0] === name)?.[1];
  const names = new Set([...before, ...after].map(f => f[0]));
  return [...names]
    .filter(n => get(before, n) !== get(after, n))
    .map(n => `${n} ${get(before, n) ?? '(unset)'} → ${get(after, n) ?? '(unset)'}`);
}
