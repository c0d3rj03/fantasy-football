import querystring from 'querystring';
import { parseCsetupForm, parseMflForm, applyFormChanges, describeFormChanges } from './mfl_csetup_form.js';

const DEFAULT_USER_AGENT = 'MflCommish/1.0 (+https://github.com/c0d3rj03/fantasy-football)';

/**
 * Universal MFL Commissioner API & Web Form Client (shared by every league)
 * Supports standard JSON API imports/exports and authenticated web form POSTs.
 * The league ID, season and host come from the calling league's config.js;
 * this module never defines or defaults them.
 */
export class MflCommishClient {
  constructor(seasonYear, leagueId, host, { userAgent = DEFAULT_USER_AGENT } = {}) {
    if (!seasonYear || !leagueId || !host) {
      throw new Error('MflCommishClient requires seasonYear, leagueId and host (import them from the league config.js).');
    }
    this.seasonYear = seasonYear;
    this.leagueId = leagueId;
    this.host = host;
    this.userAgent = userAgent;
    this.baseUrl = `https://${this.host}/${this.seasonYear}`;
    this.cookie = null;
  }

  /**
   * Log in, capture the MFL_USER_ID session cookie, then switch the session to
   * commissioner mode. Without that switch, csetup pages render with no forms.
   */
  async login(
    username = process.env.MFL_USERNAME,
    password = process.env.MFL_PASSWORD
  ) {
    if (!username || !password) {
      throw new Error('MFL Credentials (MFL_USERNAME, MFL_PASSWORD) are required.');
    }

    const loginUrl = `${this.baseUrl}/login?USERNAME=${encodeURIComponent(username)}&PASSWORD=${encodeURIComponent(password)}&XML=1`;
    const res = await fetch(loginUrl);

    // 1. Try Set-Cookie header, 2. then the XML body if the header wasn't exposed
    let userId = (res.headers.get('set-cookie') || '').match(/MFL_USER_ID=([^;]+)/)?.[1];
    if (!userId) {
      userId = (await res.text()).match(/cookie_value="([^"]+)"/)?.[1];
    }
    if (!userId) {
      throw new Error('MFL Login failed: MFL_USER_ID cookie not returned.');
    }
    this.cookie = `MFL_USER_ID=${userId}`;
    console.log('🔒 MFL user authenticated.');

