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

// Weekly High Score Prizes ($10 FAAB W1-4, Cash W5-16)
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

// Helper: Sleep for retries
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch data from MFL API with automated retries and Browser User-Agent header
 */
async function fetchMFL(type, extraParams = {}, retries = 3) {
  const params = new URLSearchParams({
    TYPE: type,
    L: LEAGUE_ID,
    JSON: '1',
    ...extraParams
  });
  const url = `${MFL_BASE_URL}?${params.toString()}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      return data;
    } catch (err) {
      console.warn(`[Attempt ${attempt}/${retries}] Failed fetching ${type}: ${err.message}`);
      if (attempt === retries) throw err;
      await sleep(1000 * attempt); // exponential backoff
    }
  }
}

export async function fetchGuillotineData() {
  console.log(`Fetching MFL API data for League ID: ${LEAGUE_ID}, Year: ${SEASON_YEAR}...`);

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
  console.log(`Loaded ${Object.keys(franchises).length} franchises from MFL.`);

  // 2. Fetch Active Rosters
  const rosterData = await fetchMFL('rosters');
  const rostersRaw = rosterData?.rosters?.franchise || [];
  const activeRosters = {};
  rostersRaw.forEach(r => {
    activeRosters[r.id] = Array.isArray(r.player) ? r.player : (r.player ? [r.player] : []);
  });

  // 3. Fetch Weekly Scores (Weeks 1 to 17)
  const mflRawWeeklyScores = {};
  const weeklySingleScores = {};
  let lastCompletedWeek = 0;

  for (let w = 1; w <= 17; w++) {
    try {
      const res = await fetchMFL('weeklyResults', { W: w.toString() });
      const wr = res?.weeklyResults;
      if (!wr) continue;

      let franchiseScores = [];

      if (wr.matchup) {
        const matchupsList = Array.isArray(wr.matchup) ? wr.matchup : [wr.matchup];
        matchupsList.forEach(m => {
          const list = Array.isArray(m.franchise) ? m.franchise : (m.franchise ? [m.franchise] : []);
          franchiseScores.push(...list);
        });
      } else if (wr.franchise) {
        franchiseScores = Array.isArray(wr.franchise) ? wr.franchise : [wr.franchise];
      }

      if (franchiseScores.length === 0) continue;

      mflRawWeeklyScores[w] = {};
      weeklySingleScores[w] = {};
      let hasScores = false;

      franchiseScores.forEach(f => {
        const score = parseFloat(f.score || 0);
        mflRawWeeklyScores[w][f.id] = score;
        if (score > 0) hasScores = true;
      });

      if (hasScores) {
        lastCompletedWeek = w;

        // Convert MFL weeklyResults scores into true standalone single-week scores.
        // On MFL, because prior week scores are pushed via score adjustments (adjustScores),
        // MFL's weeklyResults for Week w (w >= 2) returns: (Week w single) + (Week w-1 single).
        // Therefore: singleScore[w] = mflRawScore[w] - singleScore[w-1].
        Object.keys(mflRawWeeklyScores[w]).forEach(fid => {
          const mflVal = mflRawWeeklyScores[w][fid];
          if (w === 1) {
            weeklySingleScores[1][fid] = parseFloat(mflVal.toFixed(2));
          } else {
            const priorSingle = weeklySingleScores[w - 1]?.[fid] || 0;
            const single = mflVal >= priorSingle ? (mflVal - priorSingle) : mflVal;
            weeklySingleScores[w][fid] = parseFloat(single.toFixed(2));
          }
        });

        console.log(`  -> Week ${w}: Single-week scores derived for ${Object.keys(weeklySingleScores[w]).length} franchises.`);
      }
    } catch (e) {
      console.warn(`  -> Week ${w}: No completed results yet.`);
    }
  }

  console.log(`Latest completed week detected: Week ${lastCompletedWeek}`);

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
      const rollingTotal = w === 1 ? single : parseFloat((prior + single).toFixed(2));

      rollingScores[w][fid] = { single, prior, rollingTotal };

      if (single > topSingleScore) {
        topSingleScore = single;
        topSingleFranchise = fid;
      }
    });

    // Record weekly high score winner (based on standalone single-week score)
    if (topSingleFranchise && WEEKLY_PRIZES[w] && topSingleScore > 0) {
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
    isLive: false,
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

// Execute when run directly via CLI
const scriptPath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (invokedPath === path.resolve(scriptPath)) {
  fetchGuillotineData().catch(err => {
    console.error('Fatal error running fetcher:', err);
    process.exit(1);
  });
}
