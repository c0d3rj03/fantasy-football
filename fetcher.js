const fs = require('fs');
const https = require('https');

const LEAGUE_ID = '63213';
const YEAR = '2025';
const BASE_URL = `https://www42.myfantasyleague.com/${YEAR}/export`;

const divisionNames = {
  "00": "Upper Division",
  "01": "Middle Division",
  "02": "Lower Division"
};

// Initial Seed: Week 1 Division Assignments
let activeDivisions = {
  "0002": "00", "0003": "00", "0011": "00", "0005": "00", // Upper Division
  "0001": "01", "0004": "01", "0009": "01", "0012": "01", // Middle Division
  "0007": "02", "0010": "02", "0008": "02", "0006": "02"  // Lower Division
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

  // Promoted Teams (#1 VP in Middle and Lower)
  const promotedFromMiddle = middleTeams[0]?.id;
  const promotedFromLower = lowerTeams[0]?.id;

  // Relegated Teams (Lowest PP in Upper, Lowest PP in Middle among non-promoted)
  const upperRelegated = upperTeams.length > 0 
    ? upperTeams.reduce((min, t) => (t.pp < min.pp ? t : min))?.id 
    : null;
  
  const eligibleMiddle = middleTeams.slice(1);
  const middleRelegated = eligibleMiddle.length > 0 
    ? eligibleMiddle.reduce((min, t) => (t.pp < min.pp ? t : min))?.id 
    : null;

  if (promotedFromMiddle && upperRelegated) {
    nextDivisions[promotedFromMiddle] = "00"; // Middle #1 -> Upper
    nextDivisions[upperRelegated] = "01";     // Upper lowest PP -> Middle
  }

  if (promotedFromLower && middleRelegated) {
    nextDivisions[promotedFromLower] = "01";  // Lower #1 -> Middle
    nextDivisions[middleRelegated] = "02";   // Middle lowest PP -> Lower
  }

  return nextDivisions;
}

