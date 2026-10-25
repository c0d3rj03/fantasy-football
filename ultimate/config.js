/**
 * Ultimate Guillotine League configuration (single source of truth).
 * Every ultimate/ script imports the league ID and season from here.
 */

// MFL league ID for the Ultimate league. Fixed; never read from env vars or secrets.
export const LEAGUE_ID = '25918';

// Season year. Workflows may override via the SEASON_YEAR env var.
export const SEASON_YEAR = process.env.SEASON_YEAR || '2026';

// MFL host serving this league.
export const MFL_HOST = 'www42.myfantasyleague.com';
