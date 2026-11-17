/**
 * PBR league rules as pure functions (no network, no files). RULES.md sections:
 *   §5 in-division top-2 VP, Promotion & Relegation, scheduling slots, schedule matrix
 *   §6 postseason regular-season bonus
 * Used by mfl_scores_fetcher.js (data.json) and commish_mfl_actions.js (MFL writes),
 * so the dashboard and MFL always apply the same rules.
 */
const { DIVISION_ORDER } = require('./config.js');

const QUARTER_WEEKS = { 1: [1, 2, 3, 4], 2: [5, 6, 7, 8], 3: [9, 10, 11, 12] };

/**
 * In-division "Battle Royale" VP: the top 2 scores in a division earn 1 VP each.
 * Teams tied across a VP slot split the VP that the tied places carry
 * (tie for 2nd between two teams: 0.5 each; three teams tied for 1st: 2/3 each).
 * teams: [{ id, score }]. Returns { id: vp }.
 */
function inDivisionVPs(teams, slots = 2) {
  const sorted = [...teams].sort((a, b) => (b.score || 0) - (a.score || 0));
  const vps = {};
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && (sorted[j].score || 0) === (sorted[i].score || 0)) j++;
    const share = Math.max(0, Math.min(j, slots) - i) / (j - i);
    for (let k = i; k < j; k++) vps[sorted[k].id] = Math.round(share * 10000) / 10000;
    i = j;
  }
  return vps;
}

const winPct = t => {
  const games = (t.wins || 0) + (t.losses || 0) + (t.ties || 0);
  return games ? ((t.wins || 0) + 0.5 * (t.ties || 0)) / games : 0;
};

// Promotion order (highest first): VP → quarter PF → quarter win % → season PF → season win %.
function promotionKey(t, season) {
  const s = season[t.id] || {};
  return [t.vp, t.pf, winPct(t), s.pf || 0, winPct(s)];
}

// Relegation order (lowest first): PP → VP → quarter PF → quarter win % → season PF → season win %.
function relegationKey(t, season) {
  return [t.pp, ...promotionKey(t, season)];
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] - b[i];
  }
  return 0;
}

/**
 * A division's quarter standings in promotion order (1st place first), so the dashboard,
 * the quarter prizes and P&R agree on who won a division.
 */
function rankStandings(teams, season) {
  return [...teams].sort((a, b) => compareKeys(promotionKey(b, season), promotionKey(a, season)));
}

/**
 * Promotion & Relegation after a quarter (RULES.md §5).
 * standings: { divCode: [{ id, vp, pf, pp, wins, losses, ties }] } for the quarter.
 * season: { id: { pf, wins, losses, ties } } season to date.
 * Returns { promoted: {divCode: id}, relegated: {divCode: id}, ranked: {divCode: [ids]},
 *           coinFlips: [text] } where ranked is each division's standings order.
 */
function promotionRelegation(standings, season) {
  const ranked = {};
  const promoted = {};
  const relegated = {};
  const coinFlips = [];
  for (const div of DIVISION_ORDER) {
    const teams = rankStandings(standings[div] || [], season);
    ranked[div] = teams.map(t => t.id);
    const index = DIVISION_ORDER.indexOf(div);

    if (index > 0 && teams.length > 0) {
      promoted[div] = teams[0].id;
      if (teams.length > 1 && compareKeys(promotionKey(teams[0], season), promotionKey(teams[1], season)) === 0) {
        coinFlips.push(`Promotion from ${div}: ${teams[0].id} and ${teams[1].id} are tied on every tiebreaker`);
      }
    }
    if (index < DIVISION_ORDER.length - 1) {
      // A team being promoted can't also be relegated.
      const candidates = teams.filter(t => t.id !== promoted[div]);
      candidates.sort((a, b) => compareKeys(relegationKey(a, season), relegationKey(b, season)));
      if (candidates.length > 0) {
        relegated[div] = candidates[0].id;
        if (candidates.length > 1 && compareKeys(relegationKey(candidates[0], season), relegationKey(candidates[1], season)) === 0) {
          coinFlips.push(`Relegation from ${div}: ${candidates[0].id} and ${candidates[1].id} are tied on every tiebreaker`);
        }
      }
    }
  }
  return { promoted, relegated, ranked, coinFlips };
}

