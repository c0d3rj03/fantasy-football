/**
 * Parses an MFL commissioner setup page (csetup?C=...) into the exact field list
 * a browser would submit, so a script can change a few fields and POST the rest
 * back unchanged. MFL csetup forms hold many settings each; posting only the
 * changed fields could reset the others.
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
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) || [];
  const form = forms.find(f => (f.match(/<input\b[^>]*>/gi) || []).some(t => attr(t, 'name') === 'C' && attr(t, 'value') === c));
  if (!form) {
    throw new Error(`csetup C=${c}: form not found (not in commissioner mode?).`);
  }

  const fields = [];
  const checkboxValues = {};
  const selectOptions = {};
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
      if (type === 'checkbox' || type === 'radio') {
        if (type === 'checkbox') checkboxValues[name] = value ?? 'on';
        if (attr(openTag, 'checked') !== undefined) fields.push([name, value ?? 'on']);
      } else {
        fields.push([name, value ?? '']);
      }
    }
  }
  return { fields, checkboxValues, selectOptions };
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
