import querystring from 'querystring';

/**
 * Universal MFL Commissioner API & Web Form Client
 * Supports standard JSON API imports/exports and authenticated web form POSTs.
 */
export class MflCommishClient {
  constructor(
    seasonYear = process.env.SEASON_YEAR || '2026',
    leagueId = process.env.LEAGUE_ID || '25918',
    host = process.env.MFL_HOST || 'www42.myfantasyleague.com'
  ) {
    this.seasonYear = seasonYear;
    this.leagueId = leagueId;
    this.host = host;
    this.baseUrl = `https://${this.host}/${this.seasonYear}`;
    this.cookie = null;
  }

  /**
   * Log in as Commissioner and capture the MFL_USER_ID session cookie.
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
    
    // 1. Try Set-Cookie header
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/MFL_USER_ID=([^;]+)/);
      if (match) {
        this.cookie = `MFL_USER_ID=${match[1]}`;
        console.log('🔒 MFL Commissioner authenticated successfully (via header).');
        return true;
      }
    }

    // 2. Try XML body fallback if cookie header wasn't exposed
    const text = await res.text();
    const xmlMatch = text.match(/cookie_value="([^"]+)"/);
    if (xmlMatch) {
      this.cookie = `MFL_USER_ID=${xmlMatch[1]}`;
      console.log('🔒 MFL Commissioner authenticated successfully (via XML body).');
      return true;
    }

    throw new Error('MFL Login failed: MFL_USER_ID cookie not returned.');
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
      'User-Agent': 'UltimateGuillotineCommish/1.0 (+https://github.com/c0d3rj03/fantasy-football)'
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
    return await res.json();
  }

  /**
   * Direct Web Form POST (For non-API Commish Setup Forms like C=STANDADJ, C=DIVCONF, C=MANDROP)
   */
  async submitCommishForm(endpoint, formData) {
    if (!this.cookie) {
      await this.login();
    }

    const targetUrl = `${this.baseUrl}/${endpoint}?L=${this.leagueId}`;
    const payload = querystring.stringify(formData);

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Cookie': this.cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': String(Buffer.byteLength(payload)),
        'User-Agent': 'UltimateGuillotineCommish/1.0 (+https://github.com/c0d3rj03/fantasy-football)'
      },
      body: payload
    });

    return await res.text(); // Returns MFL HTML response string
  }
}

export default MflCommishClient;
