/**
 * PBR Participation Token rules as pure functions (no network, no files). RULES.md §8.
 * Used by token_tracker.js. Asset values follow the 2026 Token Tracker sheet
 * (DraftPickValues and FAABTokenValue tabs) so the numbers match what owners are used to.
 */

const TIER_SIZE = 7500;

// Trade tokens to EACH team: 2 for 0-7,499 total KTC value, +2 per further 7,500.
function tradeTokens(totalValue) {
  return 2 * (Math.floor(Math.max(0, totalValue) / TIER_SIZE) + 1);
}

// FAAB trade value: $1 = 10 KTC ($100 is about a late 3rd).
const FAAB_VALUE_PER_DOLLAR = 10;

// Promotion tokens after quarter q (1-3), by the division the team moved up from.
const PROMOTION_TOKENS = {
  '01': [1, 2, 3], // Middle → Upper
  '02': [1, 3, 5]  // Lower → Middle
};

/**
 * Value of a whole draft round in `year` from a KTC snapshot's pick values
 * (keys like "2027 Early 1st"). Rounds 1-4 average KTC's Early/Mid/Late values.
 * KTC has no 5th or 6th; like the sheet, round 5 = R4 × (R4 / R3) and round 6 = R5 × (R5 / R4).
 * Returns null when the snapshot has no values for that year.
 */
function roundValue(pickValues, year, round) {
  if (round >= 5) {
    const r4 = roundValue(pickValues, year, round - 1);
    const r3 = roundValue(pickValues, year, round - 2);
    return r4 && r3 ? r4 * (r4 / r3) : null;
  }
  const suffix = ['1st', '2nd', '3rd', '4th'][round - 1];
  const vals = ['Early', 'Mid', 'Late'].map(t => pickValues[`${year} ${t} ${suffix}`]).filter(v => v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/**
 * Value of a known current-year pick (MFL DP_<round-1>_<pick-1>). Rounds 1-4: picks 1-4 use KTC Early,
 * 5-8 Mid, 9-12 Late. Bonus picks: x.13 = average of x.12 and (x+1).01; x.14 = average of x.13 and (x+1).01.
 * Rounds 5-6 use roundValue for every pick.
 */
function currentPickValue(pickValues, year, round, pick) {
  if (round >= 5) return roundValue(pickValues, year, round);
  if (pick >= 13) {
    const before = currentPickValue(pickValues, year, round, pick - 1);
    const next = currentPickValue(pickValues, year, round + 1, 1);
    return before && next ? (before + next) / 2 : null;
  }
  const suffix = ['1st', '2nd', '3rd', '4th'][round - 1];
  const tier = pick <= 4 ? 'Early' : pick <= 8 ? 'Mid' : 'Late';
  return pickValues[`${year} ${tier} ${suffix}`] || null;
}

const ordinal = n => n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n] || 'th');

/**
 * Parses one MFL trade asset code.
 *   "14847"            player
 *   "DP_4_9"           current-year pick 5.10 (both zero-based)
 *   "FP_0001_2027_2"   future pick: original team, year, round
 *   "BB_350"           $350 of FAAB (blind bid dollars)
 */
function parseAsset(code) {
  let m;
  if ((m = code.match(/^DP_(\d+)_(\d+)$/))) return { kind: 'pick', round: +m[1] + 1, pick: +m[2] + 1 };
  if ((m = code.match(/^FP_(\d{4})_(\d{4})_(\d+)$/))) return { kind: 'future', team: m[1], year: m[2], round: +m[3] };
  if ((m = code.match(/^BB_([\d.]+)$/))) return { kind: 'faab', amount: parseFloat(m[1]) };
  if (/^\d+$/.test(code)) return { kind: 'player', id: code };
  return { kind: 'unknown' };
}

/**
 * Values both sides of a trade.
 *   sides: [[code, ...], [code, ...]] (what each team gave up)
 *   lookup: { player(id) → { name, value } | null, pickValues, year (league year), teamName(fid) }
 * FAAB for FAAB: only the net difference counts (RULES.md §8), so the smaller amount is taken off both sides.
 * Returns { sides: [{ assets: [{ code, name, value, note }], value }], total, tokens, missing: [codes] }.
 */
