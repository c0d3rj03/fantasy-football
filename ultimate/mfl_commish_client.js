import fetch from 'node-fetch';
import querystring from 'querystring';

/**
 * Reusable MFL Commissioner Client
 * Handles both MFL REST API calls (import/export) and form POSTs (csetup/options)
 */
export class MflCommishClient {
  constructor(seasonYear = '2026', leagueId = '25918', host = 'www42.myfantasyleague.com') {
    this.baseUrl = `https://${host}/${seasonYear}`;
    this.leagueId = leagueId;
    this.host = host;
    this.cookie = null;
  }

  /**
   * Authenticate as Commissioner and store session cookie
   */
  async login(username = process.env.MFL_USERNAME, password = process.env.MFL_PASSWORD) {
    if (!username || !password) {
      throw new Error('MFL Credentials (MFL_USERNAME, MFL_PASSWORD) are required.');
    }

    const loginUrl = `${this.baseUrl}/login?USERNAME=${encodeURIComponent(username)}&PASSWORD=${encodeURIComponent(password)}&XML=1`;
    const res = await fetch(loginUrl);
    const setCookie = res.headers.get('set-cookie');

    if (setCookie) {
      const match = setCookie.match(/MFL_USER_ID=([^;]+)/);
      if (match) {
        this.cookie = `MFL_USER_ID=${match[1]}`;
        console.log('🔒 MFL Commissioner authenticated successfully.');
        return true;
      }
    }
    throw new Error('MFL Login failed: MFL_USER_ID cookie not returned.');
  }

  /**
   * Universal API Request (Export / Import)
   */
  async apiRequest(command, params = {}, method = 'GET', body = null) {
    let url = `${this.baseUrl}/${command}?L=${this.leagueId}&JSON=1`;
    Object.keys(params).forEach(k => {
      url += `&${k}=${encodeURIComponent(params[k])}`;
    });

    const headers = {};
    if (this.cookie) headers['Cookie'] = this.cookie;

    const options = { method, headers };
    if (body) {
      options.body = typeof body === 'string' ? body : querystring.stringify(body);
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const res = await fetch(url, options);
    return await res.json();
  }

  /**
   * Submit MFL Commissioner Setup Form (csetup)
   */
  async submitCommishForm(endpoint, formData) {
    if (!this.cookie) await this.login();

    const targetUrl = `${this.baseUrl}/${endpoint}?L=${this.leagueId}`;
    const payload = querystring.stringify(formData);

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Cookie': this.cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload)
      },
      body: payload
    });

    return await res.text();
  }

  /**
   * 1. Push Single-Week Score Adjustments for Rolling Totals (FSCOREADJ)
   */
  async pushScoreAdjustments(targetWeek, scoreMap) {
    console.log(`\n--- [MFL API] Pushing Week ${targetWeek - 1} Scores into Week ${targetWeek} Rolling Total ---`);
    if (!this.cookie) await this.login();

    const results = [];
    for (const [franchiseId, score] of Object.entries(scoreMap)) {
      if (typeof score !== 'number' || score <= 0) continue;

      const comments = `Week ${targetWeek - 1} Score`;
      try {
        const res = await this.apiRequest('import', {
          TYPE: 'adjustScores',
          W: targetWeek,
          FRANCHISE: franchiseId,
          SCORE: score.toFixed(2),
          COMMENTS: comments
        }, 'POST');

        console.log(`✓ Franchise ${franchiseId}: +${score.toFixed(2)} pts added to Week ${targetWeek}`);
        results.push({ franchiseId, score, success: true, res });
      } catch (err) {
        console.error(`✗ Failed to adjust score for Franchise ${franchiseId}:`, err.message);
        results.push({ franchiseId, score, success: false, error: err.message });
      }
    }
    return results;
  }

  /**
   * 2. Update Roster & Lineup Capacity (GENERAL & LINEUP Setup Forms)
   */
  async updateRosterAndLineup(week) {
    console.log(`\n--- [MFL Form] Updating Roster & Lineup Capacity for Week ${week} ---`);
    if (!this.cookie) await this.login();

    const config = ROSTER_SCHEDULE[week];
    if (!config) {
      throw new Error(`No schedule configuration found for Week ${week}`);
    }

    // Step A: Update General Roster Capacity (csetup?C=GENERAL)
    console.log(`Updating Max Roster Size to ${config.rosterSize}...`);
    const generalData = {
      C: 'GENERAL',
      ROSTER_SIZE: config.rosterSize,
      INJURED_RESERVE_SIZE: 1
    };
    const generalRes = await this.submitCommishForm('csetup', generalData);

    // Step B: Update Lineup Requirements (csetup?C=LINEUP)
    console.log(`Updating Starting Lineup to ${config.startersTotal} starters (${config.lineupDesc})...`);
    const lineupData = {
      C: 'LINEUP',
      STARTERS: config.startersTotal,
      ...config.positionalLimits
    };
    const lineupRes = await this.submitCommishForm('csetup', lineupData);

    console.log(`✓ Week ${week} MFL Roster & Lineup Capacity successfully updated.`);
    return { generalRes, lineupRes };
  }

  /**
   * 3. Execute 2nd Cut Execution for Multi-Cut Weeks (csetup?C=MANDROP)
   */
  async executeManDrop(franchiseId) {
    console.log(`\n--- [MFL Form] Executing 2nd Manual Cut for Franchise ${franchiseId} ---`);
    if (!this.cookie) await this.login();

    const formData = {
      C: 'MANDROP',
      FRANCHISE_ID: franchiseId,
      ACTION: 'DROP_ROSTER_AND_LOCK'
    };

    const resHtml = await this.submitCommishForm('csetup', formData);
    console.log(`✓ Franchise ${franchiseId} manually dropped & locked on MFL.`);
    return resHtml;
  }

  /**
   * 4. Award Weekly FAAB Prize (Weeks 1-4)
   */
  async awardFAABPrize(franchiseId, amount, week) {
    console.log(`\n--- [MFL API] Awarding +$${amount} FAAB Prize to Franchise ${franchiseId} for Week ${week} ---`);
    if (!this.cookie) await this.login();

    const comments = `Week ${week} High Score FAAB Prize`;
    const res = await this.apiRequest('import', {
      TYPE: 'accounting',
      FRANCHISE: franchiseId,
      AMOUNT: amount,
      COMMENTS: comments
    }, 'POST');

    console.log(`✓ Franchise ${franchiseId}: +$${amount} FAAB awarded.`);
    return res;
  }
}

