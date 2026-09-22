import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const LEAGUE_ID = process.env.LEAGUE_ID || '25918';
const SEASON_YEAR = process.env.SEASON_YEAR || '2026';
const MFL_BASE_URL = `https://www42.myfantasyleague.com/${SEASON_YEAR}/export`;

// Official 24-Team Elimination Schedule:
// W1: 0 cuts, W2-6: 2 cuts/wk, W7-16: 1 cut/wk, W17: 0 cuts (Final 4)
const ELIMINATION_SCHEDULE = {
  1: 0, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2,
  7: 1, 8: 1, 9: 1, 10: 1, 11: 1,
  12: 1, 13: 1, 14: 1, 15: 1, 16: 1, 17: 0
};

// Weekly High Score Prizes (\$10 FAAB W1-4, Cash W5-16)
const WEEKLY_PRIZES = {
  1: { type: 'FAAB', amount: 10 },
  2: { type: 'FAAB', amount: 10 },
  3: { type: 'FAAB', amount: 10 },
  4: { type: 'FAAB', amount: 10 },
  5: { type: 'CASH', amount: 15 },
  6: { type: 'CASH', amount: 15 },
  7: { type: 'CASH', amount: 15 },
  8: { type: 'CASH', amount: 15 },
  9: { type: 'CASH', amount: 30 },
  10: { type: 'CASH', amount: 30 },
  11: { type: 'CASH', amount: 30 },
  12: { type: 'CASH', amount: 30 },
  13: { type: 'CASH', amount: 50 },
  14: { type: 'CASH', amount: 50 },
  15: { type: 'CASH', amount: 50 },
  16: { type: 'CASH', amount: 50 }
};

async function fetchMFL(type, extraParams = {}) {
  const params = new URLSearchParams({
    TYPE: type,
    L: LEAGUE_ID,
    JSON: '1',
    ...extraParams
  });
  const url = `${MFL_BASE_URL}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MFL API error ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchGuillotineData() {
  console.log(`Fetching MFL data for League ID: ${LEAGUE_ID}, Year: ${SEASON_YEAR}...`);

  // 1. Fetch League & Franchise Info
  const leagueData = await fetchMFL('league');
  const franchisesRaw = leagueData?.league?.franchises?.franchise || [];
  
  const franchises = {};
  franchisesRaw.forEach(f => {
    franchises[f.id] = {
      id: f.id,
      name: f.name,
      icon: f.icon || '',
      logo: f.logo || ''
    };
  });

  // 2. Fetch Active Rosters
  const rosterData = await fetchMFL('rosters');
  const rostersRaw = rosterData?.rosters?.franchise || [];
  const activeRosters = {};
  rostersRaw.forEach(r => {
    activeRosters[r.id] = r.player || [];
  });

  // 3. Fetch Weekly Scores (Weeks 1 to 17)
  const weeklySingleScores = {};
  let lastCompletedWeek = 0;

  for (let w = 1; w <= 17; w++) {
    try {
      const res = await fetchMFL('weeklyResults', { W: w.toString() });
      const matchup = res?.weeklyResults?.matchup;
      if (!matchup) continue;

      weeklySingleScores[w] = {};
      let hasScores = false;

      const matchupsList = Array.isArray(matchup) ? matchup : [matchup];
      matchupsList.forEach(m => {
        const franchiseList = m.franchise || [];
        franchiseList.forEach(f => {
          const score = parseFloat(f.score || 0);
          weeklySingleScores[w][f.id] = score;
          if (score > 0) hasScores = true;
        });
      });

      if (hasScores) {
        lastCompletedWeek = w;
      }
    } catch (e) {
      console.warn(`Could not retrieve results for Week ${w}.`);
    }
  }

  // 4. Calculate Rolling Two-Week Scores & Track Eliminations
  const rollingScores = {};
  const eliminatedTeams = {};
  const weeklyWinners = {};
  let aliveFranchiseIds = Object.keys(franchises);

  for (let w = 1; w <= Math.max(lastCompletedWeek, 1); w++) {
    rollingScores[w] = {};
    const singleScores = weeklySingleScores[w] || {};

    let topSingleScore = -1;
    let topSingleFranchise = null;

    aliveFranchiseIds.forEach(fid => {
      const single = singleScores[fid] || 0;
      const prior = w > 1 ? (weeklySingleScores[w - 1]?.[fid] || 0) : 0;
      const rollingTotal = w === 1 ? single : prior + single;

      rollingScores[w][fid] = { single, prior, rollingTotal };

      if (single > topSingleScore) {
        topSingleScore = single;
        topSingleFranchise = fid;
      }
    });

    // Record weekly high score winner
    if (topSingleFranchise && WEEKLY_PRIZES[w]) {
      weeklyWinners[w] = {
        franchiseId: topSingleFranchise,
        franchiseName: franchises[topSingleFranchise]?.name,
        score: topSingleScore,
        prize: WEEKLY_PRIZES[w]
      };
    }

    // Process eliminations based on rolling 2-week total
    const cutsCount = ELIMINATION_SCHEDULE[w] || 0;
    if (cutsCount > 0 && w <= lastCompletedWeek) {
      const sortedAlive = [...aliveFranchiseIds].sort((a, b) => {
        return (rollingScores[w][a]?.rollingTotal || 0) - (rollingScores[w][b]?.rollingTotal || 0);
      });

      const choppedThisWeek = sortedAlive.slice(0, cutsCount);
      choppedThisWeek.forEach(fid => {
        eliminatedTeams[fid] = {
          eliminatedWeek: w,
          rollingScore: rollingScores[w][fid]?.rollingTotal || 0,
          singleScore: rollingScores[w][fid]?.single || 0,
          franchiseName: franchises[fid]?.name
        };
      });

      aliveFranchiseIds = aliveFranchiseIds.filter(fid => !choppedThisWeek.includes(fid));
    }
  }

  // 5. Save Aggregated Payload
  const outputData = {
    leagueId: LEAGUE_ID,
    seasonYear: SEASON_YEAR,
    lastUpdated: new Date().toISOString(),
    currentWeek: lastCompletedWeek || 1,
    franchises,
    rosters: activeRosters,
    weeklySingleScores,
    rollingScores,
    eliminatedTeams,
    weeklyWinners,
    aliveFranchiseIds
  };

  const outputPath = path.join(__dirname, 'data.json');
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');
  console.log(`Successfully generated ultimate guillotine data payload at: ${outputPath}`);

  return outputData;
}

if (process.argv === fileURLToPath(import.meta.url)) {
  fetchGuillotineData().catch(err => {
    console.error('Fatal error running fetcher:', err);
    process.exit(1);
  });
}