import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import MflCommishClient from './mfl_commish_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * End-of-Week Commissioner Automation Script (commish_automation.js)
 * Executes weekly eliminations, drops cut rosters on MFL,
 * records weekly prize winners, and updates data.json.
 */
export async function runCommishAutomation() {
  console.log('🏈 Starting Tuesday 5:00 AM ET Commissioner Automation...');

  const client = new MflCommishClient();
  await client.login();

  // Load current data.json
  const dataPath = path.join(__dirname, 'data.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error('data.json not found in ultimate/ directory.');
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const currentWeek = data.currentWeek || 1;
  console.log(`Processing End-of-Week Actions for Week ${currentWeek}...`);

  // Initialize data collections if missing
  if (!data.eliminatedTeams) data.eliminatedTeams = {};
  if (!data.weeklyWinners) data.weeklyWinners = {};

  // 1. Determine Elimination Count based on League Rules
  // Weeks 2-5: Cut bottom 2 teams
  // Weeks 6-16: Cut bottom 1 team
  let cutCount = 0;
  if (currentWeek >= 2 && currentWeek <= 5) {
    cutCount = 2;
  } else if (currentWeek >= 6 && currentWeek <= 16) {
    cutCount = 1;
  }

  // 2. Identify Active / Surviving Franchises
  const eliminated = data.eliminatedTeams || {};
  const activeFranchises = Object.keys(data.franchises || {}).filter(fid => !eliminated[fid]);

  console.log(`Active teams remaining: ${activeFranchises.length}`);

  if (cutCount > 0 && activeFranchises.length > 0) {
    // 3. Calculate Rolling 2-Week Scores for Active Teams
    // Week W total = Prior Single (W-1) + Current Single (W)
    const priorWeekNum = currentWeek - 1;
    const weeklySingleScores = data.weeklySingleScores || {};

    const teamScores = activeFranchises.map(fid => {
      const priorScore = priorWeekNum >= 1 ? (weeklySingleScores[priorWeekNum]?.[fid] || 0) : 0;
      const currentDone = data.liveDetails?.[fid]?.doneScore || 0;
      const totalScore = parseFloat((priorScore + currentDone).toFixed(2));
      return { fid, name: data.franchises[fid]?.name || fid, priorScore, currentDone, totalScore };
    });

    // Sort ascending (lowest score first)
    teamScores.sort((a, b) => a.totalScore - b.totalScore);

    const cutTeams = teamScores.slice(0, cutCount);
    console.log(`✂️ Chopping ${cutCount} team(s) for Week ${currentWeek}:`, cutTeams.map(t => `${t.name} (${t.totalScore} pts)`).join(', '));

    // 4. Execute MFL Roster Drops (C=MANDROP)
    for (const victim of cutTeams) {
      console.log(`Executing MANDROP on MFL for Franchise ${victim.fid} (${victim.name})...`);
      try {
        await client.submitCommishForm('csetup', {
          C: 'MANDROP',
          FRANCHISE_ID: victim.fid
        });
        console.log(`✅ Roster dropped successfully on MFL for ${victim.name}.`);
      } catch (err) {
        console.error(`❌ Failed to drop roster for ${victim.name}:`, err.message);
      }

      // Record in eliminatedTeams
      data.eliminatedTeams[victim.fid] = {
        week: currentWeek,
        score: victim.totalScore,
        name: victim.name,
        eliminatedAt: new Date().toISOString()
      };
    }
  }

  // 5. Award High Score Prize for Current Single Week
  const singleWeekScores = data.weeklySingleScores?.[currentWeek] || {};
  let topScore = -1;
  let winnerFid = null;

  Object.entries(singleWeekScores).forEach(([fid, score]) => {
    if (score > topScore) {
      topScore = score;
      winnerFid = fid;
    }
  });

  if (winnerFid) {
    const winnerName = data.franchises[winnerFid]?.name || winnerFid;
    console.log(`🏆 Week ${currentWeek} Single-Week Winner: ${winnerName} (${topScore} pts)`);
    data.weeklyWinners[currentWeek] = {
      fid: winnerFid,
      name: winnerName,
      score: topScore
    };
  }

  // Mark live mode as false for the finished week
  data.isLive = false;
  data.lastUpdated = new Date().toISOString();

  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`🎉 Commissioner Automation complete for Week ${currentWeek}! Updated data.json saved.`);
}

runCommishAutomation().catch(err => {
  console.error('Fatal error in commish_automation.js:', err);
  process.exit(1);
});