/**
 * Next quarter's scheduling slots (#1-#4 per division). Teams staying keep their
 * standings order; a relegated team takes slot #1 of the lower division, a
 * promoted team slot #4 of the higher one. This reproduces the Q1 → Q2 slots in
 * the Schedule MFL Importer sheet.
 */
function nextQuarterSlots(pr) {
  const slots = {};
  DIVISION_ORDER.forEach((div, index) => {
    const staying = pr.ranked[div].filter(id => id !== pr.promoted[div] && id !== pr.relegated[div]);
    const fromAbove = index > 0 ? pr.relegated[DIVISION_ORDER[index - 1]] : undefined;
    const fromBelow = index < DIVISION_ORDER.length - 1 ? pr.promoted[DIVISION_ORDER[index + 1]] : undefined;
    slots[div] = [fromAbove, ...staying, fromBelow].filter(Boolean);
  });
  return slots;
}

/**
 * The quarter's 4-week H2H schedule (reference/PBR Schedule MFL Importer.xlsx,
 * Schedule Matrix): in quarter week k (0-3), Upper #i plays Middle #(i+k) and
 * Lower #(i+k), and Middle #i plays Lower #(i+k), slot numbers mod 4.
 * Returns [{ week, home, away }] in the sheet's row order (12 per week).
 */
function quarterSchedule(quarter, slots) {
  const [upper, middle, lower] = DIVISION_ORDER.map(div => slots[div]);
  const games = [];
  QUARTER_WEEKS[quarter].forEach((week, k) => {
    for (const [a, b] of [[upper, middle], [upper, lower], [middle, lower]]) {
      for (let i = 0; i < 4; i++) games.push({ week, home: a[i], away: b[(i + k) % 4] });
    }
  });
  return games;
}

// One line of the MFL schedule import box (options?O=168): "WW,FFFF,FFFF".
const scheduleLine = g => `${String(g.week).padStart(2, '0')},${g.home},${g.away}`;

/**
 * Postseason regular-season bonus (RULES.md §6), added to Week 13 scores.
 * season: { id: { pf, pp } } for all 12 weeks; divisions: { divCode: [ids] } after Q3 P&R.
 * Upper: 5 × (PF/12 − mean) for teams above the mean. Middle/Lower: 5 × (max PP/12 − PP/12).
 * Returns { id: bonus } rounded to 2 decimals (0 for teams with no bonus).
 */
function postseasonBonus(season, divisions) {
  const bonus = {};
  for (const detail of Object.values(postseasonBonusDetail(season, divisions))) {
    for (const t of detail.teams) bonus[t.id] = t.bonus;
  }
  return bonus;
}

/**
 * The same bonus with its working, for the dashboard. weeks = regular-season weeks the totals cover:
 * 12 once Week 12 is final; fewer for a projection from the season so far (per-week averages).
 * Returns { divCode: { stat: 'pf'|'pp', reference: midpoint (Upper) or top average (Middle/Lower),
 *   teams: [{ id, season_total, avg, diff, bonus }] } }. diff = avg − reference.
 */
function postseasonBonusDetail(season, divisions, weeks = 12) {
  const out = {};
  for (const div of DIVISION_ORDER) {
    const ids = divisions[div] || [];
    const stat = div === '00' ? 'pf' : 'pp';
    const avg = Object.fromEntries(ids.map(id => [id, (season[id]?.[stat] || 0) / weeks]));
    const reference = div === '00'
      ? ids.reduce((sum, id) => sum + avg[id], 0) / (ids.length || 1)
      : Math.max(...ids.map(id => avg[id]));
    const teams = ids.map(id => {
      const diff = avg[id] - reference;
      const bonus = div === '00' ? (diff > 0 ? round2(5 * diff) : 0) : (round2(-5 * diff) || 0);
      return { id, season_total: round2(season[id]?.[stat] || 0), avg: round2(avg[id]), diff: round2(diff), bonus };
    });
    out[div] = { stat, reference: round2(reference), teams };
  }
  return out;
}

const POSTSEASON_WEEKS = [13, 14, 15, 16, 17];
// RULES.md §6: the lowest cumulative total is out after Weeks 14 and 15; Week 17 decides 1st/2nd.
const POSTSEASON_CUTS = { 14: 4, 15: 3, 17: 2 };

