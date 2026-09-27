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

// 2026 Official League Data Fallback (from 2026 Ultimate Season Mgmt)
const FALLBACK_2026_FRANCHISES = {
  "0001": { id: "0001", name: "DMC Gonna Run Thru U" },
  "0002": { id: "0002", name: "Chopping Rod" },
  "0003": { id: "0003", name: "Questionable Descisions" },
  "0004": { id: "0004", name: "Slayden" },
  "0005": { id: "0005", name: "Ichabod Crane" },
  "0006": { id: "0006", name: "PBR superstar" },
  "0007": { id: "0007", name: "Chico's Bail Bonds" },
  "0008": { id: "0008", name: "Moore Bijan Mustard, please!" },
  "0009": { id: "0009", name: "Tight Ends" },
  "0010": { id: "0010", name: "Big Blue Bus" },
  "0011": { id: "0011", name: "Purple Reign" },
  "0012": { id: "0012", name: "The Elite" },
  "0013": { id: "0013", name: "The Crushers" },
  "0014": { id: "0014", name: "Team Glen H" },
  "0015": { id: "0015", name: "Iron Wolves" },
  "0016": { id: "0016", name: "Team David H" },
  "0017": { id: "0017", name: "The Headless Horsemen" },
  "0018": { id: "0018", name: "What smells?" },
  "0019": { id: "0019", name: "Cream Of The Crop" },
  "0020": { id: "0020", name: "TBD" },
  "0021": { id: "0021", name: "Bang bang from the bay!" },
  "0022": { id: "0022", name: "Ultimate Last Man Standing" },
  "0023": { id: "0023", name: "FantasyDiva" },
  "0024": { id: "0024", name: "Mar-a-Lago Monsters" }
};

const FALLBACK_2026_SCORES = {
  1: {
    "0001": 178.83, "0002": 176.71, "0003": 171.34, "0004": 152.90, "0005": 134.77,
    "0006": 126.35, "0007": 120.33, "0008": 124.12, "0009": 119.34, "0010": 122.67,
    "0011": 113.03, "0012": 125.30, "0013": 112.46, "0014": 103.17, "0015": 108.95,
    "0016": 100.77, "0017": 91.85,  "0018": 89.27,  "0019": 76.85,  "0020": 87.24,
    "0021": 97.45,  "0022": 86.97,  "0023": 64.18,  "0024": 81.83
  },
  2: {
    "0001": 136.36, "0002": 99.35,  "0003": 102.32, "0004": 108.06, "0005": 123.09,
    "0006": 139.66, "0007": 119.79, "0008": 102.01, "0009": 111.49, "0010": 103.61,
    "0011": 121.51, "0012": 82.22,  "0013": 107.20, "0014": 119.11, "0015": 100.02,
    "0016": 107.14, "0017": 119.71, "0018": 99.35,  "0019": 123.16, "0020": 92.54,
    "0021": 68.90,  "0022": 86.68,  "0023": 128.15, "0024": 83.74
  }
};

