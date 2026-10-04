import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEAGUE_ID = process.env.LEAGUE_ID || '25918';
const SEASON_YEAR = process.env.SEASON_YEAR || '2026';
const MFL_BASE_URL = `https://www42.myfantasyleague.com/${SEASON_YEAR}/export`;

// Master Weekly Starting Lineup Requirements
const ROSTER_SCHEDULE = {
  1: { startersTotal: 8 },
  2: { startersTotal: 8 },
  3: { startersTotal: 8 },
  4: { startersTotal: 8 },
  5: { startersTotal: 8 },
  6: { startersTotal: 9 },
  7: { startersTotal: 9 },
  8: { startersTotal: 10 },
  9: { startersTotal: 10 },
  10: { startersTotal: 11 },
  11: { startersTotal: 11 },
  12: { startersTotal: 12 },
  13: { startersTotal: 12 },
  14: { startersTotal: 13 },
  15: { startersTotal: 13 },
  16: { startersTotal: 14 },
  17: { startersTotal: 14 }
};

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
      'User-Agent': 'UltimateGuillotineFetcher/1.4 (+https://github.com/c0d3rj03/fantasy-football)'
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

        // Calculate single-week scores:
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
  const totalStartersForWeek = ROSTER_SCHEDULE[currentWeek]?.startersTotal || 8;
  let isLiveGameActive = false;

  // 4. Process Live Details for the active week
  const liveDetails = {};

  if (rawLiveFranchises.length > 0) {
    const priorWeekNum = currentWeek - 1;

    rawLiveFranchises.forEach(lf => {
      const fid = lf.id;
      const totalLiveScore = parseFloat(lf.score || 0);

      // Carryover from prior week (e.g. Single score for Week 3)
      const priorScoreCarryover = priorWeekNum >= 1 ? (weeklySingleScores[priorWeekNum]?.[fid] || 0) : 0;
      const currentWeekTotalPoints = Math.max(0, totalLiveScore - priorScoreCarryover);

      // Parse player list for starter filtering
      const players = normalizeArray(lf.player);
      const starters = players.filter(p => {
        const st = (p.status || '').toLowerCase();
        return st === 'starter' || !p.status;
      });

      const numStarters = starters.length > 0 ? starters.length : totalStartersForWeek;

      // Extract MFL top-level counts
      let ytpCount = parseInt(lf.playersYetToPlay || 0, 10);
      let inGameCount = parseInt(lf.playersCurrentlyPlaying || 0, 10);
      let finishedCount = lf.playersGameFinished !== undefined && lf.playersGameFinished !== ''
        ? parseInt(lf.playersGameFinished, 10)
        : Math.max(0, numStarters - ytpCount - inGameCount);

      // If starter players array is available, calculate finishedCount directly from gameSecondsRemaining === 0
      if (starters.length > 0) {
        let calcFinished = 0;
        let calcInGame = 0;
        let calcYtp = 0;

        starters.forEach(p => {
          const secsRaw = p.gameSecondsRemaining;
          const secs = (secsRaw !== undefined && secsRaw !== null && secsRaw !== '') ? parseInt(secsRaw, 10) : 3600;
          const hasPlayed = String(p.hasPlayed || '');

          if (secs === 0 || hasPlayed === '2') {
            calcFinished++;
          } else if ((secs > 0 && secs < 3600) || hasPlayed === '1') {
            calcInGame++;
          } else {
            calcYtp++;
          }
        });

        // Use calculated counts if valid
        if (calcFinished + calcInGame + calcYtp === numStarters) {
          finishedCount = calcFinished;
          inGameCount = calcInGame;
          ytpCount = calcYtp;
        }
      }

      // Ensure finishedCount falls back to totalStarters - YTP - Live if 0 but currentWeekTotalPoints > 0
      if (finishedCount === 0 && inGameCount === 0 && currentWeekTotalPoints > 0) {
        finishedCount = Math.max(1, numStarters - ytpCount);
      }

      // Determine doneScore vs liveScore
      let doneScore = 0;
      let liveScore = 0;

      if (inGameCount === 0) {
        // No games currently in progress: all current week points earned so far belong to doneScore
        doneScore = parseFloat(currentWeekTotalPoints.toFixed(2));
        liveScore = 0;
      } else {
        // Active games in progress: sum active players into liveScore
        if (starters.length > 0) {
          starters.forEach(p => {
            const pScore = parseFloat(p.score || 0);
            const secsRaw = p.gameSecondsRemaining;
            const secs = (secsRaw !== undefined && secsRaw !== null && secsRaw !== '') ? parseInt(secsRaw, 10) : 3600;
            const hasPlayed = String(p.hasPlayed || '');

            if ((secs > 0 && secs < 3600) || hasPlayed === '1') {
              liveScore += pScore;
            }
          });
        }
        liveScore = parseFloat(liveScore.toFixed(2));
        doneScore = parseFloat(Math.max(0, currentWeekTotalPoints - liveScore).toFixed(2));
      }

      liveDetails[fid] = {
        doneScore: doneScore,
        liveScore: liveScore,
        ytp: ytpCount,
        inGame: inGameCount,
        finished: finishedCount
      };

      if (inGameCount > 0 || finishedCount > 0 || doneScore > 0 || liveScore > 0) {
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
