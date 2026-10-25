import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LEAGUE_ID, SEASON_YEAR, MFL_HOST } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * End-of-Week Commissioner Automation Script (commish_automation.js)
 * Records weekly eliminations and prize winners in data.json.
 * MFL makes the guillotine cut itself (from Week 7 on), so this script never
 * writes to MFL. It only reads the rosters export to confirm MFL's cut.
 */

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

/**
 * Applies end-of-week results to data (mutates it). Throws, without changing
 * anything, if any safeguard fails. Returns null if the week was already processed.
 */
export function processEndOfWeek(data, emptyRosterFids) {
  const currentWeek = data.currentWeek || 1;
  if (!data.eliminatedTeams) data.eliminatedTeams = {};
  if (!data.weeklyWinners) data.weeklyWinners = {};

  // Safeguard 1: never process the same week twice.
  const alreadyCut = Object.values(data.eliminatedTeams).some(e => e.eliminatedWeek === currentWeek || e.week === currentWeek);
  if (alreadyCut || data.weeklyWinners[currentWeek]) {
    console.log(`⏭️ Week ${currentWeek} was already processed. Nothing to do.`);
    return null;
  }

  const eliminated = data.eliminatedTeams;
  const activeFranchises = Object.keys(data.franchises || {}).filter(fid => !eliminated[fid]);
  console.log(`Active teams remaining: ${activeFranchises.length}`);

  // Safeguard 2: every active team's games for this week must be final.
  // This also catches a currentWeek that MFL has already rolled over.
  const unfinished = activeFranchises.filter(fid => {
    const live = data.liveDetails?.[fid];
    return live && (live.ytp > 0 || live.inGame > 0);
  });
  if (unfinished.length > 0) {
    throw new Error(`Week ${currentWeek} is not final: ${unfinished.length} active team(s) still have players yet to play or in game (${unfinished.join(', ')}).`);
  }

  // Safeguard 3: use MFL's final weekly results, never live points. Once MFL empties the
  // cut team's roster, its live points can read 0. Run the daily score sync first.
  const weeklySingleScores = data.weeklySingleScores || {};
  const missingFinal = activeFranchises.filter(fid => weeklySingleScores[currentWeek]?.[fid] === undefined);
  if (missingFinal.length > 0) {
    throw new Error(`Week ${currentWeek} final results are missing in data.json for ${missingFinal.length} active team(s) (${missingFinal.join(', ')}). Run the daily score sync first.`);
  }

  const priorWeekNum = currentWeek - 1;
  const teamScores = activeFranchises.map(fid => {
    const priorScore = priorWeekNum >= 1 ? (weeklySingleScores[priorWeekNum]?.[fid] || 0) : 0;
    const singleScore = weeklySingleScores[currentWeek][fid];
    const rollingScore = parseFloat((priorScore + singleScore).toFixed(2));
    return { fid, name: data.franchises[fid]?.name || fid, singleScore, rollingScore };
  });

  // Rolling 2-week elimination (lowest first)
  const cutCount = getCutCount(currentWeek);
  const cutTeams = [...teamScores].sort((a, b) => a.rollingScore - b.rollingScore).slice(0, cutCount);

  // Safeguard 4: MFL makes the cut. Its newly emptied rosters must match ours exactly.
  if (cutCount > 0) {
    const mflCut = emptyRosterFids.filter(fid => !eliminated[fid]).sort();
    const ourCut = cutTeams.map(t => t.fid).sort();
    if (mflCut.length === 0) {
      throw new Error(`MFL has not made the Week ${currentWeek} cut yet (no newly empty rosters). Expected: ${ourCut.join(', ')}. Rerun later.`);
    }
    if (mflCut.join(',') !== ourCut.join(',')) {
      throw new Error(`Cut mismatch for Week ${currentWeek}: MFL emptied [${mflCut.join(', ')}], rolling scores say [${ourCut.join(', ')}]. Review manually.`);
    }

    // Warn on a tie at the cut line (RULES.md defines no elimination tiebreaker)
    const sorted = [...teamScores].sort((a, b) => a.rollingScore - b.rollingScore);
    if (sorted[cutCount] && sorted[cutCount].rollingScore === sorted[cutCount - 1].rollingScore) {
      console.warn(`⚠️ Tie at the cut line (${sorted[cutCount].rollingScore} pts). MFL's choice was used.`);
    }
  }

  console.log(`✂️ Week ${currentWeek} cut(s):`, cutTeams.map(t => `${t.name} (${t.rollingScore} pts)`).join(', ') || 'none');
  for (const victim of cutTeams) {
    data.eliminatedTeams[victim.fid] = {
      eliminatedWeek: currentWeek,
      rollingScore: victim.rollingScore,
      singleScore: victim.singleScore,
      franchiseName: victim.name
    };
  }

  // Weekly high-score prize (single week, all teams active this week)
  const prize = getWeeklyPrize(currentWeek);
  if (prize) {
    const ranked = [...teamScores].sort((a, b) => b.singleScore - a.singleScore);
    const winner = ranked[0];
    if (winner && winner.singleScore > 0) {
      if (ranked[1] && ranked[1].singleScore === winner.singleScore) {
        console.warn(`⚠️ Tie for Week ${currentWeek} high score (${winner.singleScore} pts). Recorded ${winner.name}; review manually.`);
      }
      console.log(`🏆 Week ${currentWeek} Single-Week Winner: ${winner.name} (${winner.singleScore} pts)`);
      data.weeklyWinners[currentWeek] = {
        franchiseId: winner.fid,
        franchiseName: winner.name,
        score: winner.singleScore,
        prize
      };
    }
  }

  // Mark live mode as false for the finished week
  data.isLive = false;
  data.lastUpdated = new Date().toISOString();
  return { cutTeams };
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

  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`🎉 Commissioner Automation complete for Week ${data.currentWeek}! Updated data.json saved.`);
}

// Run only when executed directly (lets tests import processEndOfWeek)
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCommishAutomation().catch(err => {
    console.error('Fatal error in commish_automation.js:', err);
    process.exit(1);
  });
}
