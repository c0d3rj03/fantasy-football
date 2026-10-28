import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LEAGUE_ID, SEASON_YEAR, MFL_HOST } from './config.js';
import { getCutCount, getWeeklyPrize } from './league_schedule.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * End-of-Week Commissioner Automation Script (commish_automation.js)
 * Records weekly eliminations and prize winners in data.json.
 * MFL makes the guillotine cut itself (from Week 7 on), so this script never
 * writes to MFL. It only reads the rosters export to confirm MFL's cut.
 */

// Cut counts and prize tiers live in league_schedule.js; re-exported for existing callers.
export { getCutCount, getWeeklyPrize };

function normalizeArray(item) {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

/**
 * Read-only MFL rosters export. Returns franchise IDs with 0 players.
 */
async function fetchEmptyRosterFids() {
  const query = new URLSearchParams({ TYPE: 'rosters', L: LEAGUE_ID, JSON: '1' }).toString();
  const res = await fetch(`https://${MFL_HOST}/${SEASON_YEAR}/export?${query}`, {
    headers: {
      'User-Agent': 'UltimateGuillotineCommish/1.0 (+https://github.com/c0d3rj03/fantasy-football)'
    }
  });
  if (!res.ok) {
    throw new Error(`MFL API error [rosters]: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return normalizeArray(json.rosters?.franchise)
    .filter(f => normalizeArray(f.player).length === 0)
    .map(f => f.id);
}

// Teams alive during the week: not eliminated, or eliminated by this week's own cut.
function teamsAliveInWeek(data, week) {
  const eliminated = data.eliminatedTeams || {};
  return Object.keys(data.franchises || {}).filter(fid => {
    const cutWeek = eliminated[fid]?.eliminatedWeek ?? eliminated[fid]?.week;
    return !eliminated[fid] || cutWeek >= week;
  });
}

// Safeguards 2 and 3: the week must be final and use MFL's final weekly results.
// Returns each alive team's single and rolling score for the week.
function getFinalTeamScores(data, week) {
  const alive = teamsAliveInWeek(data, week);

  // Safeguard 2: every alive team's games for this week must be final.
  // This also catches a currentWeek that MFL has already rolled over.
  const unfinished = alive.filter(fid => {
    const live = data.liveDetails?.[fid];
    return live && (live.ytp > 0 || live.inGame > 0);
  });
  if (unfinished.length > 0) {
    throw new Error(`Week ${week} is not final: ${unfinished.length} active team(s) still have players yet to play or in game (${unfinished.join(', ')}).`);
  }

  // Safeguard 3: use MFL's final weekly results, never live points. Once MFL empties the
  // cut team's roster, its live points can read 0. Run the daily score sync first.
  const weeklySingleScores = data.weeklySingleScores || {};
  const missingFinal = alive.filter(fid => weeklySingleScores[week]?.[fid] === undefined);
  if (missingFinal.length > 0) {
    throw new Error(`Week ${week} final results are missing in data.json for ${missingFinal.length} active team(s) (${missingFinal.join(', ')}). Run the daily score sync first.`);
  }

  return alive.map(fid => {
    const priorScore = week > 1 ? (weeklySingleScores[week - 1]?.[fid] || 0) : 0;
    const singleScore = weeklySingleScores[week][fid];
    const rollingScore = parseFloat((priorScore + singleScore).toFixed(2));
    return { fid, name: data.franchises[fid]?.name || fid, singleScore, rollingScore };
  });
}

/**
 * Records the week's single-week high score as its prize item (mutates data).
 * Needs only final scores, not MFL's cut. Returns the winner, or null if the week
 * was already recorded or has no weekly prize.
 */
export function recordWeeklyWinner(data, week = data.currentWeek || 1) {
  if (!data.weeklyWinners) data.weeklyWinners = {};
  if (data.weeklyWinners[week]) {
    console.log(`⏭️ Week ${week} high score already recorded.`);
    return null;
  }
  const prize = getWeeklyPrize(week);
  if (!prize) return null;

  const ranked = getFinalTeamScores(data, week).sort((a, b) => b.singleScore - a.singleScore);
  const winner = ranked[0];
  if (!winner || winner.singleScore <= 0) return null;
  if (ranked[1] && ranked[1].singleScore === winner.singleScore) {
    console.warn(`⚠️ Tie for Week ${week} high score (${winner.singleScore} pts). Recorded ${winner.name}; review manually.`);
  }
  console.log(`🏆 Week ${week} Single-Week Winner: ${winner.name} (${winner.singleScore} pts)`);
  data.weeklyWinners[week] = {
    franchiseId: winner.fid,
    franchiseName: winner.name,
    score: winner.singleScore,
    prize
  };
  return data.weeklyWinners[week];
}

/**
 * Records the week's guillotine cut(s) (mutates data). Throws, without changing
 * anything, if a safeguard fails. Returns null if the cut was already recorded.
 */
export function recordCuts(data, emptyRosterFids, week = data.currentWeek || 1) {
  if (!data.eliminatedTeams) data.eliminatedTeams = {};
  const eliminated = data.eliminatedTeams;

  // Safeguard 1: never cut for the same week twice.
  if (Object.values(eliminated).some(e => e.eliminatedWeek === week || e.week === week)) {
    console.log(`⏭️ Week ${week} cut already recorded.`);
    return null;
  }

  const cutCount = getCutCount(week);
  if (cutCount === 0) return [];

  const sorted = getFinalTeamScores(data, week).sort((a, b) => a.rollingScore - b.rollingScore);
  const cutTeams = sorted.slice(0, cutCount);

  // Safeguard 4: MFL makes the cut. Its newly emptied rosters must match ours exactly.
  const mflCut = emptyRosterFids.filter(fid => !eliminated[fid]).sort();
  const ourCut = cutTeams.map(t => t.fid).sort();
  if (mflCut.length === 0) {
    throw new Error(`MFL has not made the Week ${week} cut yet (no newly empty rosters). Expected: ${ourCut.join(', ')}. Rerun later.`);
  }
  if (mflCut.join(',') !== ourCut.join(',')) {
    throw new Error(`Cut mismatch for Week ${week}: MFL emptied [${mflCut.join(', ')}], rolling scores say [${ourCut.join(', ')}]. Review manually.`);
  }

  // Warn on a tie at the cut line (RULES.md defines no elimination tiebreaker)
  if (sorted[cutCount] && sorted[cutCount].rollingScore === sorted[cutCount - 1].rollingScore) {
    console.warn(`⚠️ Tie at the cut line (${sorted[cutCount].rollingScore} pts). MFL's choice was used.`);
  }

  console.log(`✂️ Week ${week} cut(s):`, cutTeams.map(t => `${t.name} (${t.rollingScore} pts)`).join(', '));
  for (const victim of cutTeams) {
    eliminated[victim.fid] = {
      eliminatedWeek: week,
      rollingScore: victim.rollingScore,
      singleScore: victim.singleScore,
      franchiseName: victim.name
    };
  }
  return cutTeams;
}

/**
 * Applies end-of-week results to data (mutates it). The weekly high score is
 * recorded first, so a cut safeguard failure (MFL not done yet) never holds up
 * the prize. On a cut failure, data keeps the winner and the error is returned.
 * Returns null if the week was already fully processed.
 */
export function processEndOfWeek(data, emptyRosterFids) {
  const winner = recordWeeklyWinner(data);
  let cutTeams = null;
  let cutError = null;
  try {
    cutTeams = recordCuts(data, emptyRosterFids);
  } catch (err) {
    cutError = err;
  }
  if (!winner && !cutTeams && !cutError) {
    console.log(`⏭️ Week ${data.currentWeek || 1} was already processed. Nothing to do.`);
    return null;
  }
  if (!cutError) data.isLive = false;
  data.lastUpdated = new Date().toISOString();
  return { winner, cutTeams, cutError };
}

export async function runCommishAutomation() {
  console.log('🏈 Starting Tuesday 5:00 AM ET Commissioner Automation...');

  // Load current data.json
  const dataPath = path.join(__dirname, 'data.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error('data.json not found in ultimate/ directory.');
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  console.log(`Processing End-of-Week Actions for Week ${data.currentWeek || 1}...`);

  const emptyRosterFids = getCutCount(data.currentWeek || 1) > 0 ? await fetchEmptyRosterFids() : [];
  const result = processEndOfWeek(data, emptyRosterFids);
  if (!result) return;

  // Save whatever was recorded (the weekly high score survives a cut safeguard failure).
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
  if (result.cutError) throw result.cutError;
  console.log(`🎉 Commissioner Automation complete for Week ${data.currentWeek}! Updated data.json saved.`);
}

// Run only when executed directly (lets tests import processEndOfWeek)
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCommishAutomation().catch(err => {
    console.error('Fatal error in commish_automation.js:', err);
    process.exit(1);
  });
}
