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
      'User-Agent': 'UltimateGuillotineFetcher/1.1 (+https://github.com/c0d3rj03/fantasy-football)'
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

async function runFetcher() {
  console.log(`Starting MFL Data Fetcher for League ID: ${LEAGUE_ID}, Year: ${SEASON_YEAR}...`);

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

  // 2. Fetch Live Scoring Data from MFL
  let liveScoringWeek = null;
  let rawLiveFranchises = [];
  let isLiveGameActive = false;

  try {
    const liveScoringRaw = await fetchMFL('liveScoring');
    if (liveScoringRaw && liveScoringRaw.liveScoring) {
      liveScoringWeek = parseInt(liveScoringRaw.liveScoring.week, 10);
      rawLiveFranchises = normalizeArray(liveScoringRaw.liveScoring.franchise);
    }
  } catch (err) {
    console.warn('Could not fetch MFL liveScoring:', err.message);
  }

  // Read existing data.json for historical score preservation
  const existingDataPath = path.join(__dirname, 'data.json');
  let existingData = {};
  if (fs.existsSync(existingDataPath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(existingDataPath, 'utf-8'));
    } catch (e) {}
  }

  // 3. Fetch Weekly Scores for completed/historical weeks (Cumulative to Single-Week)
  const weeklySingleScores = existingData.weeklySingleScores || {};
  const maxWeeksToFetch = 17;
  let latestCompletedWeek = 0;
  const cumulativeScoresByWeek = {};

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
      const currentCumScores = {};

      rawFranchiseScores.forEach(f => {
        if (f.id && f.score !== undefined && f.score !== '') {
          const scoreVal = parseFloat(f.score);
          if (!isNaN(scoreVal) && scoreVal > 0) {
            currentCumScores[f.id] = scoreVal;
            weekHasScores = true;
          }
        }
      });

      if (weekHasScores) {
        cumulativeScoresByWeek[w] = currentCumScores;
        
        // Calculate true single-week score: Single(W) = Cumulative(W) - Cumulative(W-1)
        const singleScoresThisWeek = {};
        Object.keys(currentCumScores).forEach(fid => {
          const cumScore = currentCumScores[fid];
          const priorCum = w > 1 ? (cumulativeScoresByWeek[w - 1]?.[fid] || 0) : 0;
          const singleScore = Math.max(0, cumScore - priorCum);
          singleScoresThisWeek[fid] = parseFloat(singleScore.toFixed(2));
        });

        weeklySingleScores[w] = singleScoresThisWeek;

        if (!liveScoringWeek || w < liveScoringWeek) {
          latestCompletedWeek = w;
        }
      }
    } catch (err) {
      console.warn(`Error fetching Week ${w} results:`, err.message);
    }
  }

  const currentWeek = liveScoringWeek || (latestCompletedWeek + 1);

  // 4. Process Live Details for the active week
  const liveDetails = {};

  if (rawLiveFranchises.length > 0) {
    rawLiveFranchises.forEach(lf => {
      const fid = lf.id;
      const totalLiveScore = parseFloat(lf.score || 0);

      // Prior week carryover score (e.g. Week 2 score for Week 3)
      const priorWeekNum = currentWeek - 1;
      const priorScoreCarryover = priorWeekNum >= 1 ? (weeklySingleScores[priorWeekNum]?.[fid] || 0) : 0;

      const ytpCount = parseInt(lf.playersYetToPlay || 0, 10);
      const inGameCount = parseInt(lf.playersCurrentlyPlaying || 0, 10);
      const finishedCount = parseInt(lf.playersGameFinished || 0, 10);

      let doneScore = 0;
      let liveScore = 0;

      const players = normalizeArray(lf.player);
      const starters = players.filter(p => p.status === 'starter' || !p.status);

      if (starters.length > 0) {
        starters.forEach(p => {
          const pScore = parseFloat(p.score || 0);
          const secs = parseInt(p.gameSecondsRemaining, 10);

          if (secs === 0) {
            doneScore += pScore;
          } else if (secs > 0 && secs < 3600) {
            liveScore += pScore;
          }
        });

        // If MFL player scores included priorWeekScore or if totalLiveScore includes FSCOREADJ:
        const currentWeekPoints = Math.max(0, totalLiveScore - priorScoreCarryover);
        const calcSum = doneScore + liveScore;

        if (calcSum > currentWeekPoints + 0.1 && calcSum >= priorScoreCarryover) {
          // If player scores sum included prior carryover, adjust doneScore
          doneScore = Math.max(0, doneScore - priorScoreCarryover);
        } else if (calcSum === 0 && currentWeekPoints > 0) {
          if (inGameCount > 0) liveScore = currentWeekPoints;
          else doneScore = currentWeekPoints;
        }
      } else {
        // Fallback when player array is omitted in liveScoring
        const currentWeekPoints = Math.max(0, totalLiveScore - priorScoreCarryover);
        if (inGameCount > 0) {
          liveScore = currentWeekPoints;
        } else {
          doneScore = currentWeekPoints;
        }
      }

      liveDetails[fid] = {
        doneScore: parseFloat(doneScore.toFixed(2)),
        liveScore: parseFloat(liveScore.toFixed(2)),
        ytp: ytpCount,
        inGame: inGameCount,
        finished: finishedCount
      };

      if (inGameCount > 0 || (ytpCount > 0 && finishedCount > 0)) {
        isLiveGameActive = true;
      }
    });
  }

  // 5. Construct & Save Payload
  const finalPayload = {
    leagueId: LEAGUE_ID,
    seasonYear: SEASON_YEAR,
    currentWeek: currentWeek,
    isLive: isLiveGameActive,
    lastUpdated: new Date().toISOString(),
    franchises: franchises,
    weeklySingleScores: weeklySingleScores,
    liveDetails: liveDetails,
    eliminatedTeams: existingData.eliminatedTeams || {},
    weeklyWinners: existingData.weeklyWinners || {}
  };

  fs.writeFileSync(existingDataPath, JSON.stringify(finalPayload, null, 2), 'utf-8');
  console.log(`Successfully updated data.json! Current Week: ${currentWeek}, Live Mode: ${isLiveGameActive}`);
}

runFetcher().catch(err => {
  console.error('Fatal error in fetcher.js:', err);
  process.exit(1);
});
