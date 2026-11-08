const fs = require('fs');
const https = require('https');
const path = require('path');

const { LEAGUE_ID, YEAR, MFL_HOST, DIVISION_NAMES: divisionNames, Q1_SLOTS } = require('./config.js');
const { inDivisionVPs, rankStandings, promotionRelegation, nextQuarterSlots, optimalLineupPoints } = require('./pbr_rules.js');
const BASE_URL = `https://${MFL_HOST}/${YEAR}/export`;
// League-independent exports (nflSchedule, players) are only on MFL's api host.
const API_URL = `https://api.myfantasyleague.com/${YEAR}/export`;

// MFL game clock in seconds: 3600 = not started, 1-3599 = in progress, 0 = final (bye players report 0 too).
const FULL_GAME_SECONDS = 3600;
const asArray = x => (x == null ? [] : Array.isArray(x) ? x : [x]);

// Scheduling slots #1-#4 per division for the current quarter; P&R after Weeks 4/8/12 replaces them.
let quarterSlots = Q1_SLOTS;
const divisionsFromSlots = slots => Object.fromEntries(
  Object.entries(slots).flatMap(([div, ids]) => ids.map(id => [id, div]))
);
let activeDivisions = divisionsFromSlots(quarterSlots);

function fetchAPI(command, params = {}, { nflData = false } = {}) {
  return new Promise((resolve, reject) => {
    let url = nflData ? `${API_URL}?TYPE=${command}&JSON=1` : `${BASE_URL}?TYPE=${command}&L=${LEAGUE_ID}&JSON=1`;
    Object.keys(params).forEach(k => {
      url += `&${k}=${params[k]}`;
    });

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function fetchFranchises() {
  const data = await fetchAPI('league');
  const map = {};
  if (data && data.league && data.league.franchises && data.league.franchises.franchise) {
    data.league.franchises.franchise.forEach(f => {
      map[f.id] = { id: f.id, name: f.name };
    });
  }
  return { franchises: map, starterRules: data?.league?.starters || null };
}

/**
 * The week in progress, from MFL liveScoring (weeklyResults has no scores until the week is final).
 * Returns null when MFL has no live week or none of its NFL games has kicked off yet. Otherwise:
 *   { week, allFinal, games: { total, final, inProgress }, teams: { fid: { score, pp, ytp, in_game, done } },
 *     matchups: [[fid, fid]] }
 * A starter counts as yet to play (ytp) before kickoff and done once his game is final. A starter on bye
 * counts as yet to play until the week's last kickoff (he can still be benched), then as done.
 * PP is the best legal lineup from every rostered player's points so far (pbr_rules.js
 * optimalLineupPoints), never below the team's score.
 */
async function fetchLiveWeek(starterRules) {
  let live;
  try {
    live = (await fetchAPI('liveScoring', { DETAILS: '1' })).liveScoring;
  } catch (e) {
    console.warn('⚠️ Could not fetch MFL liveScoring (no live week):', e.message);
    return null;
  }
  const week = parseInt(live?.week, 10);
  const rawMatchups = asArray(live?.matchup);
  if (!week || rawMatchups.length === 0) return null;

  let schedule;
  try {
    schedule = asArray((await fetchAPI('nflSchedule', { W: String(week) }, { nflData: true })).nflSchedule?.matchup);
  } catch (e) {
    console.warn(`⚠️ Could not fetch the NFL schedule for Week ${week} (no live week):`, e.message);
    return null;
  }
  const secsOf = g => { const n = parseInt(g.gameSecondsRemaining, 10); return Number.isNaN(n) ? FULL_GAME_SECONDS : n; };
  const games = {
    total: schedule.length,
    final: schedule.filter(g => secsOf(g) <= 0).length,
    inProgress: schedule.filter(g => secsOf(g) > 0 && secsOf(g) < FULL_GAME_SECONDS).length
  };
  const notStarted = schedule.filter(g => secsOf(g) >= FULL_GAME_SECONDS).length;
  if (games.total === 0 || notStarted === games.total) return null;
  const teamsPlaying = new Set(schedule.flatMap(g => asArray(g.team).map(t => t.id)));

  // Each franchise appears in two matchups with the same roster; keep one copy.
  const rosters = {};
  const matchups = [];
  rawMatchups.forEach(m => {
    const fr = asArray(m.franchise);
    if (fr.length < 2 || !fr[0]?.id || !fr[1]?.id) return;
    matchups.push([fr[0].id, fr[1].id]);
    fr.forEach(f => { if (!rosters[f.id]) rosters[f.id] = f; });
  });

  // Positions (for PP) and NFL teams (for byes) of every rostered player.
  const playerIds = [...new Set(Object.values(rosters).flatMap(f => asArray(f.players?.player).map(p => p.id)))];
  const info = {};
  try {
    const res = await fetchAPI('players', { PLAYERS: playerIds.join(',') }, { nflData: true });
    asArray(res.players?.player).forEach(p => { info[p.id] = p; });
  } catch (e) {
    console.warn('⚠️ Could not fetch MFL players (tentative PP = score, bye detection off):', e.message);
  }

  const teams = {};
  Object.entries(rosters).forEach(([fid, f]) => {
    const players = asArray(f.players?.player);
    const starters = players.filter(p => (p.status || '').toLowerCase() === 'starter');
    let ytp = 0, inGame = 0, done = 0;
    starters.forEach(p => {
      const secs = parseInt(p.gameSecondsRemaining, 10);
      const team = info[p.id]?.team;
      const onBye = team && !teamsPlaying.has(team) && !(parseFloat(p.score) > 0);
      if (onBye) { if (notStarted > 0) ytp++; else done++; }
      else if (Number.isNaN(secs) || secs >= FULL_GAME_SECONDS) ytp++;
      else if (secs > 0) inGame++;
      else done++;
    });
    const score = Math.round((parseFloat(f.score) || 0) * 100) / 100;
    const pp = Object.keys(info).length && starterRules
      ? optimalLineupPoints(players.map(p => ({ pos: info[p.id]?.position, score: p.score })), starterRules)
      : score;
    teams[fid] = { score, pp: Math.max(pp, score), ytp, in_game: inGame, done };
  });

  return { week, allFinal: games.final === games.total, games, teams, matchups };
}

async function main() {
  const { franchises, starterRules } = await fetchFranchises();
  const liveWeek = await fetchLiveWeek(starterRules);
  if (liveWeek) {
    console.log(`MFL live week ${liveWeek.week}: ${liveWeek.games.final}/${liveWeek.games.total} NFL games final, ${liveWeek.games.inProgress} in progress.`);
  }

  // Preserve existing recaps from data.json so they aren't erased on re-fetch
  const existingRecaps = {};
  const dataPath = path.join(__dirname, 'data.json');
  let oldData = null;
  if (fs.existsSync(dataPath)) {
    try {
      oldData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      Object.keys(oldData.weekly_data || {}).forEach(w => {
        if (oldData.weekly_data[w].recap) {
          existingRecaps[w] = oldData.weekly_data[w].recap;
        }
      });
    } catch (e) {
      console.warn("⚠️ Could not read existing recaps from data.json:", e.message);
    }
  }

  // quarter_slots["4"] is the postseason (after Q3 P&R); promotion_relegation[q] is the P&R after quarter q.
  const leagueData = { weekly_data: {}, postseason_matrix: {}, quarter_slots: { '1': Q1_SLOTS }, promotion_relegation: {} };

  let quarterAccumulators = {};
  const seasonAccumulators = {};

  const initTeamAcc = (acc, id) => {
    if (!acc[id]) {
      acc[id] = { id: id, name: franchises[id]?.name || id, h2h_vp: 0, battle_vp: 0, vp: 0, pf: 0, pp: 0, wins: 0, losses: 0, ties: 0 };
    }
  };

  Object.keys(activeDivisions).forEach(tId => {
    initTeamAcc(seasonAccumulators, tId);
  });

  for (let week = 1; week <= 12; week++) {
    const quarter = Math.ceil(week / 4);
    console.log(`Fetching Week ${week} (Quarter ${quarter})...`);

    if (week === 1 || week === 5 || week === 9) {
      quarterAccumulators = {};
      Object.keys(activeDivisions).forEach(tId => {
        initTeamAcc(quarterAccumulators, tId);
      });
    }

    let resultsData = null;
    try {
      resultsData = await fetchAPI('weeklyResults', { W: week.toString() });
    } catch (e) {
      console.log(`No API data for Week ${week}.`);
    }

    const rawMatchups = (resultsData && resultsData.weeklyResults && resultsData.weeklyResults.matchup) ? (Array.isArray(resultsData.weeklyResults.matchup) ? resultsData.weeklyResults.matchup : [resultsData.weeklyResults.matchup]) : [];

    let totalWeeklyPF = 0;
    rawMatchups.forEach(m => {
      const franchisesList = Array.isArray(m.franchise) ? m.franchise : [m.franchise];
      franchisesList.forEach(f => {
        totalWeeklyPF += parseFloat(f.score || 0);
      });
    });

    // A week counts as played (final: VP push, recap, P&R) only once every NFL game of it is final.
    const thisLive = liveWeek && liveWeek.week === week ? liveWeek : null;
    let isPlayed = totalWeeklyPF > 0;
    if (isPlayed && thisLive && !thisLive.allFinal) {
      console.warn(`⚠️ Week ${week} has MFL results but ${thisLive.games.total - thisLive.games.final} NFL games are not final; treating it as in progress.`);
      isPlayed = false;
    }
    // Week in progress: tentative scores, VP and standings from liveScoring. Kept out of the
    // running totals, so later weeks and every 'played' consumer see only final weeks.
    const isLive = !isPlayed && !!thisLive;
    const scored = isPlayed || isLive;
    const qAcc = isLive ? structuredClone(quarterAccumulators) : quarterAccumulators;
    const sAcc = isLive ? structuredClone(seasonAccumulators) : seasonAccumulators;
    const liveStatus = id => {
      const t = thisLive?.teams[id];
      return isLive && t ? { ytp: t.ytp, in_game: t.in_game, done: t.done } : {};
    };
    let sourceMatchups = rawMatchups;
    if (isLive) {
      sourceMatchups = thisLive.matchups.map(([a, b]) => ({
        franchise: [a, b].map(id => ({ id, score: String(thisLive.teams[id]?.score ?? 0), opt_pts: String(thisLive.teams[id]?.pp ?? 0) }))
      }));
    }
    const processedMatchups = [];
    const weeklyScoresMap = {};

    Object.keys(activeDivisions).forEach(tId => {
      weeklyScoresMap[tId] = { id: tId, name: franchises[tId]?.name || tId, score: 0, pp: 0, division: activeDivisions[tId], h2h_vp: 0, wins: 0, losses: 0, ties: 0 };
    });

    if (sourceMatchups.length > 0) {
      sourceMatchups.forEach(m => {
        const franchisesList = Array.isArray(m.franchise) ? m.franchise : [m.franchise];
        if (franchisesList.length < 2) return;

        const [f1, f2] = franchisesList;
        if (!f1 || !f2 || !f1.id || !f2.id) return;

        const score1 = scored ? parseFloat(f1.score || 0) : null;
        const score2 = scored ? parseFloat(f2.score || 0) : null;
        const pp1 = scored ? parseFloat(f1.opt_pts || score1 || 0) : null;
        const pp2 = scored ? parseFloat(f2.opt_pts || score2 || 0) : null;

        let vp1 = 0, vp2 = 0;
        if (scored) {
          if (score1 > score2) { vp1 = 1; vp2 = 0; }
          else if (score2 > score1) { vp1 = 0; vp2 = 1; }
          else { vp1 = 0.5; vp2 = 0.5; }
        }

        processedMatchups.push({
          team1: { id: f1.id, name: franchises[f1.id]?.name || f1.id, score: score1, vp_earned: scored ? vp1 : 0, ...liveStatus(f1.id) },
          team2: { id: f2.id, name: franchises[f2.id]?.name || f2.id, score: score2, vp_earned: scored ? vp2 : 0, ...liveStatus(f2.id) }
        });

        if (scored) {
          if (weeklyScoresMap[f1.id]) {
            weeklyScoresMap[f1.id].score = score1;
            weeklyScoresMap[f1.id].pp = pp1;
            weeklyScoresMap[f1.id].h2h_vp += vp1;
            if (vp1 === 1) weeklyScoresMap[f1.id].wins += 1;
            else if (vp1 === 0) weeklyScoresMap[f1.id].losses += 1;
            else if (vp1 === 0.5) weeklyScoresMap[f1.id].ties += 1;
          }
          if (weeklyScoresMap[f2.id]) {
            weeklyScoresMap[f2.id].score = score2;
            weeklyScoresMap[f2.id].pp = pp2;
            weeklyScoresMap[f2.id].h2h_vp += vp2;
            if (vp2 === 1) weeklyScoresMap[f2.id].wins += 1;
            else if (vp2 === 0) weeklyScoresMap[f2.id].losses += 1;
            else if (vp2 === 0.5) weeklyScoresMap[f2.id].ties += 1;
          }
        }
      });
    }

    const battleRoyale = { "Upper Division": [], "Middle Division": [], "Lower Division": [] };

    if (scored) {
      const divScoresMap = { "00": [], "01": [], "02": [] };
      Object.values(weeklyScoresMap).forEach(t => {
        if (divScoresMap[t.division]) divScoresMap[t.division].push(t);
      });

      Object.keys(divScoresMap).forEach(divId => {
        const divName = divisionNames[divId];
        const sortedTeams = divScoresMap[divId].sort((a, b) => b.score - a.score);
        // Top 2 earn 1 VP each; ties across a slot split it (pbr_rules.js).
        const battleVps = inDivisionVPs(sortedTeams);

        sortedTeams.forEach(team => {
          const battle_vp = battleVps[team.id];
          const total_weekly_vp = team.h2h_vp + battle_vp;

          battleRoyale[divName].push({
            id: team.id,
            name: team.name,
            score: team.score,
            pp: team.pp,
            h2h_vp: team.h2h_vp,
            battle_vp: battle_vp,
            total_weekly_vp: total_weekly_vp,
            ...liveStatus(team.id)
          });

          for (const acc of [qAcc, sAcc]) {
            const a = acc[team.id];
            if (!a) continue;
            a.pf += team.score;
            a.pp += team.pp;
            a.h2h_vp += team.h2h_vp;
            a.battle_vp += battle_vp;
            a.vp += total_weekly_vp;
            a.wins += team.wins;
            a.losses += team.losses;
            a.ties += team.ties;
          }
        });
      });
    } else {
      Object.keys(activeDivisions).forEach(tId => {
        const dCode = activeDivisions[tId];
        const dName = divisionNames[dCode];
        battleRoyale[dName].push({
          id: tId,
          name: franchises[tId]?.name || tId,
          score: null,
          pp: null,
          h2h_vp: 0,
          battle_vp: 0,
          total_weekly_vp: 0
        });
      });
    }

    const quarterStandings = { "Upper Division": [], "Middle Division": [], "Lower Division": [] };
    Object.keys(activeDivisions).forEach(tId => {
      const dCode = activeDivisions[tId];
      const dName = divisionNames[dCode];
      if (qAcc[tId]) {
        quarterStandings[dName].push({ ...qAcc[tId], division: dCode });
      }
    });

    // Same order as P&R: VP → quarter PF → quarter win % → season PF → season win %.
    Object.keys(quarterStandings).forEach(d => {
      quarterStandings[d] = rankStandings(quarterStandings[d], sAcc);
    });

    const seasonStandings = { "Upper Division": [], "Middle Division": [], "Lower Division": [] };
    Object.keys(activeDivisions).forEach(tId => {
      const dCode = activeDivisions[tId];
      const dName = divisionNames[dCode];
      if (sAcc[tId]) {
        seasonStandings[dName].push({ ...sAcc[tId], division: dCode });
      }
    });

    Object.keys(seasonStandings).forEach(d => {
      seasonStandings[d].sort((a, b) => {
        if (b.vp !== a.vp) return b.vp - a.vp;
        return b.pf - a.pf;
      });
    });

    // live: the week is in progress and every score, VP and standing in it is tentative.
    let live;
    if (isLive) {
      live = { games_total: thisLive.games.total, games_final: thisLive.games.final, games_in_progress: thisLive.games.inProgress, updated: new Date().toISOString() };
    }

    leagueData.weekly_data[week.toString()] = {
      week: week,
      quarter: quarter,
      played: isPlayed,
      live,
      active_divisions: { ...activeDivisions },
      matchups: processedMatchups,
      battle_royale: battleRoyale,
      quarter_standings: quarterStandings,
      season_standings: seasonStandings,
      recap: existingRecaps[week.toString()] || '' // <-- Preserves existing recaps
    };

    if (isPlayed && (week === 4 || week === 8 || week === 12)) {
      console.log(`Evaluating Promotion/Relegation after Week ${week}...`);
      const byCode = {};
      Object.values(quarterStandings).flat().forEach(t => { (byCode[t.division] = byCode[t.division] || []).push(t); });
      const pr = promotionRelegation(byCode, seasonAccumulators);
      pr.coinFlips.forEach(text => console.warn(`⚠️ ${text}: the bylaws call for a coin flip.`));
      quarterSlots = nextQuarterSlots(pr);
      activeDivisions = divisionsFromSlots(quarterSlots);
      leagueData.promotion_relegation[String(quarter)] = { promoted: pr.promoted, relegated: pr.relegated, coin_flips: pr.coinFlips };
      leagueData.quarter_slots[String(quarter + 1)] = quarterSlots;
    }
  }

  // Keep the old live 'updated' time when nothing else about that week changed, so a quiet day commits nothing.
  Object.entries(leagueData.weekly_data).forEach(([w, obj]) => {
    const old = oldData?.weekly_data?.[w];
    if (!obj.live || !old?.live?.updated) return;
    const strip = o => JSON.stringify({ ...o, live: { ...o.live, updated: null } });
    if (strip(obj) === strip(old)) obj.live.updated = old.live.updated;
  });

  fs.writeFileSync(dataPath, JSON.stringify(leagueData, null, 2));
  console.log(`Successfully generated complete data.json at ${dataPath}`);
  // MFL writes (VP push, quarter changes) are in commish_mfl_actions.js.
}

main().catch(console.error);
