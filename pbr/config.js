/**
 * PBR league configuration (single source of truth for new code).
 * Older pbr/ scripts still repeat the league ID (see CLAUDE.md Known Issues).
 */

// MFL league ID for PBR. Fixed; never read from env vars or secrets.
const LEAGUE_ID = '63213';

// Season year. Workflows may override via MFL_YEAR / SEASON_YEAR.
const YEAR = process.env.MFL_YEAR || process.env.SEASON_YEAR || '2026';

// MFL host serving this league.
const MFL_HOST = 'www42.myfantasyleague.com';

const DIVISION_NAMES = { '00': 'Upper Division', '01': 'Middle Division', '02': 'Lower Division' };
const DIVISION_ORDER = ['00', '01', '02'];

// Q1 scheduling slots #1-#4 per division, from the postseason finish
// (reference/PBR Schedule MFL Importer.xlsx, Division Placements, column Q1).
// Later quarters are derived by P&R (pbr_rules.js nextQuarterSlots).
const Q1_SLOTS = {
  '00': ['0003', '0002', '0001', '0005'], // Shankly's Ghost, BattleBots, Orcan Terror, Peaky Fookin Blinders
  '01': ['0009', '0012', '0010', '0006'], // Springfield Isotopes, 2 Roops 1 Silva, The Meaty Ogres, Ted Lasso
  '02': ['0004', '0008', '0011', '0007']  // Hamsterdam, The Two Tones, The Wild Cards, Norsemen
};

module.exports = { LEAGUE_ID, YEAR, MFL_HOST, DIVISION_NAMES, DIVISION_ORDER, Q1_SLOTS };
