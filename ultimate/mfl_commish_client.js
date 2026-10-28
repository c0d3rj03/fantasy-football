import querystring from 'querystring';
import { parseCsetupForm, applyFormChanges, describeFormChanges } from './mfl_csetup_form.js';
import { MFL_HOST } from './config.js';

const USER_AGENT = 'UltimateGuillotineCommish/1.0 (+https://github.com/c0d3rj03/fantasy-football)';

/**
 * Universal MFL Commissioner API & Web Form Client
 * Supports standard JSON API imports/exports and authenticated web form POSTs.
 */
export class MflCommishClient {
  constructor(seasonYear, leagueId, host = MFL_HOST) {
    if (!seasonYear || !leagueId) {
      throw new Error('MflCommishClient requires seasonYear and leagueId (import them from config.js).');
    }
    this.seasonYear = seasonYear;
    this.leagueId = leagueId;
    this.host = host;
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

    // 3. Become commissioner (franchise 0000), as pbr/mfl_updater.js does. MFL answers
    // with redirects that set MFL_IS_COMMISH; follow them by hand to keep every cookie.
    let url = `${this.baseUrl}/logout?L=${this.leagueId}&BECOME=0000`;
    for (let hop = 0; hop < 5 && url; hop++) {
      const step = await fetch(url, {
        headers: { 'Cookie': this.cookie, 'User-Agent': USER_AGENT },
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
      'User-Agent': USER_AGENT
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
   * GET a commissioner setup page (csetup?C=...) as HTML. Read-only.
   */
  async fetchCommishPage(c) {
    if (!this.cookie) {
      await this.login();
    }
    const res = await fetch(`${this.baseUrl}/csetup?L=${this.leagueId}&C=${encodeURIComponent(c)}`, {
      headers: {
        'Cookie': this.cookie,
        'User-Agent': USER_AGENT
      }
    });
    if (!res.ok) {
      throw new Error(`MFL csetup error [${c}]: ${res.status} ${res.statusText}`);
    }
    return await res.text();
  }

  /**
   * Changes fields on a csetup form and saves it: GETs the page fresh (for its
   * input_expires token and every current setting), applies changes (see
   * applyFormChanges), and POSTs the whole form back. With dryRun, only reports.
   * Returns the changed fields as "NAME old → new".
   */
  async submitCsetupForm(c, changes, { dryRun = false } = {}) {
    const parsed = parseCsetupForm(await this.fetchCommishPage(c), c);
    const fields = applyFormChanges(parsed, changes);
    const changed = describeFormChanges(parsed.fields, fields);
    if (dryRun || changed.length === 0) return changed;

    const res = await fetch(`${this.baseUrl}/csetup`, {
      method: 'POST',
      headers: {
        'Cookie': this.cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': `${this.baseUrl}/csetup?L=${this.leagueId}&C=${c}`,
        'User-Agent': USER_AGENT
      },
      body: new URLSearchParams(fields).toString()
    });
    if (!res.ok) {
      throw new Error(`MFL csetup POST failed [${c}]: ${res.status} ${res.statusText}`);
    }
    // MFL answers 200 even when it rejects a form; callers confirm through an export.
    await res.text();
    return changed;
  }
}

export default MflCommishClient;