    // 3. Become commissioner (franchise 0000). MFL answers
    // with redirects that set MFL_IS_COMMISH; follow them by hand to keep every cookie.
    let url = `${this.baseUrl}/logout?L=${this.leagueId}&BECOME=0000`;
    for (let hop = 0; hop < 5 && url; hop++) {
      const step = await fetch(url, {
        headers: { 'Cookie': this.cookie, 'User-Agent': this.userAgent },
        redirect: 'manual'
      });
      this.mergeCookies(step.headers.getSetCookie?.() || []);
      const location = step.headers.get('location');
      url = (step.status >= 300 && step.status < 400 && location) ? new URL(location, url).toString() : null;
    }
    if (this.cookie.includes('MFL_IS_COMMISH')) {
      console.log(`👑 Commissioner mode active (cookies: ${this.cookieNames().join(', ')}).`);
    } else {
      console.warn(`⚠️ No MFL_IS_COMMISH cookie after BECOME=0000 (cookies: ${this.cookieNames().join(', ')}).`);
    }
    return true;
  }

  // Adds or replaces cookies from Set-Cookie headers.
  mergeCookies(setCookies) {
    const jar = new Map(this.cookie.split('; ').map(c => [c.split('=')[0], c]));
    for (const sc of setCookies) {
      const pair = sc.split(';')[0].trim();
      if (pair.includes('=')) jar.set(pair.split('=')[0], pair);
    }
    this.cookie = [...jar.values()].join('; ');
  }

  // Cookie names only (never values), safe to log.
  cookieNames() {
    return (this.cookie || '').split('; ').map(c => c.split('=')[0]);
  }

  /**
   * Universal API Request (Export / Import)
   */
  async apiRequest(command, params = {}, method = 'GET', body = null) {
    const queryParams = new URLSearchParams({
      L: this.leagueId,
      JSON: '1',
      ...params
    }).toString();

    const url = `${this.baseUrl}/${command}?${queryParams}`;

    const headers = {
      'User-Agent': this.userAgent
    };
    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }

    const options = { method, headers };
    if (body) {
      options.body = typeof body === 'string' ? body : querystring.stringify(body);
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const res = await fetch(url, options);
    if (!res.ok) {
      throw new Error(`MFL API Error [${command}]: ${res.status} ${res.statusText}`);
    }
    // Imports can answer in XML even with JSON=1, and report failures with a 200 status.
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      if (/<error/i.test(text)) throw new Error(`MFL API Error [${command} ${params.TYPE || ''}]: ${text.slice(0, 300)}`);
      return { raw: text };
    }
    if (json.error) {
      throw new Error(`MFL API Error [${command} ${params.TYPE || ''}]: ${JSON.stringify(json.error)}`);
    }
    return json;
  }

  /**
   * GET a commissioner page as HTML (read-only). page is 'csetup' or 'options';
   * params are its query (C=..., O=..., VICTORY_POINTS=1, ...), L is added.
   */
  async fetchPage(page, params = {}) {
    if (!this.cookie) {
      await this.login();
    }
    const query = new URLSearchParams({ L: this.leagueId, ...params }).toString();
    const res = await fetch(`${this.baseUrl}/${page}?${query}`, {
      headers: {
        'Cookie': this.cookie,
        'User-Agent': this.userAgent
      }
    });
    if (!res.ok) {
      throw new Error(`MFL ${page} error [${query}]: ${res.status} ${res.statusText}`);
    }
    return await res.text();
  }

  /**
   * GET a commissioner setup page (csetup?C=...) as HTML. Read-only.
   * extraParams adds query fields (e.g. { VICTORY_POINTS: '1' }).
   */
  async fetchCommishPage(c, extraParams = {}) {
    return await this.fetchPage('csetup', { C: c, ...extraParams });
  }

  /**
   * Changes fields on a csetup form and saves it: GETs the page fresh (for its
   * input_expires token and every current setting), applies changes (see
   * applyFormChanges), and POSTs the whole form back. With dryRun, only reports.
   * Options: params (extra query for the GET, e.g. { VICTORY_POINTS: '1' }),
   * requireExisting (fail if a changed field is not on the live form, so a
   * wrong field name can never be posted silently).
   * Returns the changed fields as "NAME old → new".
   */
  async submitCsetupForm(c, changes, { dryRun = false, params = {}, requireExisting = false } = {}) {
    const html = await this.fetchCommishPage(c, params);
    return await this.submitParsedForm(parseCsetupForm(html, c), changes, {
      dryRun, requireExisting, label: `csetup C=${c}`, postUrl: `${this.baseUrl}/csetup`, referer: `${this.baseUrl}/csetup?${new URLSearchParams({ L: this.leagueId, C: c, ...params })}`
    });
  }

  /**
   * Same as submitCsetupForm for any commissioner page: GETs page?params, picks
   * the form where matches(formHtml) is true, applies changes, POSTs it to the
   * form's own action.
   */
  async submitPageForm(page, params, matches, changes, { dryRun = false, requireExisting = false } = {}) {
    const label = `${page} ${new URLSearchParams(params)}`;
    const parsed = parseMflForm(await this.fetchPage(page, params), matches, label);
    return await this.submitParsedForm(parsed, changes, {
      dryRun, requireExisting, label, referer: `${this.baseUrl}/${page}?${new URLSearchParams({ L: this.leagueId, ...params })}`
    });
  }

  async submitParsedForm(parsed, changes, { dryRun, requireExisting, label, referer, postUrl }) {
    if (requireExisting) {
      const known = new Set([...parsed.fields.map(f => f[0]), ...Object.keys(parsed.checkboxValues)]);
      const missing = Object.keys(changes).filter(n => !known.has(n));
      if (missing.length > 0) {
        throw new Error(`${label}: the live form has no field(s) ${missing.join(', ')}. Run the inspect mode and fix the field names.`);
      }
    }
    const fields = applyFormChanges(parsed, changes);
    const changed = describeFormChanges(parsed.fields, fields);
    if (dryRun || changed.length === 0) return changed;

    const target = postUrl || (parsed.action ? new URL(parsed.action, `${this.baseUrl}/`).toString() : `${this.baseUrl}/csetup`);
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        'Cookie': this.cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': referer,
        'User-Agent': this.userAgent
      },
      body: new URLSearchParams(fields).toString()
    });
    if (!res.ok) {
      throw new Error(`MFL POST failed [${label}]: ${res.status} ${res.statusText}`);
    }
    // MFL answers 200 even when it rejects a form; callers confirm through an export.
    await res.text();
    return changed;
  }
}

export default MflCommishClient;
