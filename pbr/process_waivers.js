const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'tokens_data.json');
const playersPath = path.join(__dirname, 'mfl_players.json');

const LEAGUE_ID = process.env.MFL_LEAGUE_ID || '63213';
const YEAR = process.env.MFL_YEAR || '2026';

function determineQuarter(dateStr) {
  if (!dateStr) return 'Q1';
  const d = new Date(dateStr);
  const m = d.getMonth() + 1;
  const day = d.getDate();

  if (m < 9 || (m === 9 && day <= 28)) return 'Q1';
  if (m === 9 || (m === 10 && day <= 26)) return 'Q2';
  if (m === 10 || (m === 11 && day <= 23)) return 'Q3';
  return 'Post';
}

async function fetchMflWaiverClaims() {
  console.log(`⚡ Fetching live MFL Waiver Claims ($25+) for ${YEAR}...`);
  try {
    const url = `https://www42.myfantasyleague.com/${YEAR}/export?TYPE=transactions&L=${LEAGUE_ID}&TRANS_TYPE=BBID_WAIVER,WAIVER&JSON=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rawList = data?.transactions?.transaction || [];
    const claims = Array.isArray(rawList) ? rawList : [rawList];

    // Filter winning claims >= $25
    return claims.filter(c => parseFloat(c.bid || 0) >= 25);
  } catch (err) {
    console.error(`⚠️ MFL Waivers fetch failed: ${err.message}`);
    return [];
  }
}

async function processWaivers() {
  console.log('⚡ Running PBR Waiver Token Processor...');

  if (!fs.existsSync(dataPath)) {
    console.error('❌ tokens_data.json not found! Run rebuild_tokens.js first.');
    return;
  }

  const tokensData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  // Load player catalog if available
  let playersCatalog = {};
  if (fs.existsSync(playersPath)) {
    try {
      playersCatalog = JSON.parse(fs.readFileSync(playersPath, 'utf8'));
    } catch (e) {}
  }

  const claims = await fetchMflWaiverClaims();

  // Reset waiver token tallies
  Object.keys(tokensData.waiver_summary).forEach(t => {
    tokensData.waiver_summary[t] = { Q1: 0, Q2: 0, Q3: 0, Post: 0, total: 0 };
    if (tokensData.summary[t]) {
      tokensData.summary[t].waiver_tokens = 0;
    }
  });

  const waiverLedger = [];

  claims.forEach(c => {
    const date = new Date(parseInt(c.timestamp, 10) * 1000).toISOString().split('T')[0];
    const quarter = determineQuarter(date);
    const bid = parseFloat(c.bid || 0);
    const team = c.franchise_name || c.franchise || 'Unknown';
    const playerId = c.transaction?.split(',')[0] || c.transaction || '';

    const pInfo = playersCatalog[playerId] || { name: `Player #${playerId}`, position: '', team: '' };
    const pName = pInfo.name ? `${pInfo.name} (${pInfo.position} - ${pInfo.team})` : `Player #${playerId}`;

    let tokensEarned = 0;
    let note = "Standard (+1 Token)";

    if (tokensData.waiver_summary[team]) {
      const currentQ = tokensData.waiver_summary[team][quarter] || 0;
      if (currentQ < 5) {
        tokensEarned = 1;
        tokensData.waiver_summary[team][quarter] += 1;
        tokensData.waiver_summary[team].total += 1;
        if (tokensData.summary[team]) {
          tokensData.summary[team].waiver_tokens += 1;
        }
      } else {
        note = `Quarterly Cap Reached (5 tokens max for ${quarter})`;
      }
    }

    waiverLedger.push({
      date,
      team,
      player: pName,
      bid,
      quarter,
      tokens_earned: tokensEarned,
      note
    });
  });

  // Recalculate current totals for all teams
  Object.keys(tokensData.summary).forEach(t => {
    const s = tokensData.summary[t];
    s.current_tokens = s.start + s.trade_tokens + s.waiver_tokens + s.promotion_tokens;
  });

  tokensData.last_updated = new Date().toISOString();

  fs.writeFileSync(dataPath, JSON.stringify(tokensData, null, 2));

  console.log(`\n====================================================================================`);
  console.log(`                           PBR WAIVER TRANSACTIONS LEDGER                          `);
  console.log(`====================================================================================`);

  if (waiverLedger.length === 0) {
    console.log('No $25+ waiver claims processed yet for the 2026 season.');
  } else {
    waiverLedger.forEach(w => {
      console.log(`[${w.date}] ${w.team.padEnd(22)} | Added: ${w.player.padEnd(30)} | Bid: $${w.bid.toFixed(2).padStart(6)} | Quarter: ${w.quarter} | Tokens: +${w.tokens_earned} (${w.note})`);
    });
  }

  console.log(`\n====================================================================================`);
  console.log(`                        WAIVER TOKENS EARNED BY FRANCHISE                          `);
  console.log(`====================================================================================`);
  Object.keys(tokensData.waiver_summary).forEach(t => {
    const w = tokensData.waiver_summary[t];
    console.log(`${t.padEnd(24)} | Total Waiver Tokens: ${String(w.total).padStart(2)} | (Q1: ${w.Q1}, Q2: ${w.Q2}, Q3: ${w.Q3}, Post: ${w.Post})`);
  });

  console.log(`\n✅ Saved updated waiver token calculations to pbr/tokens_data.json!`);
}

processWaivers();
