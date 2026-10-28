/**
 * Ultimate Guillotine weekly schedule (RULES.md "Roster & Lineup Progression"
 * and reference/Ultimate Commish Duties.csv). Single source for the per-week
 * roster size and starting lineup limits that the commish scripts set on MFL.
 *
 * starters.min / starters.max are per-position limits, as on MFL's LINEUP page.
 * starters.total is the exact number of starters (min total = max total).
 */

const MIN_1QB_2WR = { QB: 1, RB: 2, WR: 2, TE: 1 };
const MIN_1QB_3WR = { QB: 1, RB: 2, WR: 3, TE: 1 };
const MIN_2QB = { QB: 2, RB: 2, WR: 3, TE: 1 };
const MIN_2QB_3RB = { QB: 2, RB: 3, WR: 3, TE: 1 };
const MIN_2QB_2TE = { QB: 2, RB: 3, WR: 3, TE: 2 };

export const WEEKLY_SCHEDULE = {
  1: { rosterSize: 8, starters: { total: 8, min: MIN_1QB_2WR, max: { QB: 1, RB: 4, WR: 4, TE: 3 } } },
  2: { rosterSize: 9, starters: { total: 8, min: MIN_1QB_2WR, max: { QB: 1, RB: 4, WR: 4, TE: 3 } } },
  3: { rosterSize: 9, starters: { total: 8, min: MIN_1QB_2WR, max: { QB: 1, RB: 4, WR: 4, TE: 3 } } },
  4: { rosterSize: 10, starters: { total: 8, min: MIN_1QB_2WR, max: { QB: 1, RB: 4, WR: 4, TE: 3 } } },
  5: { rosterSize: 10, starters: { total: 8, min: MIN_1QB_2WR, max: { QB: 1, RB: 4, WR: 4, TE: 3 } } },
  6: { rosterSize: 11, starters: { total: 9, min: MIN_1QB_2WR, max: { QB: 1, RB: 5, WR: 5, TE: 4 } } },
  7: { rosterSize: 11, starters: { total: 9, min: MIN_1QB_2WR, max: { QB: 1, RB: 5, WR: 5, TE: 4 } } },
  8: { rosterSize: 12, starters: { total: 10, min: MIN_1QB_3WR, max: { QB: 1, RB: 5, WR: 6, TE: 4 } } },
  9: { rosterSize: 12, starters: { total: 10, min: MIN_1QB_3WR, max: { QB: 1, RB: 5, WR: 6, TE: 4 } } },
  10: { rosterSize: 13, starters: { total: 11, min: MIN_2QB, max: { QB: 2, RB: 5, WR: 6, TE: 4 } } },
  11: { rosterSize: 13, starters: { total: 11, min: MIN_2QB, max: { QB: 2, RB: 5, WR: 6, TE: 4 } } },
  12: { rosterSize: 14, starters: { total: 12, min: MIN_2QB_3RB, max: { QB: 2, RB: 6, WR: 6, TE: 4 } } },
  13: { rosterSize: 14, starters: { total: 12, min: MIN_2QB_3RB, max: { QB: 2, RB: 6, WR: 6, TE: 4 } } },
  14: { rosterSize: 15, starters: { total: 13, min: MIN_2QB_2TE, max: { QB: 2, RB: 6, WR: 6, TE: 5 } } },
  15: { rosterSize: 15, starters: { total: 13, min: MIN_2QB_2TE, max: { QB: 2, RB: 6, WR: 6, TE: 5 } } },
  16: { rosterSize: 16, starters: { total: 14, min: MIN_2QB_2TE, max: { QB: 2, RB: 7, WR: 7, TE: 6 } } },
  17: { rosterSize: 16, starters: { total: 14, min: MIN_2QB_2TE, max: { QB: 2, RB: 7, WR: 7, TE: 6 } } }
};

export const POSITIONS = ['QB', 'RB', 'WR', 'TE'];

// Weeks 2-6: Cut bottom 2 teams. Weeks 7-16: Cut bottom 1 team. Week 17: none.
export function getCutCount(week) {
  if (week >= 2 && week <= 6) return 2;
  if (week >= 7 && week <= 16) return 1;
  return 0;
}

// Weekly high-score prize (single-week score). Week 17 has no weekly prize.
export function getWeeklyPrize(week) {
  if (week >= 1 && week <= 4) return { type: 'FAAB', amount: 10 };
  if (week >= 5 && week <= 8) return { type: 'cash', amount: 15 };
  if (week >= 9 && week <= 12) return { type: 'cash', amount: 30 };
  if (week >= 13 && week <= 16) return { type: 'cash', amount: 50 };
  return null;
}

// MFL writes a position limit as "N" when min = max, else "min-max".
export function formatLimit(min, max) {
  return min === max ? String(min) : `${min}-${max}`;
}
