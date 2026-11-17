/**
 * Become a Dynasty (BaD) league configuration (single source of truth).
 * Every bad/ script imports the league ID and season from here.
 */

// MFL league ID for BaD. Fixed; never read from env vars or secrets.
export const LEAGUE_ID = '57713';

// Season year. Workflows may override via the SEASON_YEAR env var.
export const SEASON_YEAR = process.env.SEASON_YEAR || '2026';

// MFL host serving this league.
export const MFL_HOST = 'www42.myfantasyleague.com';

// Starting lineup (RULES: 2 QB, 2 RB, 3 WR, 1 TE, 3 flex from RB/WR/TE).
export const LINEUP = { QB: 2, RB: 2, WR: 3, TE: 1 };
export const FLEX = { count: 3, positions: ['RB', 'WR', 'TE'] };
