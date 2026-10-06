import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEAGUE_ID = process.env.LEAGUE_ID || '25918';
const SEASON_YEAR = process.env.SEASON_YEAR || '2026';
const MFL_BASE_URL = `https://www42.myfantasyleague.com/${SEASON_YEAR}/export`;

async function fetchMFL(type, params = {}) {
  const query = new URLSearchParams({
    TYPE: type,
    L: LEAGUE_ID,
    JSON: '1',
    ...params
  }).toString();

  const url = `${MFL_BASE_URL}?${query}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'UltimateGuillotineFetcher/2.0 (+https://github.com/c0d3rj03/fantasy-football)'
    }
  });

  if (!response.ok) {
    throw new Error(`MFL API error [${type}]: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

function normalizeArray(item) {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

export async function runFetcher() {
  console.log(`Starting MFL Data Fetcher (Daily Batch Mode) for League ID: ${LEAGUE_ID}, Year: ${SEASON_YEAR}...`);

  // 1. Fetch League Metadata & Franchises
  const leagueDataRaw = await fetchMFL('league');
  const leagueInfo = leagueDataRaw.league;
  const rawFranchises = normalizeArray(leagueInfo.franchises?.franchise);

  const franchises = {};
  rawFranchises.forEach(f => {
    franchises[f.id] = {
      id: f.id,
      name: f.name,
      icon: f.icon || '',
      logo: f.logo || ''
    };
  });

  // 2. Fetch Live Scoring Data from MFL with DETAILS=1
  let liveScoringWeek = null;
  let rawLiveFranchises = [];

  try {
    const liveScoringRaw = await fetchMFL('liveScoring', { DETAILS: '1' });
    if (liveScoringRaw && liveScoringRaw.liveScoring) {
      liveScoringWeek = parseInt(liveScoringRaw.liveScoring.week, 10);
      rawLiveFranchises = normalizeArray(liveScoringRaw.liveScoring.franchise);
    }
  } catch (err) {
    console.warn('Could not fetch MFL liveScoring:', err.message);
  }

  // Read existing data.json
  const existingDataPath = path.join(__dirname, 'data.json');
  let existingData = {};
  if (fs.existsSync(existingDataPath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(existingDataPath, 'utf-8'));
    } catch (e) {}
  }

  // 3. Fetch Weekly Scores for completed/historical weeks
  const weeklySingleScores = {};
  const maxWeeksToFetch = 17;
  let latestCompletedWeek = 0;

  for (let w = 1; w <= maxWeeksToFetch; w++) {
    try {
      const scoreData = await fetchMFL('weeklyResults', { W: w.toString() });
      const resultsObj = scoreData.weeklyResults;
      if (!resultsObj) continue;

      let rawFranchiseScores = [];
      if (resultsObj.franchise) {
        rawFranchiseScores = normalizeArray(resultsObj.franchise);
      } else if (resultsObj.matchup) {
        const matchups = normalizeArray(resultsObj.matchup);
        matchups.forEach(m => {
          rawFranchiseScores.push(...normalizeArray(m.franchise));
        });
      }

      if (rawFranchiseScores.length === 0) continue;

      let weekHasScores = false;
      const mflScoresThisWeek = {};

      rawFranchiseScores.forEach(f => {
        if (f.id && f.score !== undefined && f.score !== '') {
          const scoreVal = parseFloat(f.score);
          if (!isNaN(scoreVal) && scoreVal > 0) {
            mflScoresThisWeek[f.id] = scoreVal;
            weekHasScores = true;
          }
        }
      });

      if (weekHasScores) {
        weeklySingleScores[w] = {};

        // Calculate single week score:
        // W=1: Single = MFL_Score
        // W>=2: MFL_Score(W) = Single(W-1) + Single(W) => Single(W) = MFL_Score(W) - Single(W-1)
        Object.keys(mflScoresThisWeek).forEach(fid => {
          const scoreVal = mflScoresThisWeek[fid];
          if (w === 1) {
            weeklySingleScores[1][fid] = parseFloat(scoreVal.toFixed(2));
          } else {
            const priorSingle = weeklySingleScores[w - 1]?.[fid] || 0;
            const singleScore = Math.max(0, scoreVal - priorSingle);
            weeklySingleScores[w][fid] = parseFloat(singleScore.toFixed(2));
          }
        });

        if (!liveScoringWeek || w < liveScoringWeek) {
          latestCompletedWeek = w;
        }
      }
    } catch (err) {
      console.warn(`Error fetching Week ${w} results:`, err.message);
    }
  }

  // Preserve existing historical weeklySingleScores if API returns empty for past weeks
  if (existingData.weeklySingleScores) {
    Object.keys(existingData.weeklySingleScores).forEach(wKey => {
      const wNum = parseInt(wKey, 10);
      if (!weeklySingleScores[wNum] || Object.keys(weeklySingleScores[wNum]).length === 0) {
        weeklySingleScores[wNum] = existingData.weeklySingleScores[wKey];
      }
    });
  }

  const currentWeek = liveScoringWeek || (latestCompletedWeek + 1);

  // 4. Process Daily Batch Details for the active week
  const liveDetails = {};
  let totalYTPInLeague = 0;
  let totalFinishedInLeague = 0;

  if (rawLiveFranchises.length > 0) {
    const priorWeekNum = currentWeek - 1;

    rawLiveFranchises.forEach(lf => {
      const fid = lf.id;
      const totalLiveScore = parseFloat(lf.score || 0);

      const priorScoreCarryover = priorWeekNum >= 1 ? (weeklySingleScores[priorWeekNum]?.[fid] || 0) : 0;
      const currentWeekTotalPoints = Math.max(0, totalLiveScore - priorScoreCarryover);

      const players = normalizeArray(lf.player);
      const starters = players.filter(p => {
        const st = (p.status || '').toLowerCase();
        return st === 'starter' || st === 's' || !p.status;
      });

      let finishedCount = 0;
      let ytpCount = 0;

      if (starters.length > 0) {
        starters.forEach(p => {
          const secsRaw = p.gameSecondsRemaining;
          const secs = (secsRaw !== undefined && secsRaw !== null && secsRaw !== '') ? parseInt(secsRaw, 10) : 3600;

          if (secs < 3600) {
            finishedCount++;
          } else {
            ytpCount++;
          }
        });
      } else {
        ytpCount = parseInt(lf.playersYetToPlay || 0, 10);
        finishedCount = parseInt(lf.playersGameFinished || 0, 10) + parseInt(lf.playersCurrentlyPlaying || 0, 10);
      }

      totalYTPInLeague += ytpCount;
      totalFinishedInLeague += finishedCount;

      liveDetails[fid] = {
        doneScore: parseFloat(currentWeekTotalPoints.toFixed(2)),
        liveScore: 0.00,
        ytp: ytpCount,
        inGame: 0,
        finished: finishedCount
      };
    });
  }

  // 5. Determine "isLive" (In Progress) Week Status
  let isWeekInProgress = false;
  if (totalYTPInLeague > 0 || (totalFinishedInLeague > 0 && totalYTPInLeague > 0)) {
    isWeekInProgress = true;
  } else if (totalFinishedInLeague > 0 && totalYTPInLeague === 0) {
    isWeekInProgress = false;
  }

  // 6. Construct & Save Payload
  const finalPayload = {
    leagueId: LEAGUE_ID,
    seasonYear: SEASON_YEAR,
    currentWeek: currentWeek,
    isLive: isWeekInProgress,
    lastUpdated: new Date().toISOString(),
    franchises: franchises,
    weeklySingleScores: weeklySingleScores,
    liveDetails: liveDetails,
    eliminatedTeams: existingData.eliminatedTeams || {},
    weeklyWinners: existingData.weeklyWinners || {}
  };

  fs.writeFileSync(existingDataPath, JSON.stringify(finalPayload, null, 2), 'utf-8');
  console.log(`Updated data.json! Week: ${currentWeek}, In Progress: ${isWeekInProgress}, Total YTP: ${totalYTPInLeague}`);
}

runFetcher().catch(err => {
  console.error('Fatal error in fetcher.js:', err);
  process.exit(1);
});
