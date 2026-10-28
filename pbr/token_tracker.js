/**
 * Daily Participation Token ledger (RULES.md §8) → pbr/tokens_data.json for the dashboard (tokens.html).
 *
 *   node token_tracker.js
 *
 * Reads (no login needed):
 *   MFL exports: league (team names), transactions (TRADE, BBID_WAIVER), players (names),
 *                nflSchedule (quarter boundaries: Weeks 1, 4, 8, 12).
 *   ktc-values/KTC-YYYY-MM.json: KTC values for the month of each trade (ktc_fetcher.js).
 *   data.json promotion_relegation: promotion tokens.
 *   token_settings.json: starting balances, the $ minimum, voided moves, manual adjustments.
 * Rebuilds the whole ledger every run, so it is safe to rerun and picks up edits to the settings file.
 */
const fs = require('fs');
const path = require('path');

const { LEAGUE_ID, YEAR, MFL_HOST } = require('./config.js');
const { PROMOTION_TOKENS, valueTrade, periodOf, scoreWaivers } = require('./token_rules.js');
const { snapshotFor, playerValue, availableMonths } = require('./ktc_snapshots.js');

const OUT_PATH = path.join(__dirname, 'tokens_data.json');
const SETTINGS_PATH = path.join(__dirname, 'token_settings.json');
const DATA_PATH = path.join(__dirname, 'data.json');

// A quarter ends 8 hours after its last NFL kickoff (after Monday Night Football).
const GAME_END_SECONDS = 8 * 3600;
const PERIODS = ['Offseason', 'Q1', 'Q2', 'Q3', 'Post'];

const asArray = x => (Array.isArray(x) ? x : x ? [x] : []);
const etDate = ts => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ts * 1000));

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'pbr-token-tracker' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const json = await res.json();
  if (json.error) throw new Error(`MFL error from ${url}: ${json.error.$t || JSON.stringify(json.error)}`);
  return json;
}
const leagueExport = (type, params = '') =>
  getJson(`https://${MFL_HOST}/${YEAR}/export?TYPE=${type}&L=${LEAGUE_ID}&JSON=1${params}`);
// players and nflSchedule are only served by the api host.
const apiExport = (type, params = '') =>
  getJson(`https://api.myfantasyleague.com/${YEAR}/export?TYPE=${type}&JSON=1${params}`);

async function seasonBounds() {
  const kickoffs = async week => asArray((await apiExport('nflSchedule', `&W=${week}`)).nflSchedule?.matchup)
    .map(m => Number(m.kickoff)).filter(Boolean);
  const [w1, w4, w8, w12] = await Promise.all([1, 4, 8, 12].map(kickoffs));
  if (![w1, w4, w8, w12].every(k => k.length)) throw new Error('nflSchedule is missing kickoffs');
  return {
    week1Start: Math.min(...w1),
    q1End: Math.max(...w4) + GAME_END_SECONDS,
    q2End: Math.max(...w8) + GAME_END_SECONDS,
    q3End: Math.max(...w12) + GAME_END_SECONDS
  };
}

async function fetchPlayers(ids) {
  const players = {};
  const list = [...ids];
  for (let i = 0; i < list.length; i += 100) {
    const data = await apiExport('players', `&PLAYERS=${list.slice(i, i + 100).join(',')}`);
    asArray(data.players?.player).forEach(p => {
      players[p.id] = { id: p.id, name: p.name, position: p.position, team: p.team };
    });
  }
  return players;
}

// "Royals, Jalen" (WR, KCC) → "Jalen Royals (WR, KCC)"
function playerLabel(p) {
  if (!p) return null;
  const [last, first] = p.name.split(',').map(s => s.trim());
  return `${first ? `${first} ${last}` : last} (${p.position}${p.team ? `, ${p.team}` : ''})`;
}

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};

