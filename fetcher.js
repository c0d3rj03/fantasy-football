const fs = require('fs');

const LEAGUE_ID = "63213";
const API_KEY = "ahVo3smQvuWpx0WmPlrDYDEeFLox";
const SEASON_YEAR = "2025"; // Test bed season
const BASE_URL = `https://www.myfantasyleague.com/${SEASON_YEAR}/export`;

async function fetchMFLData(exportType, week = null) {
  // let url = `${BASE_URL}?TYPE=${exportType}&L=${LEAGUE_ID}&JSON=1&APIKEY=${API_KEY}`;
  let url = `${BASE_URL}?TYPE=${exportType}&L=${LEAGUE_ID}&JSON=1`;
  if (week) url += `&W=${week}`;

  // Print the exact URL being sent
  console.log(`\n-> Requesting URL: ${url}`);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'PBR-Dashboard/1.0' }
    });
    
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    
    // Grab the raw response text first to catch hidden MFL errors
    const rawText = await response.text(); 
    
    try {
      const jsonData = JSON.parse(rawText);
      if (jsonData.error) {
         console.error(`MFL API Error: ${jsonData.error}`);
      }
      return jsonData;
    } catch (parseError) {
      console.error("Failed to parse JSON. MFL returned this instead:", rawText);
      return null;
    }
    
  } catch (error) {
    console.error(`Error fetching ${exportType}:`, error);
    return null;
  }
}

async function main() {
  console.log(`Starting data fetch for ${SEASON_YEAR} season...`);

  // 1. Fetch League Info (Franchise names & Divisions)
  const leagueData = await fetchMFLData("league");
  if (!leagueData || !leagueData.league) {
    console.error("Failed to load league data.");
    return;
  }

  const franchises = {};
  const franchiseList = leagueData.league.franchises.franchise || [];
  franchiseList.forEach(f => {
    franchises[f.id] = {
      name: f.name,
      division: f.division || "Unassigned"
    };
  });

  const divisionsData = leagueData.league.divisions?.division || [];
  const divisionNames = {};
  divisionsData.forEach(d => {
    divisionNames[d.id] = d.name;
  });

  // Data structure output
  const outputData = {
    league: {
      id: LEAGUE_ID,
      year: SEASON_YEAR,
      name: "Premier Battle Royale",
      last_updated: new Date().toISOString()
    },
    quarters: {
      "1": { weeks: [1, 2, 3, 4], weekly_data: {} },
      "2": { weeks: [5, 6, 7, 8], weekly_data: {} },
      "3": { weeks: [9, 10, 11, 12], weekly_data: {} }
    }
  };

  // 2. Fetch Weeks 1-12 Matchups & Calculate VPs
  for (let week = 1; week <= 12; week++) {
    const quarter = Math.ceil(week / 4).toString();
    const resultsData = await fetchMFLData("weeklyResults", week);
    
    if (!resultsData || !resultsData.weeklyResults || !resultsData.weeklyResults.matchup) {
      continue;
    }

    const rawMatchups = resultsData.weeklyResults.matchup;
    const matchups = [];
    const weeklyScores = [];

    // Parse Head-to-Head Matchups
    rawMatchups.forEach(m => {
      const f1 = m.franchise[0];
      const f2 = m.franchise[1];

      const score1 = parseFloat(f1.score || 0);
      const score2 = parseFloat(f2.score || 0);

      let vp1 = 0, vp2 = 0;
      if (score1 > score2) vp1 = 1;
      else if (score2 > score1) vp2 = 1;
      else { vp1 = 0.5; vp2 = 0.5; }

      matchups.push({
        team1: { id: f1.id, name: franchises[f1.id]?.name || f1.id, score: score1, vp_earned: vp1 },
        team2: { id: f2.id, name: franchises[f2.id]?.name || f2.id, score: score2, vp_earned: vp2 }
      });

      weeklyScores.push({ id: f1.id, name: franchises[f1.id]?.name || f1.id, score: score1, division: franchises[f1.id]?.division, h2h_vp: vp1 });
      weeklyScores.push({ id: f2.id, name: franchises[f2.id]?.name || f2.id, score: score2, division: franchises[f2.id]?.division, h2h_vp: vp2 });
    });

    // Parse In-Division Battle Royale (Top 2 scores per division earn 1 VP)
    const battleRoyale = {};
    Object.keys(divisionNames).forEach(divId => {
      const divName = divisionNames[divId];
      const divTeams = weeklyScores.filter(t => t.division === divId).sort((a, b) => b.score - a.score);

      divTeams.forEach((t, idx) => {
        t.battle_vp = (idx < 2) ? 1 : 0;
        t.total_weekly_vp = t.h2h_vp + t.battle_vp;
      });

      battleRoyale[divName] = divTeams;
    });

    outputData.quarters[quarter].weekly_data[week.toString()] = {
      status: "FINAL",
      matchups: matchups,
      battle_royale: battleRoyale
    };
  }

  fs.writeFileSync("data.json", JSON.stringify(outputData, null, 2));
  console.log("Successfully generated data.json!");
}

main();