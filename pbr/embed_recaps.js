const fs = require('fs');
const path = require('path');

// Target pbr/data.json relative to script location or project root
const dataPath = fs.existsSync(path.join(__dirname, 'pbr', 'data.json'))
  ? path.join(__dirname, 'pbr', 'data.json')
  : path.join(__dirname, 'data.json');

if (!fs.existsSync(dataPath)) {
  console.error("❌ Could not find data.json");
  process.exit(1);
}

const leagueData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

['1', '2', '3'].forEach(week => {
  // Check both pbr/gemmy_week_X.md and gemmy_week_X.md
  let mdPath = path.join(path.dirname(dataPath), `gemmy_week_${week}.md`);
  if (!fs.existsSync(mdPath)) {
    mdPath = path.join(__dirname, `gemmy_week_${week}.md`);
  }

  if (fs.existsSync(mdPath)) {
    const content = fs.readFileSync(mdPath, 'utf8');
    if (leagueData.weekly_data && leagueData.weekly_data[week]) {
      leagueData.weekly_data[week].recap = content;
      console.log(`✅ Embedded Week ${week} recap into data.json`);
    }
  } else {
    console.log(`⚠️ ${mdPath} not found.`);
  }
});

fs.writeFileSync(dataPath, JSON.stringify(leagueData, null, 2));
console.log("\n🎉 Successfully updated data.json with embedded recaps!");
