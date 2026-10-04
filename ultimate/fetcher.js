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
      'User-Agent': 'UltimateGuillotineFetcher/1.2.4 (+https://github.com/c0d3rj03/fantasy-football)'
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

  // 2. Fetch Live Scoring Data with DETAILS=1
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

  // Read existing data.json for historical preservation
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
        // W=1: Single(1) = MFL_WeeklyResults(1)
        // W>=2: Single(W) = MFL_WeeklyResults(W) - Single(W-1)
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
  let isLiveGameActive = false;

  // 4. Process Live Details for the active week using explicit player scoring
  const liveDetails = {};

  if (rawLiveFranchises.length > 0) {
    rawLiveFranchises.forEach(lf => {
      const fid = lf.id;

      const players = normalizeArray(lf.player);
      const starters = players.filter(p => {
        const st = (p.status || '').toLowerCase();
        return st === 'starter' || !p.status;
      });

      let finishedCount = 0;
      let inGameCount = 0;
      let ytpCount = 0;
      let doneScore = 0;
      let liveScore = 0;

      if (starters.length > 0) {
        starters.forEach(p => {
          const pScore = parseFloat(p.score || 0);
          const secsRaw = p.gameSecondsRemaining;
          const secs = (secsRaw !== undefined && secsRaw !== null && secsRaw !== '') ? parseInt(secsRaw, 10) : 3600;
          const hasPlayed = String(p.hasPlayed || '');

          const isFinished = secs === 0 || hasPlayed === '2';
          const isInGame = (secs > 0 && secs < 3600) || hasPlayed === '1';

          if (isFinished) {
            finishedCount++;
            doneScore += pScore;
          } else if (isInGame) {
            inGameCount++;
            liveScore += pScore;
          } else {
            ytpCount++;
          }
        });

        doneScore = parseFloat(doneScore.toFixed(2));
        liveScore = parseFloat(liveScore.toFixed(2));
      } else {
        // Fallback to top-level MFL properties if player breakdown is absent
        ytpCount = parseInt(lf.playersYetToPlay || 0, 10);
        inGameCount = parseInt(lf.playersCurrentlyPlaying || 0, 10);
        finishedCount = parseInt(lf.playersGameFinished || 0, 10);

        const totalPoints = parseFloat(lf.score || 0);
        const priorWeekNum = currentWeek - 1;
        const priorCarryover = priorWeekNum >= 1 ? (weeklySingleScores[priorWeekNum]?.[fid] || 0) : 0;
        const thisWeekPts = Math.max(0, totalPoints - priorCarryover);

        if (inGameCount > 0) {
          liveScore = parseFloat(thisWeekPts.toFixed(2));
        } else {
          doneScore = parseFloat(thisWeekPts.toFixed(2));
        }
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