function valueTrade(sides, lookup) {
  const faab = sides.map(codes => codes.map(parseAsset).filter(a => a.kind === 'faab')
    .reduce((s, a) => s + a.amount, 0));
  const faabOffset = Math.min(...faab);
  const missing = [];

  const valued = sides.map((codes, i) => {
    let faabLeft = faabOffset;
    const assets = codes.map(code => {
      const a = parseAsset(code);
      let name = code, value = null, note = '';
      if (a.kind === 'player') {
        const p = lookup.player(a.id);
        name = p?.name || `Player #${a.id}`;
        value = p?.value ?? null;
        if (value === null) note = 'no KTC value';
      } else if (a.kind === 'pick') {
        name = `${lookup.year} Pick ${a.round}.${String(a.pick).padStart(2, '0')}`;
        value = currentPickValue(lookup.pickValues, lookup.year, a.round, a.pick);
      } else if (a.kind === 'future') {
        const orig = lookup.teamName ? lookup.teamName(a.team) : a.team;
        name = `${a.year} ${ordinal(a.round)} Round Pick (${orig})`;
        value = roundValue(lookup.pickValues, a.year, a.round);
      } else if (a.kind === 'faab') {
        const netted = Math.min(faabLeft, a.amount);
        faabLeft -= netted;
        name = `$${a.amount} FAAB`;
        value = (a.amount - netted) * FAAB_VALUE_PER_DOLLAR;
        if (netted) note = `$${netted} netted against FAAB coming back`;
      }
      if (value === null) {
        missing.push(code);
        if (!note) note = 'no value found';
      }
      return { code, name, value: Math.round(value || 0), ...(note ? { note } : {}) };
    });
    return { assets, value: assets.reduce((s, a) => s + a.value, 0) };
  });

  const total = valued.reduce((s, v) => s + v.value, 0);
  return { sides: valued, total, tokens: tradeTokens(total), missing };
}

/**
 * Token period of a transaction timestamp (seconds), given period ends from the NFL schedule:
 * bounds = { week1Start, q1End, q2End, q3End }. Offseason trades are paid out with Q1.
 */
function periodOf(ts, bounds) {
  if (ts < bounds.week1Start) return 'Offseason';
  if (ts <= bounds.q1End) return 'Q1';
  if (ts <= bounds.q2End) return 'Q2';
  if (ts <= bounds.q3End) return 'Q3';
  return 'Post';
}

// Waiver-token quarter: offseason claims share Q1's cap of 5.
const waiverQuarter = period => (period === 'Offseason' ? 'Q1' : period);

/**
 * Waiver tokens: 1 per successful claim of at least `minBid`, at most `cap` per team per quarter,
 * counted in date order. claims: [{ franchise, timestamp, bid, voided }] (mutated: tokens, note).
 */
function scoreWaivers(claims, bounds, { minBid = 25, cap = 5 } = {}) {
  const counts = {};
  [...claims].sort((a, b) => a.timestamp - b.timestamp).forEach(c => {
    c.period = periodOf(c.timestamp, bounds);
    const q = waiverQuarter(c.period);
    const key = `${c.franchise}|${q}`;
    if (c.voided) { c.tokens = 0; return; }
    if (c.bid < minBid) { c.tokens = 0; return; }
    counts[key] = (counts[key] || 0) + 1;
    if (counts[key] > cap) {
      c.tokens = 0;
      c.note = `quarter cap of ${cap} reached`;
    } else {
      c.tokens = 1;
    }
  });
  return claims;
}

module.exports = {
  TIER_SIZE, FAAB_VALUE_PER_DOLLAR, PROMOTION_TOKENS,
  tradeTokens, roundValue, currentPickValue, parseAsset, valueTrade, periodOf, waiverQuarter, scoreWaivers
};