// Calculate Postseason Head Start Bonuses
function calculatePostseasonBonuses(seasonAccumulators, postseasonDivisions) {
  const bonuses = {};
  const divTeamsMap = { "Upper Division": [], "Middle Division": [], "Lower Division": [] };

  Object.keys(postseasonDivisions).forEach(tId => {
    const dCode = postseasonDivisions[tId];
    const dName = divisionNames[dCode];
    const stats = seasonAccumulators[tId] || { pf: 0, pp: 0 };
    divTeamsMap[dName].push({
      id: tId,
      pf_per_game: stats.pf / 12,
      pp_per_game: stats.pp / 12
    });
  });

  // Upper Division Bonus
  const upper = divTeamsMap["Upper Division"];
  const upperAvgPF = upper.reduce((sum, t) => sum + t.pf_per_game, 0) / (upper.length || 1);
  upper.forEach(t => {
    const diff = t.pf_per_game - upperAvgPF;
    bonuses[t.id] = diff > 0 ? parseFloat((diff * 5).toFixed(2)) : 0.00;
  });

  // Middle Division Bonus
  const middle = divTeamsMap["Middle Division"];
  const middleMaxPP = Math.max(...middle.map(t => t.pp_per_game), 0);
  middle.forEach(t => {
    const diff = middleMaxPP - t.pp_per_game;
    bonuses[t.id] = parseFloat((diff * 5).toFixed(2));
  });

  // Lower Division Bonus
  const lower = divTeamsMap["Lower Division"];
  const lowerMaxPP = Math.max(...lower.map(t => t.pp_per_game), 0);
  lower.forEach(t => {
    const diff = lowerMaxPP - t.pp_per_game;
    bonuses[t.id] = parseFloat((diff * 5).toFixed(2));
  });

  return bonuses;
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

  // WEEKS 1 - 12 (Regular Season)
  for (let week = 1; week <= 12; week++) {
    const quarter = Math.ceil(week / 4);
    console.log(`Fetching Week ${week} (Quarter ${quarter})...`);

    if (week === 1 || week === 5 || week === 9) {
      quarterAccumulators = {};
    }

    let resultsData;
    try {
      resultsData = await fetchAPI('weeklyResults', { W: week.toString() });
    } catch (e) {
      console.error(`Failed to fetch Week ${week}:`, e);
      continue;
    }

    if (!resultsData || !resultsData.weeklyResults || !resultsData.weeklyResults.matchup) continue;

    const rawMatchups = Array.isArray(resultsData.weeklyResults.matchup)
      ? resultsData.weeklyResults.matchup
      : [resultsData.weeklyResults.matchup];

    const processedMatchups = [];
    const weeklyScoresMap = {};

    rawMatchups.forEach(m => {
      const franchisesList = Array.isArray(m.franchise) ? m.franchise : [m.franchise];
      if (franchisesList.length < 2) return;

      const f1 = franchisesList[0];
      const f2 = franchisesList[1];

      const score1 = parseFloat(f1.score || 0);
      const score2 = parseFloat(f2.score || 0);
      const pp1 = parseFloat(f1.opt_pts || score1 || 0);
      const pp2 = parseFloat(f2.opt_pts || score2 || 0);

      let vp1 = 0, vp2 = 0;
      if (score1 > score2) vp1 = 1;
      else if (score2 > score1) vp2 = 1;
      else { vp1 = 0.5; vp2 = 0.5; }

      processedMatchups.push({
        team1: { id: f1.id, name: franchises[f1.id]?.name || f1.id, score: score1, vp_earned: vp1 },
        team2: { id: f2.id, name: franchises[f2.id]?.name || f2.id, score: score2, vp_earned: vp2 }
      });

      [
        { id: f1.id, score: score1, pp: pp1, vp: vp1 },
        { id: f2.id, score: score2, pp: pp2, vp: vp2 }
      ].forEach(item => {
        weeklyScoresMap[item.id] = {
          id: item.id,
          name: franchises[item.id]?.name || item.id,
          score: item.score,
          pp: item.pp,
          division: activeDivisions[item.id],
          h2h_vp: item.vp
        };

        initTeamAcc(quarterAccumulators, item.id);
        initTeamAcc(seasonAccumulators, item.id);

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
      });
    });

    const battleRoyale = { "Upper Division": [], "Middle Division": [], "Lower Division": [] };
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
      active_divisions: { ...activeDivisions },
      matchups: processedMatchups,
      battle_royale: battleRoyale,
      quarter_standings: quarterStandings,
      season_standings: seasonStandings
    };

    if (week === 4 || week === 8 || week === 12) {
      console.log(`Evaluating Promotion/Relegation after Week ${week}...`);
      activeDivisions = evaluatePromotionRelegation(quarterStandings);
    }
  }

  // WEEKS 13 - 17 (Postseason Guillotine Matrix)
  const postseasonDivisions = { ...activeDivisions };
  const bonuses = calculatePostseasonBonuses(seasonAccumulators, postseasonDivisions);

  const draftSlotMap = {
    "Upper Division": { 1: "1.12", 2: "1.11", 3: "1.10", 4: "1.09" },
    "Middle Division": { 1: "1.05", 2: "1.06", 3: "1.07", 4: "1.08" },
    "Lower Division": { 1: "1.01", 2: "1.02", 3: "1.03", 4: "1.04" }
  };

  const postseasonScores = {};
  Object.keys(postseasonDivisions).forEach(tId => {
    postseasonScores[tId] = {
      id: tId,
      name: franchises[tId]?.name || tId,
      division: divisionNames[postseasonDivisions[tId]],
      head_start: bonuses[tId] || 0,
      scores: { "13": 0, "14": 0, "15": 0, "16": 0, "17": 0 },
      cumulative_after: { "13": bonuses[tId] || 0, "14": bonuses[tId] || 0, "15": bonuses[tId] || 0, "16": bonuses[tId] || 0, "17": bonuses[tId] || 0 },
      eliminated_week: null,
      finish_place: null,
      draft_slot: null
    };
  });

  for (let week = 13; week <= 17; week++) {
    console.log(`Fetching Postseason Week ${week}...`);
    let resultsData;
    try {
      resultsData = await fetchAPI('weeklyResults', { W: week.toString() });
    } catch (e) {
      console.error(`Failed to fetch Week ${week}:`, e);
      continue;
    }

    if (resultsData && resultsData.weeklyResults && resultsData.weeklyResults.matchup) {
      const rawMatchups = Array.isArray(resultsData.weeklyResults.matchup)
        ? resultsData.weeklyResults.matchup
        : [resultsData.weeklyResults.matchup];

      rawMatchups.forEach(m => {
        const franchisesList = Array.isArray(m.franchise) ? m.franchise : [m.franchise];
        franchisesList.forEach(f => {
          const score = parseFloat(f.score || 0);
          if (postseasonScores[f.id]) {
            postseasonScores[f.id].scores[week.toString()] = score;
          }
        });
      });
    }

    Object.keys(postseasonScores).forEach(tId => {
      let sum = postseasonScores[tId].head_start;
      for (let w = 13; w <= week; w++) {
        sum += (postseasonScores[tId].scores[w.toString()] || 0);
      }
      postseasonScores[tId].cumulative_after[week.toString()] = parseFloat(sum.toFixed(2));
    });

    ["Upper Division", "Middle Division", "Lower Division"].forEach(dName => {
      const divTeams = Object.values(postseasonScores).filter(t => t.division === dName);

      if (week === 14) {
        const active = divTeams.filter(t => !t.eliminated_week);
        if (active.length > 0) {
          const eliminated = active.reduce((min, t) => t.cumulative_after["14"] < min.cumulative_after["14"] ? t : min);
          eliminated.eliminated_week = 14;
          eliminated.finish_place = 4;
          eliminated.draft_slot = draftSlotMap[dName][4];
        }
      } else if (week === 15) {
        const active = divTeams.filter(t => !t.eliminated_week);
        if (active.length > 0) {
          const eliminated = active.reduce((min, t) => t.cumulative_after["15"] < min.cumulative_after["15"] ? t : min);
          eliminated.eliminated_week = 15;
          eliminated.finish_place = 3;
          eliminated.draft_slot = draftSlotMap[dName][3];
        }
      } else if (week === 17) {
        const active = divTeams.filter(t => !t.eliminated_week);
        if (active.length >= 2) {
          active.sort((a, b) => b.cumulative_after["17"] - a.cumulative_after["17"]);
          const winner = active[0];
          const second = active[1];

          second.eliminated_week = 17;
          second.finish_place = 2;
          second.draft_slot = draftSlotMap[dName][2];

          winner.finish_place = 1;
          winner.draft_slot = draftSlotMap[dName][1];
        }
      }
    });
  }

  const postseasonSummary = { "Upper Division": [], "Middle Division": [], "Lower Division": [] };
  Object.values(postseasonScores).forEach(t => {
    postseasonSummary[t.division].push(t);
  });

  Object.keys(postseasonSummary).forEach(d => {
    postseasonSummary[d].sort((a, b) => b.cumulative_after["17"] - a.cumulative_after["17"]);
  });

  leagueData.postseason_matrix = postseasonSummary;

  fs.writeFileSync('data.json', JSON.stringify(leagueData, null, 2));
  console.log("Successfully generated complete data.json with Postseason Matrix!");
}

main().catch(console.error);