async function main() {
  const settings = readJson(SETTINGS_PATH, null);
  if (!settings) throw new Error('token_settings.json is missing or not valid JSON');
  const previous = readJson(OUT_PATH, {});
  const leagueData = readJson(DATA_PATH, {});
  const warnings = [];

  const league = await leagueExport('league');
  const names = Object.fromEntries(asArray(league.league?.franchises?.franchise).map(f => [f.id, f.name]));
  if (Object.keys(names).length !== 12) throw new Error(`league export gave ${Object.keys(names).length} franchises`);

  let bounds;
  try {
    bounds = await seasonBounds();
  } catch (err) {
    if (!previous.bounds) throw err;
    bounds = previous.bounds;
    warnings.push(`NFL schedule unavailable (${err.message}); reused the last quarter boundaries.`);
  }

  const tx = await leagueExport('transactions', '&TRANS_TYPE=TRADE,BBID_WAIVER&DAYS=400');
  const all = asArray(tx.transactions?.transaction);
  const mflTrades = all.filter(t => t.type === 'TRADE');
  const mflClaims = all.filter(t => t.type === 'BBID_WAIVER');

  const splitCodes = s => (s || '').split(',').map(c => c.trim()).filter(Boolean);
  const claimParts = c => {
    const [added, bid, dropped] = (c.transaction || '').split('|');
    return { added: splitCodes(added)[0], bid: parseFloat(bid) || 0, dropped: splitCodes(dropped) };
  };
  const ids = new Set();
  mflTrades.forEach(t => [...splitCodes(t.franchise1_gave_up), ...splitCodes(t.franchise2_gave_up)]
    .filter(c => /^\d+$/.test(c)).forEach(c => ids.add(c)));
  mflClaims.forEach(c => { const p = claimParts(c); [p.added, ...p.dropped].filter(Boolean).forEach(id => ids.add(id)); });
  const players = await fetchPlayers(ids);

  // ---- Trades
  const voidedTrades = Object.fromEntries((settings.voided_trades || []).map(v => [String(v.timestamp), v.reason]));
  const trades = mflTrades.map(t => {
    const ts = Number(t.timestamp);
    const month = etDate(ts).slice(0, 7);
    const { snap, fallback } = snapshotFor(month);
    const lookup = {
      year: YEAR,
      pickValues: snap?.pickValues || {},
      teamName: fid => names[fid] || fid,
      player: id => {
        const p = players[id];
        if (!p) return null;
        return { name: playerLabel(p), value: playerValue(snap, p, settings.ktc_names?.[id]) };
      }
    };
    const v = valueTrade([splitCodes(t.franchise1_gave_up), splitCodes(t.franchise2_gave_up)], lookup);
    const voidReason = voidedTrades[t.timestamp];
    if (fallback) warnings.push(`Trade ${etDate(ts)}: no KTC-${month}.json, valued with KTC-${snap?.month || 'none'}.`);
    if (v.missing.length) {
      warnings.push(`Trade ${etDate(ts)} ${names[t.franchise]} / ${names[t.franchise2]}: no value for ${v.missing.join(', ')}.`);
    }
    return {
      id: t.timestamp,
      date: etDate(ts),
      period: periodOf(ts, bounds),
      ktc_month: snap?.month || null,
      ...(t.comments ? { comments: t.comments } : {}),
      sides: [t.franchise, t.franchise2].map((fid, i) => ({ franchise: fid, name: names[fid] || fid, ...v.sides[i] })),
      total_value: v.total,
      tokens_each: v.tokens,
      tokens_awarded: voidReason ? 0 : v.tokens,
      ...(voidReason ? { voided: true, void_reason: voidReason } : {})
    };
  }).sort((a, b) => b.id - a.id);

  // ---- Waivers ($ minimum, 5 per quarter)
  const voidedClaims = new Map((settings.voided_waivers || [])
    .map(v => [`${v.timestamp}|${v.franchise}`, v.reason]));
  const claims = mflClaims.map(c => {
    const p = claimParts(c);
    const key = `${c.timestamp}|${c.franchise}`;
    return {
      id: `${c.timestamp}|${c.franchise}|${p.added}`,
      timestamp: Number(c.timestamp),
      date: etDate(Number(c.timestamp)),
      franchise: c.franchise,
      name: names[c.franchise] || c.franchise,
      player_id: p.added,
      player: playerLabel(players[p.added]) || `Player #${p.added}`,
      ...(p.dropped.length ? { dropped: p.dropped.map(id => playerLabel(players[id]) || `Player #${id}`).join(', ') } : {}),
      bid: p.bid,
      ...(voidedClaims.has(key) ? { voided: true, note: voidedClaims.get(key) } : {})
    };
  });
  scoreWaivers(claims, bounds, { minBid: settings.waiver_min_bid ?? 25, cap: settings.waiver_quarter_cap ?? 5 });
  claims.sort((a, b) => b.timestamp - a.timestamp);
  const waivers = claims.filter(c => c.bid >= (settings.waiver_min_bid ?? 25));

  // ---- Promotions (data.json P&R after Weeks 4, 8, 12)
  const promotions = [];
  Object.entries(leagueData.promotion_relegation || {}).forEach(([q, pr]) => {
    Object.entries(pr.promoted || {}).forEach(([fromDiv, fid]) => {
      const tokens = PROMOTION_TOKENS[fromDiv]?.[Number(q) - 1];
      if (!tokens) return;
      promotions.push({
        quarter: Number(q), period: `Q${q}`, franchise: fid, name: names[fid] || fid,
        from: fromDiv === '01' ? 'Middle' : 'Lower', to: fromDiv === '01' ? 'Upper' : 'Middle', tokens
      });
    });
  });

  // ---- Manual adjustments
  const adjustments = (settings.adjustments || []).map(a => ({
    ...a,
    name: names[a.franchise] || a.franchise,
    period: periodOf(Date.parse(`${a.date}T12:00:00-05:00`) / 1000, bounds)
  }));

  // ---- Balances
  const teams = {};
  Object.keys(names).sort().forEach(fid => {
    teams[fid] = {
      name: names[fid], start: settings.starting_balances?.[fid] || 0,
      trades: 0, waivers: 0, promotions: 0, adjustments: 0, total: 0,
      by_period: Object.fromEntries(PERIODS.map(p => [p, { trades: 0, waivers: 0, promotions: 0, adjustments: 0 }]))
    };
  });
  const add = (fid, period, kind, n) => {
    if (!teams[fid] || !n) return;
    teams[fid][kind] += n;
    teams[fid].by_period[period][kind] += n;
  };
  trades.forEach(t => t.sides.forEach(s => add(s.franchise, t.period, 'trades', t.tokens_awarded)));
  waivers.forEach(w => add(w.franchise, w.period, 'waivers', w.tokens));
  promotions.forEach(p => add(p.franchise, p.period, 'promotions', p.tokens));
  adjustments.forEach(a => add(a.franchise, a.period, 'adjustments', a.tokens));
  Object.values(teams).forEach(t => { t.total = t.start + t.trades + t.waivers + t.promotions + t.adjustments; });

  const iso = ts => new Date(ts * 1000).toISOString();
  const out = {
    version: 2,
    season: YEAR,
    last_updated: new Date().toISOString(),
    rules: {
      waiver_min_bid: settings.waiver_min_bid ?? 25,
      waiver_quarter_cap: settings.waiver_quarter_cap ?? 5,
      trade_tier_size: 7500,
      faab_value_per_dollar: 10
    },
    bounds,
    periods: [
      { id: 'Offseason', label: 'Offseason (paid with Q1)', end: iso(bounds.week1Start) },
      { id: 'Q1', label: 'Q1 (Weeks 1-4)', start: iso(bounds.week1Start), end: iso(bounds.q1End) },
      { id: 'Q2', label: 'Q2 (Weeks 5-8)', start: iso(bounds.q1End), end: iso(bounds.q2End) },
      { id: 'Q3', label: 'Q3 (Weeks 9-12)', start: iso(bounds.q2End), end: iso(bounds.q3End) },
      { id: 'Post', label: 'Postseason', start: iso(bounds.q3End) }
    ],
    teams,
    trades,
    waivers,
    promotions,
    adjustments,
    // Snapshot files the dashboard's "Monthly KTC Values" tab can load.
    ktc_months: availableMonths().filter(m => m >= `${YEAR}-01`),
    warnings
  };
  // last_updated is the last time the ledger changed, so a quiet day leaves the file (and git) untouched.
  const sameAsBefore = JSON.stringify({ ...out, last_updated: null }) === JSON.stringify({ ...previous, last_updated: null });
  if (sameAsBefore) out.last_updated = previous.last_updated;
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`);

  report(out, previous);
}

// Console log and GitHub Actions run summary: balances plus anything new since the last run.
function report(out, previous) {
  const prevTrades = new Set(previous.version === 2 ? previous.trades.map(t => t.id) : []);
  const prevWaivers = new Set(previous.version === 2 ? previous.waivers.map(w => w.id) : []);
  const newTrades = out.trades.filter(t => !prevTrades.has(t.id));
  const newWaivers = out.waivers.filter(w => !prevWaivers.has(w.id));

  const lines = [`## PBR tokens (${etDate(Date.now() / 1000)})`, ''];
  if (newTrades.length || newWaivers.length) {
    lines.push('### New since last run', '');
    newTrades.forEach(t => {
      const [a, b] = t.sides;
      lines.push(`- Trade ${t.date}: ${a.name} (${a.value.toLocaleString()}) ↔ ${b.name} (${b.value.toLocaleString()}), ` +
        `total ${t.total_value.toLocaleString()} → ${t.voided ? `voided (${t.void_reason})` : `+${t.tokens_awarded} each`}`);
      t.sides.forEach(s => lines.push(`  - ${s.name} gave: ${s.assets.map(x => `${x.name} ${x.value.toLocaleString()}${x.note ? ` [${x.note}]` : ''}`).join('; ')}`));
    });
    newWaivers.forEach(w => lines.push(`- Waiver ${w.date}: ${w.name} added ${w.player} for $${w.bid} → +${w.tokens}${w.note ? ` (${w.note})` : ''}`));
  } else {
    lines.push('No new trades or qualifying waiver claims since the last run.');
  }
  lines.push('', '| Team | Start | Trades | Waivers | Promotions | Adj. | Total |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  Object.values(out.teams).sort((a, b) => b.total - a.total).forEach(t => {
    lines.push(`| ${t.name} | ${t.start} | ${t.trades} | ${t.waivers} | ${t.promotions} | ${t.adjustments} | **${t.total}** |`);
  });
  if (out.warnings.length) lines.push('', '### Warnings', '', ...out.warnings.map(w => `- ⚠️ ${w}`));

  const text = lines.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

main().catch(err => {
  console.error(`❌ Token tracker failed: ${err.message}`);
  process.exit(1);
});