async function fetchMFL(type, extraParams = {}) {
  const params = new URLSearchParams({
    TYPE: type,
    L: LEAGUE_ID,
    JSON: '1',
    ...extraParams
  });
  const url = `${MFL_BASE_URL}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  if (!res.ok) {
    throw new Error(`MFL API error ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

function normalizeArray(item) {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

export async function fetchGuillotineData() {
  console.log(`Fetching MFL data for League ID: ${LEAGUE_ID}, Year: ${SEASON_YEAR}...`);

  let franchises = {};
  let activeRosters = {};
  let weeklySingleScores = {};
  let lastCompletedWeek = 0;

  // 1. Fetch League & Franchise Info
  try {
    const leagueData = await fetchMFL('league');
    const rawList = leagueData?.league?.franchises?.franchise;
    const franchisesRaw = normalizeArray(rawList);
    
    franchisesRaw.forEach(f => {
      franchises[f.id] = {
        id: f.id,
        name: f.name,
        icon: f.icon || '',
        logo: f.logo || ''
      };
    });
  } catch (e) {
    console.warn('MFL League API unavailable, using 2026 fallback franchises:', e.message);
  }

  if (Object.keys(franchises).length === 0) {
    franchises = { ...FALLBACK_2026_FRANCHISES };
  }

  // 2. Fetch Active Rosters
  try {
    const rosterData = await fetchMFL('rosters');
    const rawRosters = rosterData?.rosters?.franchise;
    const rostersRaw = normalizeArray(rawRosters);
    
    rostersRaw.forEach(r => {
      activeRosters[r.id] = normalizeArray(r.player);
    });
  } catch (e) {
    console.warn('MFL Rosters API unavailable, using empty active rosters fallback.');
  }

  // 3. Fetch Historical Weekly Scores (Weeks 1 to 17)
  for (let w = 1; w <= 17; w++) {
    try {
      const res = await fetchMFL('weeklyResults', { W: w.toString() });
      const wr = res?.weeklyResults;
      if (!wr) continue;

      let franchiseScores = [];
      if (wr.matchup) {
        normalizeArray(wr.matchup).forEach(m => {
          franchiseScores.push(...normalizeArray(m.franchise));
        });
      } else if (wr.franchise) {
        franchiseScores = normalizeArray(wr.franchise);
      }

      if (franchiseScores.length === 0) continue;

      weeklySingleScores[w] = {};
      let hasScores = false;

      // Deduct prior cumulative scores to isolate single-week performance for Week w
      franchiseScores.forEach(f => {
        const mflCumulativeScore = parseFloat(f.score || 0);
        
        let priorCumulative = 0;
        for (let k = 1; k < w; k++) {
          priorCumulative += (weeklySingleScores[k]?.[f.id] || 0);
        }

        const singleWeekScore = Math.max(0, mflCumulativeScore - priorCumulative);
        weeklySingleScores[w][f.id] = parseFloat(singleWeekScore.toFixed(2));
        if (mflCumulativeScore > 0) hasScores = true;
      });

      if (hasScores) {
        lastCompletedWeek = w;
        console.log(`  -> Historical Week ${w}: Loaded single-week scores for ${Object.keys(weeklySingleScores[w]).length} franchises.`);
      }
    } catch (e) {
      // API call silent retry / fallback
    }
  }

  // Fallback to 2026 official weekly scoring if live fetch returned empty scores
  if (lastCompletedWeek === 0 || !weeklySingleScores[1]) {
    console.log('Historical scores not detected via API, populating 2026 official scores...');
    weeklySingleScores = JSON.parse(JSON.stringify(FALLBACK_2026_SCORES));
    lastCompletedWeek = 2;
  }

  // 4. Fetch Live Scoring for Current In-Progress Week
  let liveScoringWeek = null;
  let rawLiveFranchises = [];
  let isLiveGameActive = false;
  let liveDetails = {};

  let totalYtp = 0;
  let totalInGame = 0;
  let totalFinished = 0;

  try {
    const liveScoringRaw = await fetchMFL('liveScoring');
    if (liveScoringRaw && liveScoringRaw.liveScoring) {
      liveScoringWeek = parseInt(liveScoringRaw.liveScoring.week, 10);
      rawLiveFranchises = normalizeArray(liveScoringRaw.liveScoring.franchise);
    }
  } catch (err) {
    console.warn('Could not fetch MFL liveScoring:', err.message);
  }

  const activeWeekNum = liveScoringWeek || (lastCompletedWeek + 1);

  if (rawLiveFranchises.length > 0) {
    rawLiveFranchises.forEach(lf => {
      const fid = lf.id;
      
      let doneScore = 0;
      let liveScore = 0;
      let ytpCount = 0;
      let inGameCount = 0;
      let finishedCount = 0;

      const playerList = normalizeArray(lf.players?.player || lf.player);
      const starters = playerList.filter(p => p.status === 'starter' || !p.status);

      starters.forEach(p => {
        const pScore = parseFloat(p.score || 0);
        const secs = parseInt(p.gameSecondsRemaining, 10);

        if (secs === 0) {
          doneScore += pScore;
          finishedCount++;
        } else if (secs > 0 && secs < 3600) {
          liveScore += pScore;
          inGameCount++;
        } else {
          ytpCount++;
        }
      });

      // Check if team is cut/eliminated (0 YTP, 0 LIVE, 0 DONE)
      const isCut = (ytpCount === 0 && inGameCount === 0 && finishedCount === 0);

      totalYtp += ytpCount;
      totalInGame += inGameCount;
      totalFinished += finishedCount;

      liveDetails[fid] = {
        doneScore: parseFloat(doneScore.toFixed(2)),
        liveScore: parseFloat(liveScore.toFixed(2)),
        ytp: ytpCount,
        inGame: inGameCount,
        finished: finishedCount,
        isCut: isCut
      };

      if (!isCut) {
        const fname = franchises[fid]?.name || fid;
        console.log(`[Team ${fid}] ${fname.padEnd(28)} | YTP: ${ytpCount} | LIVE: ${inGameCount} | DONE: ${finishedCount} || DoneScore: ${doneScore.toFixed(2)} | LiveScore: ${liveScore.toFixed(2)}`);
      }
    });

    isLiveGameActive = (totalInGame > 0);
  }

  // Week is completely finished when YTP = 0 AND InGame = 0 AND Finished > 0 across all active teams
  const isWeekComplete = (totalYtp === 0 && totalInGame === 0 && totalFinished > 0);
  if (isWeekComplete && liveScoringWeek) {
    lastCompletedWeek = Math.max(lastCompletedWeek, liveScoringWeek);
  }

  const currentWeek = activeWeekNum;
  console.log(`Current Week locked to: Week ${currentWeek} (Live: ${isLiveGameActive}, Week Complete: ${isWeekComplete})`);

  // 5. Calculate Rolling Two-Week Scores & Track Eliminations
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

  // 6. Save Aggregated Payload
  const outputData = {
    leagueId: LEAGUE_ID,
    seasonYear: SEASON_YEAR,
    lastUpdated: new Date().toISOString(),
    currentWeek: currentWeek,
    isLive: isLiveGameActive,
    isWeekComplete: isWeekComplete,
    franchises,
    rosters: activeRosters,
    weeklySingleScores,
    rollingScores,
    liveDetails,
    eliminatedTeams,
    weeklyWinners,
    aliveFranchiseIds
  };

  const outputPath = path.join(__dirname, 'data.json');
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');
  console.log(`Successfully generated ultimate guillotine data payload at: ${outputPath}`);

  return outputData;
}

if (process.argv[1] && fileURLToPath(import.meta.url).includes(path.basename(process.argv[1]))) {
  fetchGuillotineData().catch(err => {
    console.error('Fatal error running fetcher:', err);
    process.exit(1);
  });
}
