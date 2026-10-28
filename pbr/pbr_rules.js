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
    const teams = [...(standings[div] || [])];
    teams.sort((a, b) => compareKeys(promotionKey(b, season), promotionKey(a, season)));
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
  for (const div of DIVISION_ORDER) {
    const ids = divisions[div] || [];
    if (div === '00') {
      const avg = Object.fromEntries(ids.map(id => [id, (season[id]?.pf || 0) / 12]));
      const midpoint = ids.reduce((sum, id) => sum + avg[id], 0) / (ids.length || 1);
      for (const id of ids) bonus[id] = avg[id] > midpoint ? round2(5 * (avg[id] - midpoint)) : 0;
    } else {
      const avg = Object.fromEntries(ids.map(id => [id, (season[id]?.pp || 0) / 12]));
      const ref = Math.max(...ids.map(id => avg[id]));
      for (const id of ids) bonus[id] = round2(5 * (ref - avg[id]));
    }
  }
  return bonus;
}

const round2 = n => Math.round(n * 100) / 100;

module.exports = {
  QUARTER_WEEKS,
  inDivisionVPs,
  promotionRelegation,
  nextQuarterSlots,
  quarterSchedule,
  scheduleLine,
  postseasonBonus
};