// Master Weekly Roster Expansion & Positional Starter Requirements
export const ROSTER_SCHEDULE = {
  1: { rosterSize: 8, startersTotal: 8, lineupDesc: '1 QB, 2 RB, 2 WR, 1 TE, 2 FLX (0 Bench)', positionalLimits: { QB_MIN: 1, QB_MAX: 1, RB_MIN: 2, RB_MAX: 4, WR_MIN: 2, WR_MAX: 4, TE_MIN: 1, TE_MAX: 3 } },
  2: { rosterSize: 9, startersTotal: 8, lineupDesc: '1 QB, 2 RB, 2 WR, 1 TE, 2 FLX (1 Bench)', positionalLimits: { QB_MIN: 1, QB_MAX: 1, RB_MIN: 2, RB_MAX: 4, WR_MIN: 2, WR_MAX: 4, TE_MIN: 1, TE_MAX: 3 } },
  3: { rosterSize: 9, startersTotal: 8, lineupDesc: '1 QB, 2 RB, 2 WR, 1 TE, 2 FLX (1 Bench)', positionalLimits: { QB_MIN: 1, QB_MAX: 1, RB_MIN: 2, RB_MAX: 4, WR_MIN: 2, WR_MAX: 4, TE_MIN: 1, TE_MAX: 3 } },
  4: { rosterSize: 10, startersTotal: 8, lineupDesc: '1 QB, 2 RB, 2 WR, 1 TE, 2 FLX (2 Bench)', positionalLimits: { QB_MIN: 1, QB_MAX: 1, RB_MIN: 2, RB_MAX: 4, WR_MIN: 2, WR_MAX: 4, TE_MIN: 1, TE_MAX: 3 } },
  5: { rosterSize: 10, startersTotal: 8, lineupDesc: '1 QB, 2 RB, 2 WR, 1 TE, 2 FLX (2 Bench)', positionalLimits: { QB_MIN: 1, QB_MAX: 1, RB_MIN: 2, RB_MAX: 4, WR_MIN: 2, WR_MAX: 4, TE_MIN: 1, TE_MAX: 3 } },
  6: { rosterSize: 11, startersTotal: 9, lineupDesc: '1 QB, 2 RB, 2 WR, 1 TE, 3 FLX (2 Bench)', positionalLimits: { QB_MIN: 1, QB_MAX: 1, RB_MIN: 2, RB_MAX: 5, WR_MIN: 2, WR_MAX: 5, TE_MIN: 1, TE_MAX: 4 } },
  7: { rosterSize: 11, startersTotal: 9, lineupDesc: '1 QB, 2 RB, 2 WR, 1 TE, 3 FLX (2 Bench)', positionalLimits: { QB_MIN: 1, QB_MAX: 1, RB_MIN: 2, RB_MAX: 5, WR_MIN: 2, WR_MAX: 5, TE_MIN: 1, TE_MAX: 4 } },
  8: { rosterSize: 12, startersTotal: 10, lineupDesc: '1 QB, 2 RB, 3 WR, 1 TE, 3 FLX (2 Bench)', positionalLimits: { QB_MIN: 1, QB_MAX: 1, RB_MIN: 2, RB_MAX: 5, WR_MIN: 3, WR_MAX: 6, TE_MIN: 1, TE_MAX: 4 } },
  9: { rosterSize: 12, startersTotal: 10, lineupDesc: '1 QB, 2 RB, 3 WR, 1 TE, 3 FLX (2 Bench)', positionalLimits: { QB_MIN: 1, QB_MAX: 1, RB_MIN: 2, RB_MAX: 5, WR_MIN: 3, WR_MAX: 6, TE_MIN: 1, TE_MAX: 4 } },
  10: { rosterSize: 13, startersTotal: 11, lineupDesc: '2 QB, 2 RB, 3 WR, 1 TE, 3 FLX (2 Bench)', positionalLimits: { QB_MIN: 2, QB_MAX: 2, RB_MIN: 2, RB_MAX: 5, WR_MIN: 3, WR_MAX: 6, TE_MIN: 1, TE_MAX: 4 } },
  11: { rosterSize: 13, startersTotal: 11, lineupDesc: '2 QB, 2 RB, 3 WR, 1 TE, 3 FLX (2 Bench)', positionalLimits: { QB_MIN: 2, QB_MAX: 2, RB_MIN: 2, RB_MAX: 5, WR_MIN: 3, WR_MAX: 6, TE_MIN: 1, TE_MAX: 4 } },
  12: { rosterSize: 14, startersTotal: 12, lineupDesc: '2 QB, 3 RB, 3 WR, 1 TE, 3 FLX (2 Bench)', positionalLimits: { QB_MIN: 2, QB_MAX: 2, RB_MIN: 3, RB_MAX: 6, WR_MIN: 3, WR_MAX: 6, TE_MIN: 1, TE_MAX: 4 } },
  13: { rosterSize: 14, startersTotal: 12, lineupDesc: '2 QB, 3 RB, 3 WR, 1 TE, 3 FLX (2 Bench)', positionalLimits: { QB_MIN: 2, QB_MAX: 2, RB_MIN: 3, RB_MAX: 6, WR_MIN: 3, WR_MAX: 6, TE_MIN: 1, TE_MAX: 4 } },
  14: { rosterSize: 15, startersTotal: 13, lineupDesc: '2 QB, 3 RB, 3 WR, 2 TE, 3 FLX (2 Bench)', positionalLimits: { QB_MIN: 2, QB_MAX: 2, RB_MIN: 3, RB_MAX: 6, WR_MIN: 3, WR_MAX: 6, TE_MIN: 2, TE_MAX: 5 } },
  15: { rosterSize: 15, startersTotal: 13, lineupDesc: '2 QB, 3 RB, 3 WR, 2 TE, 3 FLX (2 Bench)', positionalLimits: { QB_MIN: 2, QB_MAX: 2, RB_MIN: 3, RB_MAX: 6, WR_MIN: 3, WR_MAX: 6, TE_MIN: 2, TE_MAX: 5 } },
  16: { rosterSize: 16, startersTotal: 14, lineupDesc: '2 QB, 3 RB, 3 WR, 2 TE, 4 FLX (2 Bench)', positionalLimits: { QB_MIN: 2, QB_MAX: 2, RB_MIN: 3, RB_MAX: 7, WR_MIN: 3, WR_MAX: 7, TE_MIN: 2, TE_MAX: 6 } },
  17: { rosterSize: 16, startersTotal: 14, lineupDesc: '2 QB, 3 RB, 3 WR, 2 TE, 4 FLX (2 Bench)', positionalLimits: { QB_MIN: 2, QB_MAX: 2, RB_MIN: 3, RB_MAX: 7, WR_MIN: 3, WR_MAX: 7, TE_MIN: 2, TE_MAX: 6 } }
};
