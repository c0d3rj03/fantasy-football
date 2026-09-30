import path from 'path';
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
   * Authenticate as Commissioner and store full session cookies (MFL_USER_ID + IS_COMMISH=1)
   */
  async login(username = process.env.MFL_USERNAME, password = process.env.MFL_PASSWORD) {
    if (!username || !password) {
      throw new Error('MFL Credentials (MFL_USERNAME, MFL_PASSWORD) are required.');
    }

    const loginUrl = `${this.baseUrl}/login?USERNAME=${encodeURIComponent(username)}&PASSWORD=${encodeURIComponent(password)}&XML=1`;
    const res = await fetch(loginUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const cookiePairs = [];

    // Extract all Set-Cookie headers returned by MFL login
    if (typeof res.headers.getSetCookie === 'function') {
      const setCookies = res.headers.getSetCookie();
      setCookies.forEach(sc => {
        const parts = sc.split(';');
        if (parts.length > 0) {
          const pair = parts[0].trim();
          if (pair && !cookiePairs.includes(pair)) {
            cookiePairs.push(pair);
          }
        }
      });
    } else {
      const rawCookie = res.headers.get('set-cookie') || '';
      const matches = rawCookie.match(/(MFL_USER_ID|IS_COMMISH|MFL_LEAGUE_ID)=[^;]+/g);
      if (matches) {
        matches.forEach(m => {
          if (!cookiePairs.includes(m)) cookiePairs.push(m);
        });
      }
    }

    // Explicitly guarantee IS_COMMISH=1 cookie is present for Commissioner setup forms
    if (!cookiePairs.some(p => p.startsWith('IS_COMMISH='))) {
      cookiePairs.push('IS_COMMISH=1');
    }

    if (cookiePairs.some(p => p.startsWith('MFL_USER_ID='))) {
      this.cookie = cookiePairs.join('; ');
      console.log('🔒 MFL Commissioner authenticated with active session cookies:', this.cookie);
      return true;
    }

    // Fallback: Check XML body if cookies weren't in headers
    const xmlText = await res.text();
    const match = xmlText.match(/cookie_value="([^"]+)"/);
    if (match) {
      this.cookie = `MFL_USER_ID=${match[1]}; IS_COMMISH=1`;
      console.log('🔒 MFL Commissioner authenticated via XML body.');
      return true;
    }

    throw new Error('MFL Login failed: MFL_USER_ID session cookie not returned.');
  }

  /**
   * Universal API Request (Export / Import)
   */
  async apiRequest(command, params = {}, method = 'GET', body = null) {
    if (!this.cookie) await this.login();

    let url = `${this.baseUrl}/${command}?L=${this.leagueId}&JSON=1`;
    Object.keys(params).forEach(k => {
      url += `&${k}=${encodeURIComponent(params[k])}`;
    });

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    if (this.cookie) headers['Cookie'] = this.cookie;

    const options = { method, headers };
    if (body) {
      options.body = typeof body === 'string' ? body : querystring.stringify(body);
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const res = await fetch(url, options);
    const text = await res.text();

    try {
      const data = JSON.parse(text);
      if (data.status === 'ERROR' || data.error) {
        const errMsg = data.error?.$t || data.error || JSON.stringify(data);
        throw new Error(`MFL API Error: ${errMsg}`);
      }
      return data;
    } catch (err) {
      if (err.message.startsWith('MFL API Error:')) throw err;

      // Handle MFL XML responses (common on /import endpoints)
      if (text.includes('<status>OK</status>') || text.includes('status="OK"') || (text.includes('<?xml') && !text.includes('ERROR'))) {
        return { status: 'OK', rawResponse: text };
      }
      throw new Error(`MFL Response Error: ${text.slice(0, 150)}`);
    }
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload)
      },
      body: payload
    });

    const resHtml = await res.text();

    // Verify MFL HTML response for success or failure indicators
    if (resHtml.includes('You must be logged in as the commissioner') || resHtml.includes('Access Denied')) {
      throw new Error('MFL Form Submission Rejected: Session not recognized as Commissioner (Access Denied).');
    }

    return resHtml;
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

      const comments = `Week ${targetWeek - 1} Prior Score Carryover for Week ${targetWeek} Rolling Total`;
      try {
        const res = await this.apiRequest('import', {
          TYPE: 'adjustScores',
          W: targetWeek,
          FRANCHISE: franchiseId,
          SCORE: score.toFixed(2),
          COMMENTS: comments
        }, 'POST');

        console.log(`  ✓ Franchise ${franchiseId}: +${score.toFixed(2)} pts added to Week ${targetWeek} (MFL Status: OK)`);
        results.push({ franchiseId, score, success: true, res });
      } catch (err) {
        console.error(`  ✗ Failed to adjust score for Franchise ${franchiseId}:`, err.message);
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
      form_name: 'general',
      LEAGUE_ID: this.leagueId,
      C: 'GENERAL',
      LEAGUE_NAME: 'Ultimate Guillotine',
      LEAGUE_EMAIL: 'latenightgator@gmail.com',
      DIVISIONS: '1',
      FRANCHISES: '24',
      ROSTER_SIZE: config.rosterSize.toString(),
      INJURED_RESERVE: '1',
      TAXI_SQUAD: '0',
      H2H: 'NO',
      ROSTERS_PER_PLAYER: '1',
      SALARY_CAP: 'NO',
      LOAD_ROSTERS: 'draft',
      SCHEDULE_INVALIDATED: 'No',
      SUBMIT: 'Save General League Setup'
    };
    const generalRes = await this.submitCommishForm('csetup', generalData);

    // Step B: Update Lineup Requirements (csetup?C=LINEUP)
    console.log(`Updating Starting Lineup to ${config.startersTotal} starters (${config.lineupDesc})...`);
    const lineupData = {
      form_name: 'lineup',
      LEAGUE_ID: this.leagueId,
      C: 'LINEUP',
      USE_QB: 'on',
      MIN_QB: config.positionalLimits.QB_MIN.toString(),
      MAX_QB: config.positionalLimits.QB_MAX.toString(),
      USE_RB: 'on',
      MIN_RB: config.positionalLimits.RB_MIN.toString(),
      MAX_RB: config.positionalLimits.RB_MAX.toString(),
      USE_WR: 'on',
      MIN_WR: config.positionalLimits.WR_MIN.toString(),
      MAX_WR: config.positionalLimits.WR_MAX.toString(),
      USE_TE: 'on',
      MIN_TE: config.positionalLimits.TE_MIN.toString(),
      MAX_TE: config.positionalLimits.TE_MAX.toString(),
      MIN_STARTERS: config.startersTotal.toString(),
      MAX_STARTERS: config.startersTotal.toString(),
      IOP_STARTERS: '',
      IDP_STARTERS: '',
      LINEUP_DEADLINE: 'gametime',
      PARTIAL_LINEUP_ALLOWED: 'NO',
      AUTO_START_PLAYERS: 'Yes',
      USE_BEST_LINEUP: 'No',
      PREV_COPY: 'Yes',
      HIDE_STARTERS: 'No',
      ALLOW_BYE_STARTERS: 'Yes',
      SUBMIT: 'Save Starting Lineup Settings'
    };
    const lineupRes = await this.submitCommishForm('csetup', lineupData);

    console.log(`✓ Week ${week} MFL Roster & Lineup Capacity form submissions complete.`);
    return { generalRes, lineupRes };
  }

  /**
   * 3. Execute 2nd Cut Execution for Multi-Cut Weeks (csetup?C=MANDROP)
   */
  async executeManDrop(franchiseId) {
    console.log(`\n--- [MFL Form] Executing 2nd Manual Cut for Franchise ${franchiseId} ---`);
    if (!this.cookie) await this.login();

    const formData = {
      form_name: 'mandrop',
      LEAGUE_ID: this.leagueId,
      C: 'MANDROP',
      FRANCHISE_ID: franchiseId,
      ACTION: 'DROP_ROSTER_AND_LOCK',
      SUBMIT: 'Execute Manual Drop'
    };

    const resHtml = await this.submitCommishForm('csetup', formData);

    if (resHtml.includes('Select Franchise') || resHtml.includes('not found') || !resHtml.includes(franchiseId)) {
      console.warn(`⚠️ Franchise ${franchiseId} was not in MFL's drop selection list (likely already dropped or locked manually).`);
    } else {
      console.log(`✓ Franchise ${franchiseId} manual drop request submitted to MFL.`);
    }

    return resHtml;
  }

  /**
   * 4. Award Weekly FAAB Prize (Weeks 1-4) via BBIDWAIV Setup Form
   */
  async awardFAABPrize(winnerFranchiseId, amount, week) {
    console.log(`\n--- [MFL Form] Awarding +$${amount} FAAB Prize to Franchise ${winnerFranchiseId} for Week ${week} ---`);
    if (!this.cookie) await this.login();

    const comments = `Week ${week} High Score FAAB Prize`;

    const bbidData = {
      form_name: 'bbid',
      LEAGUE_ID: this.leagueId,
      C: 'BBIDWAIV',
      BBID_SEASON_LIMIT: '200',
      BBID_INCREMENT: '1',
      BBID_MINIMUM: '0',
      BBID_FCFS_CHARGE: '0',
      CONDITIONAL_BBID: 'No',
      BBID_WAIVER_FEE: 'No'
    };

    // Populate BBID_ADJUSTMENT and BBID_COMMENT for all 24 franchises (0001 - 0024)
    for (let i = 1; i <= 24; i++) {
      const fid = i.toString().padStart(4, '0');
      if (fid === winnerFranchiseId) {
        bbidData[`BBID_ADJUSTMENT${fid}`] = amount.toString();
        bbidData[`BBID_COMMENT${fid}`] = comments;
      } else {
        bbidData[`BBID_ADJUSTMENT${fid}`] = '0';
        bbidData[`BBID_COMMENT${fid}`] = '';
      }
    }

    Object.assign(bbidData, {
      BBID_TRANSFER_BAL: 'No',
      BBID_TIEBREAKER: 'SORT',
      WAIVER_SORT_0: 'LAST_WEEK_POINTS',
      WAIVER_SORT_1: 'PTS',
      WAIVER_SORT_2: 'NONE',
      WAIVER_SORT_3: 'NONE',
      WAIVER_SORT_4: 'NONE',
      WAIVER_SORT_5: 'NONE',
      SUBMIT: 'Save Blind Bid Waiver Setup'
    });

    const resHtml = await this.submitCommishForm('csetup', bbidData);
    console.log(`✓ Franchise ${winnerFranchiseId}: +$${amount} FAAB awarded via BBIDWAIV form submission.`);
    return resHtml;
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
