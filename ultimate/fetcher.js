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

// Normalize MFL array vs single object responses
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

  // 3. Fetch Weekly Scores for completed/historical weeks
  const weeklySingleScores = {};
  const maxWeeksToFetch = 17;
  let latestCompletedWeek = 0;

  for (let w = 1; w <= maxWeeksToFetch; w++) {
    try {
      const scoreData = await fetchMFL('weeklyResults', { W: w.toString() });
      const matchSet = scoreData.weeklyResults?.matchup;

      if (!matchSet) continue;

      const matchups = normalizeArray(matchSet);
      let weekHasScores = false;
      const weekScores = {};

      matchups.forEach(m => {
        const franchiseScores = normalizeArray(m.franchise);
        franchiseScores.forEach(f => {
          if (f.id && f.score !== undefined && f.score !== '') {
            const scoreVal = parseFloat(f.score);
            if (!isNaN(scoreVal) && scoreVal > 0) {
              weekScores[f.id] = scoreVal;
              weekHasScores = true;
            }
          }
        });
      });

      if (weekHasScores) {
        weeklySingleScores[w] = weekScores;
        // If week w is strictly less than liveScoringWeek or if games are complete
        if (!liveScoringWeek || w < liveScoringWeek) {
          latestCompletedWeek = w;
        }
      }
    } catch (err) {
      console.warn(`Error fetching Week ${w} results:`, err.message);
    }
  }

  const currentWeek = liveScoringWeek || (latestCompletedWeek + 1);

  // 4. Process Live Details if currently in a live week
  const liveDetails = {};

  if (rawLiveFranchises.length > 0) {
    rawLiveFranchises.forEach(lf => {
      const fid = lf.id;
      const totalLiveScore = parseFloat(lf.score || 0);

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
      } else {
        // Fallback if player breakdown is omitted
        if (inGameCount > 0) {
          liveScore = totalLiveScore;
        } else {
          doneScore = totalLiveScore;
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

  // 5. Calculate Eliminations and Standings
  const eliminatedTeams = {};
  const activeFranchiseIds = Object.keys(franchises);

  // Read existing eliminatedTeams or calculate dynamically based on 2-week rolling totals
  // (In production, this is preserved or synced from data.json)
  const existingDataPath = path.join(__dirname, 'data.json');
  let existingData = {};
  if (fs.existsSync(existingDataPath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(existingDataPath, 'utf-8'));
    } catch (e) {}
  }

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
