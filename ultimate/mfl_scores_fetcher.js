import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LEAGUE_ID, SEASON_YEAR, MFL_HOST } from './config.js';
import { WEEKLY_SCHEDULE } from './league_schedule.js';

// FETCH_MODE=live (the 10-minute game-day runs): refetch only last week and this week's results
// and reuse older weeks from data.json. The daily run (default 'full') refetches every week.
const FETCH_MODE = (process.env.FETCH_MODE || 'full').toLowerCase();

// MFL reports a player's game clock in seconds: 3600 = not started, 1-3599 = in progress,
// 0 = finished (players on bye also report 0 with 0 points).
const FULL_GAME_SECONDS = 3600;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MFL_BASE_URL = `https://${MFL_HOST}/${SEASON_YEAR}/export`;
// League-independent exports (nflSchedule, players) must go to MFL's api host.
const MFL_API_URL = `https://api.myfantasyleague.com/${SEASON_YEAR}/export`;

// MFL sometimes answers 503 for a few minutes (the 2026-11-02 run lost Sunday's scores to one).
// Retry server errors, 429s and network failures; other 4xx errors fail at once.
const RETRY_DELAYS_MS = [10000, 30000, 60000];

async function fetchMFL(type, params = {}, { nflData = false } = {}) {
  const query = new URLSearchParams({
    TYPE: type,
    ...(nflData ? {} : { L: LEAGUE_ID }),
    JSON: '1',
    ...params
  }).toString();

  const url = `${nflData ? MFL_API_URL : MFL_BASE_URL}?${query}`;

  for (let attempt = 0; ; attempt++) {
    let error;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'UltimateGuillotineFetcher/1.5 (+https://github.com/c0d3rj03/fantasy-football)'
        }
      });

      if (response.ok) {
        return await response.json();
      }

      error = new Error(`MFL API error [${type}]: ${response.status} ${response.statusText}`);
      if (response.status < 500 && response.status !== 429) throw error;
    } catch (err) {
      if (err === error) throw err;
      error = err;
    }

    if (attempt >= RETRY_DELAYS_MS.length) throw error;
    const delay = RETRY_DELAYS_MS[attempt];
    console.warn(`${error.message}; retrying in ${delay / 1000}s (attempt ${attempt + 2} of ${RETRY_DELAYS_MS.length + 1})`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
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
  const firstWeekToFetch = (FETCH_MODE === 'live' && liveScoringWeek && existingData.weeklySingleScores)
    ? Math.max(1, liveScoringWeek - 1)
    : 1;
  const lastWeekToFetch = FETCH_MODE === 'live' && liveScoringWeek ? liveScoringWeek : maxWeeksToFetch;
  if (firstWeekToFetch > 1) {
    console.log(`Live mode: fetching Weeks ${firstWeekToFetch}-${lastWeekToFetch}, reusing earlier weeks from data.json.`);
    for (let w = 1; w < firstWeekToFetch; w++) {
      if (existingData.weeklySingleScores[w]) {
        weeklySingleScores[w] = existingData.weeklySingleScores[w];
        latestCompletedWeek = w;
      }
    }
  }

  for (let w = firstWeekToFetch; w <= lastWeekToFetch; w++) {
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

        // Single week score calculation:
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
  let isLiveGameActive = false;

  // 4. Process Live Details for the active week
  const liveDetails = {};

  // NFL games this week: which teams play (a team missing from the schedule is on bye) and
  // how many games are in progress right now (the page glows "LIVE" only while one is).
  let nflTeamsPlaying = null;
  let gamesInProgress = 0;
  let gamesNotStarted = 0;
  try {
    const sched = await fetchMFL('nflSchedule', { W: String(currentWeek) }, { nflData: true });
    const matchups = normalizeArray(sched.nflSchedule?.matchup);
    nflTeamsPlaying = new Set();
    matchups.forEach(m => {
      normalizeArray(m.team).forEach(t => nflTeamsPlaying.add(t.id));
      const secs = parseInt(m.gameSecondsRemaining, 10);
      if (secs > 0 && secs < FULL_GAME_SECONDS) gamesInProgress++;
      if (!(secs < FULL_GAME_SECONDS)) gamesNotStarted++;
    });
  } catch (err) {
    console.warn('Could not fetch MFL nflSchedule (bye detection off):', err.message);
  }

  // A starter with 0 seconds and 0 points either played and scored nothing or is on bye.
  // Look up those players' NFL teams to tell which.
  const byePlayerIds = new Set();
  if (nflTeamsPlaying && nflTeamsPlaying.size > 0) {
    const candidates = new Set();
    rawLiveFranchises.forEach(lf => {
      normalizeArray(lf.players?.player ?? lf.player).forEach(p => {
        if (parseInt(p.gameSecondsRemaining, 10) === 0 && !(parseFloat(p.score) > 0)) candidates.add(p.id);
      });
    });
    if (candidates.size > 0) {
      try {
        const info = await fetchMFL('players', { PLAYERS: [...candidates].join(',') }, { nflData: true });
        normalizeArray(info.players?.player).forEach(p => {
          if (!nflTeamsPlaying.has(p.team)) byePlayerIds.add(p.id);
        });
      } catch (err) {
        console.warn('Could not fetch MFL players (bye detection off):', err.message);
      }
    }
  }

  if (rawLiveFranchises.length > 0) {
    const priorWeekNum = currentWeek - 1;
    // Starting lineup size grows through the season (8 in W1 up to 14 in W16-17).
    const requiredStarters = WEEKLY_SCHEDULE[currentWeek]?.starters.total || 0;

    rawLiveFranchises.forEach(lf => {
      const fid = lf.id;
      const totalLiveScore = parseFloat(lf.score || 0);

      // MFL's total includes last week's single score, entered as a starting adjustment.
      const priorScoreCarryover = priorWeekNum >= 1 ? (weeklySingleScores[priorWeekNum]?.[fid] || 0) : 0;
      const currentWeekTotalPoints = Math.max(0, totalLiveScore - priorScoreCarryover);

      // MFL nests players under lf.players.player (older responses used lf.player).
      const players = normalizeArray(lf.players?.player ?? lf.player);
      // MFL marks each player "starter" or "nonstarter". Only if no player carries a status at all
      // (an older response shape) is every listed player treated as a starter.
      const anyStatus = players.some(p => p.status);
      const starters = players.filter(p => {
        const st = (p.status || '').toLowerCase();
        return anyStatus ? (st === 'starter' || st === 's') : true;
      });

      let finishedCount = 0;
      let inGameCount = 0;
      let ytpCount = 0;
      let doneScore = 0;
      let liveScore = 0;
      // Starting slots the owner left empty (a team that was cut has no players and is skipped).
      const emptySlots = players.length > 0 ? Math.max(0, requiredStarters - starters.length) : 0;

      // A bye player never locks, so until the week's last NFL game kicks off the owner can still
      // bench him for an unlocked bench player or drop him for a free agent whose game hasn't
      // started: bye starters count as yet to play. After the last kickoff they are done (0 pts).
      const byeStarters = starters.filter(p => byePlayerIds.has(p.id)).length;
      const swappableByes = gamesNotStarted > 0 ? byeStarters : 0;

      if (starters.length > 0) {
        // Done and live are each the sum of their own starters' points, so a missing or wrong
        // carryover adjustment on MFL never shifts points between the two bars.
        starters.forEach(p => {
          const pScore = parseFloat(p.score || 0) || 0;
          const secsRaw = p.gameSecondsRemaining;
          const secs = (secsRaw !== undefined && secsRaw !== null && secsRaw !== '') ? parseInt(secsRaw, 10) : FULL_GAME_SECONDS;

          if (secs <= 0) {
            finishedCount++;
            doneScore += pScore;
          } else if (secs < FULL_GAME_SECONDS) {
            inGameCount++;
            liveScore += pScore;
          } else {
            ytpCount++;
          }
        });

        finishedCount -= swappableByes;
        ytpCount += swappableByes;

        doneScore = parseFloat(doneScore.toFixed(2));
        liveScore = parseFloat(liveScore.toFixed(2));

        const playerSum = doneScore + liveScore;
        if (Math.abs(playerSum - currentWeekTotalPoints) > 0.05 && priorScoreCarryover > 0) {
          console.warn(`${fid}: starters total ${playerSum.toFixed(2)} but MFL total minus carryover is ${currentWeekTotalPoints.toFixed(2)} (carryover adjustment missing or different?)`);
        }
      } else {
        ytpCount = parseInt(lf.playersYetToPlay || 0, 10);
        inGameCount = parseInt(lf.playersCurrentlyPlaying || 0, 10);
        finishedCount = parseInt(lf.playersGameFinished || 0, 10);

        if (inGameCount > 0) {
          liveScore = parseFloat(currentWeekTotalPoints.toFixed(2));
        } else {
          doneScore = parseFloat(currentWeekTotalPoints.toFixed(2));
        }
      }

      liveDetails[fid] = {
        doneScore: doneScore,
        liveScore: liveScore,
        ytp: ytpCount,
        inGame: inGameCount,
        finished: finishedCount,
        byeStarters: byeStarters,
        emptySlots: emptySlots
      };

    });
  }

  // 5. Work out the dashboard phase for the MFL week.
  // live:    some active team has a starter who has played and some starter still to play.
  // results: nobody has played yet (show last week's results), or every game is final.
  const eliminatedTeams = existingData.eliminatedTeams || {};
  const activeLive = Object.entries(liveDetails)
    .filter(([fid]) => !eliminatedTeams[fid] || eliminatedTeams[fid].eliminatedWeek >= currentWeek)
    .map(([, d]) => d);
  const anyStarted = activeLive.some(d => d.finished > 0 || d.inGame > 0 || d.doneScore > 0 || d.liveScore > 0);
  const anyPending = activeLive.some(d => d.ytp > 0 || d.inGame > 0);

  let phase = 'results';
  let lastCompletedWeek = currentWeek - 1;
  if (anyStarted && anyPending) {
    phase = 'live';
    isLiveGameActive = true;
  } else if (anyStarted) {
    // Every game is final but MFL has not rolled the week over yet.
    lastCompletedWeek = currentWeek;
  }
  const displayWeek = phase === 'live' ? currentWeek : Math.max(1, lastCompletedWeek);

  // 6. Construct & Save Payload. Unknown top-level keys from the old file are kept.
  const finalPayload = {
    ...existingData,
    leagueId: LEAGUE_ID,
    seasonYear: SEASON_YEAR,
    currentWeek: currentWeek,
    isLive: isLiveGameActive,
    phase: phase,
    displayWeek: displayWeek,
    lastCompletedWeek: lastCompletedWeek,
    lastUpdated: new Date().toISOString(),
    fetchMode: FETCH_MODE,
    gamesInProgress: gamesInProgress,
    franchises: franchises,
    weeklySingleScores: weeklySingleScores,
    liveDetails: liveDetails,
    eliminatedTeams: eliminatedTeams,
    weeklyWinners: existingData.weeklyWinners || {}
  };

  fs.writeFileSync(existingDataPath, JSON.stringify(finalPayload, null, 2), 'utf-8');
  console.log(`Successfully updated data.json! MFL Week: ${currentWeek}, Phase: ${phase}, Display Week: ${displayWeek}`);
}

runFetcher().catch(err => {
  console.error('Fatal error in fetcher.js:', err);
  process.exit(1);
});
