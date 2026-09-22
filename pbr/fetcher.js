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

// 2026 Q1 Starting Seed
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
    Object.keys(params).forEach(k => {
      url += `&${k}=${params[k]}`;
    });

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

  const [promotedFromMiddle] = middleTeams;
  const [promotedFromLower] = lowerTeams;

  const promotedFromMiddleId = promotedFromMiddle?.id;
  const promotedFromLowerId = promotedFromLower?.id;

  const upperRelegatedId = upperTeams.length > 0 
    ? upperTeams.reduce((min, t) => (t.pp < min.pp ? t : min))?.id 
    : null;
  
  const eligibleMiddle = middleTeams.slice(1);
  const middleRelegatedId = eligibleMiddle.length > 0 
    ? eligibleMiddle.reduce((min, t) => (t.pp < min.pp ? t : min))?.id 
    : null;

  if (promotedFromMiddleId && upperRelegatedId) {
    nextDivisions[promotedFromMiddleId] = "00";
    nextDivisions[upperRelegatedId] = "01";
  }

  if (promotedFromLowerId && middleRelegatedId) {
    nextDivisions[promotedFromLowerId] = "01";
    nextDivisions[middleRelegatedId] = "02";
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

    // Pre-seed weekly map for all active teams
    Object.keys(activeDivisions).forEach(tId => {
      weeklyScoresMap[tId] = {
        id: tId,
        name: franchises[tId]?.name || tId,
        score: 0,
        pp: 0,
        division: activeDivisions[tId],
        h2h_vp: 0,
        wins: 0,
        losses: 0,
        ties: 0
      };
    });

    if (rawMatchups.length > 0) {
      rawMatchups.forEach(m => {
        const franchisesList = Array.isArray(m.franchise) ? m.franchise : [m.franchise];
        if (franchisesList.length < 2) return;

        // ES6 Array Destructuring (prevents markdown bracket stripping)
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
          // Accumulate H2H game results across both matchups per team
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

          // Accumulate weekly totals once per team
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

  const dataPath = path.join(__dirname, 'data.json');
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  console.log(`Successfully generated complete data.json at ${dataPath}`);  
}

main().catch(console.error);