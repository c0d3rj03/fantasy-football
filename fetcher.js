const fs = require('fs');
const https = require('https');

const LEAGUE_ID = '63213';
const YEAR = '2026'; // 2026 Live Season
const BASE_URL = `https://www42.myfantasyleague.com/${YEAR}/export`;

const divisionNames = {
  "00": "Upper Division",
  "01": "Middle Division",
  "02": "Lower Division"
};

// 2026 Q1 Starting Seed (Corrected)
let activeDivisions = {
  "0003": "00", // Shankly's Ghost (Upper)
  "0002": "00", // BattleBots (Upper)
  "0001": "00", // Orcan Terror (Upper)
  "0005": "00", // Peaky Fookin Blinders (Upper)

  "0009": "01", // Springfield Isotopes (Middle)
  "0012": "01", // 2 Roops, 1 Silva (Middle)
  "0010": "01", // The Meaty Ogres (Middle)
  "0006": "01", // Ted Lasso (Middle)

  "0004": "02", // Hamsterdam (Lower)
  "0008": "02", // The Two Tones (Lower)
  "0011": "02", // The Wild Cards (Lower)
  "0007": "02"  // Norsemen (Lower)
};

function fetchAPI(command, params = {}) {
  return new Promise((resolve, reject) => {
    let url = `${BASE_URL}?TYPE=${command}&L=${LEAGUE_ID}&JSON=1`;
    Object.keys(params).forEach(k => url += `&${k}=${params[k]}`);

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
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

// Dynamic Promotion & Relegation Engine
function evaluatePromotionRelegation(quarterStandings) {
  const nextDivisions = { ...activeDivisions };

  const upperTeams = quarterStandings["Upper Division"] || [];
  const middleTeams = quarterStandings["Middle Division"] || [];
  const lowerTeams = quarterStandings["Lower Division"] || [];

  const promotedFromMiddle = middleTeams[0]?.id;
  const promotedFromLower = lowerTeams[0]?.id;

  const upperRelegated = upperTeams.length > 0 
    ? upperTeams.reduce((min, t) => (t.pp < min.pp ? t : min))?.id 
    : null;
  
  const eligibleMiddle = middleTeams.slice(1);
  const middleRelegated = eligibleMiddle.length > 0 
    ? eligibleMiddle.reduce((min, t) => (t.pp < min.pp ? t : min))?.id 
    : null;

  if (promotedFromMiddle && upperRelegated) {
    nextDivisions[promotedFromMiddle] = "00";
    nextDivisions[upperRelegated] = "01";
  }

  if (promotedFromLower && middleRelegated) {
    nextDivisions[promotedFromLower] = "01";
    nextDivisions[middleRelegated] = "02";
  }

  return nextDivisions;
}

async function main() {
  const franchises = await fetchFranchises();
  const leagueData = { weekly_data: {}, postseason_matrix: {} };

  let quarterAccumulators = {};
  const seasonAccumulators = {};

  const initTeamAcc = (acc, id) => {
    if (!acc[id]) {
      acc[id] = {
        id: id,
        name: franchises[id]?.name || id,
        h2h_vp: 0, battle_vp: 0, vp: 0, pf: 0, pp: 0, wins: 0, losses: 0, ties: 0
      };
    }
  };

  // Initialize season accumulators for all teams
  Object.keys(activeDivisions).forEach(tId => {
    initTeamAcc(seasonAccumulators, tId);
  });

  // WEEKS 1 - 12 (Regular Season)
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

    const rawMatchups = (resultsData && resultsData.weeklyResults && resultsData.weeklyResults.matchup)
      ? (Array.isArray(resultsData.weeklyResults.matchup) ? resultsData.weeklyResults.matchup : [resultsData.weeklyResults.matchup])
      : [];

    // Check if week has been played (Total PF > 0)
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
    const processedMatchupKeys = new Set();
    const processedTeamsInWeek = new Set();

    if (rawMatchups.length > 0) {
      rawMatchups.forEach(m => {
        const franchisesList = Array.isArray(m.franchise) ? m.franchise : [m.franchise];
        if (franchisesList.length < 2) return;

        const f1 = franchisesList[0];
        const f2 = franchisesList[1];

        // Deduplicate matchups
        const matchupKey = [f1.id, f2.id].sort().join('-');
        if (processedMatchupKeys.has(matchupKey)) return;
        processedMatchupKeys.add(matchupKey);

        const score1 = isPlayed ? parseFloat(f1.score || 0) : null;
        const score2 = isPlayed ? parseFloat(f2.score || 0) : null;
        const pp1 = isPlayed ? parseFloat(f1.opt_pts || score1 || 0) : null;
        const pp2 = isPlayed ? parseFloat(f2.opt_pts || score2 || 0) : null;

        let vp1 = 0, vp2 = 0;
        if (isPlayed) {
          if (score1 > score2) vp1 = 1;
          else if (score2 > score1) vp2 = 1;
          else { vp1 = 0.5; vp2 = 0.5; }
        }

        processedMatchups.push({
          team1: { id: f1.id, name: franchises[f1.id]?.name || f1.id, score: score1, vp_earned: isPlayed ? vp1 : 0 },
          team2: { id: f2.id, name: franchises[f2.id]?.name || f2.id, score: score2, vp_earned: isPlayed ? vp2 : 0 }
        });

        if (isPlayed) {
          [
            { id: f1.id, score: score1, pp: pp1, vp: vp1 },
            { id: f2.id, score: score2, pp: pp2, vp: vp2 }
          ].forEach(item => {
            // Deduplicate team score additions per week
            if (!processedTeamsInWeek.has(item.id)) {
              processedTeamsInWeek.add(item.id);

              weeklyScoresMap[item.id] = {
                id: item.id,
                name: franchises[item.id]?.name || item.id,
                score: item.score,
                pp: item.pp,
                division: activeDivisions[item.id],
                h2h_vp: item.vp
              };

              quarterAccumulators[item.id].pf += item.score;
              quarterAccumulators[item.id].pp += item.pp;
              quarterAccumulators[item.id].h2h_vp += item.vp;
              quarterAccumulators[item.id].vp += item.vp;
              if (item.vp === 1) quarterAccumulators[item.id].wins++;
              else if (item.vp === 0.5) quarterAccumulators[item.id].ties++;
              else quarterAccumulators[item.id].losses++;

              seasonAccumulators[item.id].pf += item.score;
              seasonAccumulators[item.id].pp += item.pp;
              seasonAccumulators[item.id].h2h_vp += item.vp;
              seasonAccumulators[item.id].vp += item.vp;
              if (item.vp === 1) seasonAccumulators[item.id].wins++;
              else if (item.vp === 0.5) seasonAccumulators[item.id].ties++;
              else seasonAccumulators[item.id].losses++;
            }
          });
        }
      });
    }

    // Battle Royale Object
    const battleRoyale = { "Upper Division": [], "Middle Division": [], "Lower Division": [] };
    if (isPlayed) {
      const divScoresMap = { "00": [], "01": [], "02": [] };
      Object.values(weeklyScoresMap).forEach(t => {
        if (divScoresMap[t.division]) divScoresMap[t.division].push(t);
      });

      Object.keys(divScoresMap).forEach(divId => {
        const divName = divisionNames[divId];
        const sortedTeams = divScoresMap[divId].sort((a, b) => b.score - a.score);

        sortedTeams.forEach((team, index) => {
          const battle_vp = index < 2 ? 1 : 0;
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
            quarterAccumulators[team.id].battle_vp += battle_vp;
            quarterAccumulators[team.id].vp += battle_vp;
          }
          if (seasonAccumulators[team.id]) {
            seasonAccumulators[team.id].battle_vp += battle_vp;
            seasonAccumulators[team.id].vp += battle_vp;
          }
        });
      });
    } else {
      // Unplayed: List teams in current active division
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

    // Standings Snapshot
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
      season_standings: seasonStandings
    };

    if (isPlayed && (week === 4 || week === 8 || week === 12)) {
      console.log(`Evaluating Promotion/Relegation after Week ${week}...`);
      activeDivisions = evaluatePromotionRelegation(quarterStandings);
    }
  }

  fs.writeFileSync('data.json', JSON.stringify(leagueData, null, 2));
  console.log("Successfully generated complete 12-week data.json for 2026!");
}

main().catch(console.error);