/**
 * One division's postseason guillotine (RULES.md §6).
 * teams: [{ id, bonus, scores: { week: points } }] (scores without the bonus).
 * finalWeeks: weeks whose scores are final. A scored week that is not final is in progress:
 * its cut is shown as tentative (on_block) and decides nothing.
 * Returns { teams: [{ id, total, cumulative: {week: total}, place, out_after, on_block }], ties: [text] }
 * sorted best first (alive by total, then the eliminated by place).
 */
function postseasonGuillotine(teams, finalWeeks) {
  const finals = new Set(finalWeeks.map(Number));
  const rows = teams.map(t => ({ id: t.id, bonus: t.bonus || 0, scores: t.scores || {}, total: t.bonus || 0, cumulative: {}, place: null, out_after: null, on_block: false }));
  const ties = [];
  for (const week of POSTSEASON_WEEKS) {
    const alive = rows.filter(r => r.out_after == null);
    const scored = alive.some(r => r.scores[week] != null);
    if (!scored) break;
    alive.forEach(r => { r.total = round2(r.total + (r.scores[week] || 0)); r.cumulative[week] = r.total; });
    const place = POSTSEASON_CUTS[week];
    if (!place) continue;
    const order = [...alive].sort((a, b) => a.total - b.total);
    if (order.length > 1 && order[0].total === order[1].total) {
      ties.push(`Week ${week}: ${order[0].id} and ${order[1].id} tied at ${order[0].total} for the cut (no tiebreaker in the rules)`);
    }
    if (!finals.has(week)) { order[0].on_block = true; break; }
    order[0].place = place;
    order[0].out_after = week;
    if (week === 17 && order[1]) order[1].place = 1;
  }
  const alive = rows.filter(r => r.place == null).sort((a, b) => b.total - a.total);
  const out = rows.filter(r => r.place != null).sort((a, b) => a.place - b.place);
  return { teams: [...out.filter(r => r.place === 1), ...alive, ...out.filter(r => r.place !== 1)].map(({ scores, bonus, ...r }) => r), ties };
}

const round2 = n => Math.round(n * 100) / 100;

/**
 * Potential Points: the best legal lineup from a roster's points. Used for the tentative PP of a
 * week in progress (MFL's opt_pts only appears once the week is final).
 * players: [{ pos, score }]. rules: MFL league.starters, { count, position: [{ name, limit: "1-2" }] }
 * (PBR: 10 starters, QB 1-2, RB/WR/TE 1-7, i.e. QB, RB, WR, TE, Superflex, 5 Flex).
 * Fill each position's minimum with its best players, then the open slots with the best remaining
 * players while each position stays under its maximum (a partition matroid, so greedy is optimal).
 */
function optimalLineupPoints(players, rules) {
  const limits = {};
  for (const p of [].concat(rules?.position || [])) {
    const [min, max] = String(p.limit).split('-').map(Number);
    limits[p.name] = { min: min || 0, max: Number.isFinite(max) ? max : (min || 0) };
  }
  const byPos = {};
  for (const p of players) {
    if (!limits[p.pos]) continue;
    (byPos[p.pos] = byPos[p.pos] || []).push(Number(p.score) || 0);
  }
  Object.values(byPos).forEach(list => list.sort((a, b) => b - a));

  let open = Number(rules?.count) || 0;
  let total = 0;
  const used = {};
  for (const [pos, { min }] of Object.entries(limits)) {
    const take = (byPos[pos] || []).slice(0, Math.min(min, open));
    used[pos] = take.length;
    open -= take.length;
    total += take.reduce((s, v) => s + v, 0);
  }
  const rest = Object.entries(byPos)
    .flatMap(([pos, list]) => list.slice(used[pos], limits[pos].max))
    .sort((a, b) => b - a);
  total += rest.slice(0, Math.max(0, open)).reduce((s, v) => s + v, 0);
  return round2(total);
}

module.exports = {
  QUARTER_WEEKS,
  inDivisionVPs,
  rankStandings,
  promotionRelegation,
  nextQuarterSlots,
  quarterSchedule,
  scheduleLine,
  postseasonBonus,
  postseasonBonusDetail,
  postseasonGuillotine,
  POSTSEASON_WEEKS,
  optimalLineupPoints
};
