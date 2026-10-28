const fs = require('fs');
const https = require('https');
const path = require('path');

const { LEAGUE_ID, YEAR, MFL_HOST, DIVISION_NAMES: divisionNames, Q1_SLOTS } = require('./config.js');
const { inDivisionVPs, promotionRelegation, nextQuarterSlots } = require('./pbr_rules.js');
const BASE_URL = `https://${MFL_HOST}/${YEAR}/export`;

// Scheduling slots #1-#4 per division for the current quarter; P&R after Weeks 4/8/12 replaces them.
let quarterSlots = Q1_SLOTS;
const divisionsFromSlots = slots => Object.fromEntries(
  Object.entries(slots).flatMap(([div, ids]) => ids.map(id => [id, div]))
);
let activeDivisions = divisionsFromSlots(quarterSlots);

function fetchAPI(command, params = {}) {
  return new Promise((resolve, reject) => {
    let url = `${BASE_URL}?TYPE=${command}&L=${LEAGUE_ID}&JSON=1`;
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
  return map;
}

async function main() {
  const franchises = await fetchFranchises();

  // Preserve existing recaps from data.json so they aren't erased on re-fetch
  const existingRecaps = {};
  const dataPath = path.join(__dirname, 'data.json');
  if (fs.existsSync(dataPath)) {
    try {
      const oldData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
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

    const isPlayed = totalWeeklyPF > 0;
    const processedMatchups = [];
    const weeklyScoresMap = {};

    Object.keys(activeDivisions).forEach(tId => {
      weeklyScoresMap[tId] = { id: tId, name: franchises[tId]?.name || tId, score: 0, pp: 0, division: activeDivisions[tId], h2h_vp: 0, wins: 0, losses: 0, ties: 0 };
    });

    if (rawMatchups.length > 0) {
      rawMatchups.forEach(m => {
        const franchisesList = Array.isArray(m.franchise) ? m.franchise : [m.franchise];
        if (franchisesList.length < 2) return;

        const [f1, f2] = franchisesList;
        if (!f1 || !f2 || !f1.id || !f2.id) return;

        const score1 = isPlayed ? parseFloat(f1.score || 0) : null;
        const score2 = isPlayed ? parseFloat(f2.score || 0) : null;
        const pp1 = isPlayed ? parseFloat(f1.opt_pts || score1 || 0) : null;
        const pp2 = isPlayed ? parseFloat(f2.opt_pts || score2 || 0) : null;

        let vp1 = 0, vp2 = 0;
        if (isPlayed) {
          if (score1 > score2) { vp1 = 1; vp2 = 0; }
          else if (score2 > score1) { vp1 = 0; vp2 = 1; }
          else { vp1 = 0.5; vp2 = 0.5; }
        }

        processedMatchups.push({
          team1: { id: f1.id, name: franchises[f1.id]?.name || f1.id, score: score1, vp_earned: isPlayed ? vp1 : 0 },
          team2: { id: f2.id, name: franchises[f2.id]?.name || f2.id, score: score2, vp_earned: isPlayed ? vp2 : 0 }
        });

        if (isPlayed) {
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

    if (isPlayed) {
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
            total_weekly_vp: total_weekly_vp
          });

          if (quarterAccumulators[team.id]) {
            quarterAccumulators[team.id].pf += team.score;
            quarterAccumulators[team.id].pp += team.pp;
            quarterAccumulators[team.id].h2h_vp += team.h2h_vp;
            quarterAccumulators[team.id].battle_vp += battle_vp;
            quarterAccumulators[team.id].vp += total_weekly_vp;
            quarterAccumulators[team.id].wins += team.wins;
            quarterAccumulators[team.id].losses += team.losses;
            quarterAccumulators[team.id].ties += team.ties;
          }
          if (seasonAccumulators[team.id]) {
            seasonAccumulators[team.id].pf += team.score;
            seasonAccumulators[team.id].pp += team.pp;
            seasonAccumulators[team.id].h2h_vp += team.h2h_vp;
            seasonAccumulators[team.id].battle_vp += battle_vp;
            seasonAccumulators[team.id].vp += total_weekly_vp;
            seasonAccumulators[team.id].wins += team.wins;
            seasonAccumulators[team.id].losses += team.losses;
            seasonAccumulators[team.id].ties += team.ties;
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
      if (quarterAccumulators[tId]) {
        quarterStandings[dName].push({ ...quarterAccumulators[tId], division: dCode });
      }
    });

    Object.keys(quarterStandings).forEach(d => {
      quarterStandings[d].sort((a, b) => {
        if (b.vp !== a.vp) return b.vp - a.vp;
        return b.pf - a.pf;
      });
    });

    const seasonStandings = { "Upper Division": [], "Middle Division": [], "Lower Division": [] };
    Object.keys(activeDivisions).forEach(tId => {
      const dCode = activeDivisions[tId];
      const dName = divisionNames[dCode];
      if (seasonAccumulators[tId]) {
        seasonStandings[dName].push({ ...seasonAccumulators[tId], division: dCode });
      }
    });

    Object.keys(seasonStandings).forEach(d => {
      seasonStandings[d].sort((a, b) => {
        if (b.vp !== a.vp) return b.vp - a.vp;
        return b.pf - a.pf;
      });
    });

    leagueData.weekly_data[week.toString()] = {
      week: week,
      quarter: quarter,
      played: isPlayed,
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

  fs.writeFileSync(dataPath, JSON.stringify(leagueData, null, 2));
  console.log(`Successfully generated complete data.json at ${dataPath}`);
  // MFL writes (VP push, quarter changes) are in commish_mfl_actions.js.
}

main().catch(console.error);
