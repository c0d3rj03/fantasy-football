import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MflCommishClient } from './mfl_commish_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runWeeklyCommishAutomation() {
  console.log('=== Ultimate Guillotine Tuesday 4:30 AM ET Administrative Pipeline ===');

  // 1. Read data.json
  const dataPath = path.join(__dirname, 'data.json');
  if (!fs.existsSync(dataPath)) {
    console.error(`Fatal: data.json not found at ${dataPath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const currentWeek = data.currentWeek || 1;
  const targetWeek = currentWeek + 1; // Upcoming week settings to configure

  console.log(`Processing completed Week ${currentWeek} -> Configuring upcoming Week ${targetWeek}...`);

  const client = new MflCommishClient(data.seasonYear || '2026', data.leagueId || '25918');

  try {
    // Authenticate commissioner session
    await client.login(process.env.MFL_USERNAME, process.env.MFL_PASSWORD);

    // STEP 1: Handle 2nd Cut Execution for Multi-Cut Weeks (Weeks 2-6)
    if (currentWeek >= 2 && currentWeek <= 6) {
      console.log(`\n--- Evaluating 2nd Cut for Week ${currentWeek} ---`);
      const choppedThisWeek = Object.entries(data.eliminatedTeams || {})
        .filter(([_, info]) => info.eliminatedWeek === currentWeek);

      // In Weeks 2-6, 2 teams are cut total. MFL native auto-cuts the #1 lowest team at 4:00 AM ET.
      // If we have 2 chopped teams identified in data.json, the 2nd lowest team needs manual MANDROP at 4:30 AM ET.
      if (choppedThisWeek.length >= 2) {
        const secondCut = choppedThisWeek[1]; // [franchiseId, info]
        const fid = secondCut[0];
        const info = secondCut[1];
        console.log(`Executing 2nd MANDROP cut for Franchise ${fid} (${info.franchiseName})...`);
        await client.executeManDrop(fid);
      } else {
        console.log('Fewer than 2 chopped teams detected or already processed. Skipping 2nd MANDROP.');
      }
    }

    // STEP 2: Roster & Lineup Capacity Expansion
    console.log(`\n--- Expanding Roster & Lineup Capacity for Week ${targetWeek} ---`);
    await client.updateRosterAndLineup(targetWeek);

    // STEP 3: Push Prior Week Single-Week Scores into Target Week (FSCOREADJ)
    const priorScores = data.weeklySingleScores?.[currentWeek] || {};
    if (Object.keys(priorScores).length > 0) {
      await client.pushScoreAdjustments(targetWeek, priorScores);
    } else {
      console.warn(`No single-week scores found for Week ${currentWeek}. Skipping score carryover.`);
    }

    // STEP 4: Award Weekly High Score FAAB Prize (Weeks 1-4)
    const weeklyWinner = data.weeklyWinners?.[currentWeek];
    if (weeklyWinner && weeklyWinner.prize?.type === 'FAAB' && currentWeek <= 4) {
      console.log(`\n--- Awarding Weekly High Score FAAB Prize for Week ${currentWeek} ---`);
      await client.awardFAABPrize(weeklyWinner.franchiseId, weeklyWinner.prize.amount, currentWeek);
    }

    console.log('\n=== Tuesday Commissioner Automation Pipeline Complete! ===');
  } catch (err) {
    console.error('Fatal Error during Commissioner Automation Pipeline:', err.message);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runWeeklyCommishAutomation().catch(err => {
    console.error('Unhandled Execution Error:', err);
    process.exit(1);
  });
}
