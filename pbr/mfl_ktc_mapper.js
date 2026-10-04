const fs = require('fs');
const path = require('path');

const mflPlayersPath = path.join(__dirname, 'mfl_players.json');
const ktcDataPath = path.join(__dirname, 'ktc-2026-data.json');
const mapOutputPath = path.join(__dirname, 'mfl_ktc_player_map.json');
const unmatchedOutputPath = path.join(__dirname, 'unmatched_assets.json');

function cleanPlayerName(name) {
  if (!name) return '';
  let cleaned = name;
  if (cleaned.includes(',')) {
    const parts = cleaned.split(',').map(s => s.trim());
    cleaned = `${parts[1]} ${parts[0]}`;
  }
  return cleaned
    .replace(/\s+(jr\.?|sr\.?|iii|ii|iv|v)\b/gi, '')
    .replace(/[^a-z0-9\s]/gi, '')
    .toLowerCase()
    .trim();
}

function runMapper() {
  console.log("🔄 Running MFL-to-KTC Asset Crosswalk Mapper...");

  if (!fs.existsSync(mflPlayersPath)) {
    console.error(`❌ Missing ${mflPlayersPath}. Run 'node mfl_fetcher.js' first.`);
    process.exit(1);
  }

  if (!fs.existsSync(ktcDataPath)) {
    console.error(`❌ Missing ${ktcDataPath}. Run 'node merge_ktc_history.js 2026' first.`);
    process.exit(1);
  }

  const mflCatalog = JSON.parse(fs.readFileSync(mflPlayersPath, 'utf8'));
  const ktcData = JSON.parse(fs.readFileSync(ktcDataPath, 'utf8'));
  const ktcPlayers = ktcData.players || {};

  const mflNameToIdMap = {};
  Object.entries(mflCatalog).forEach(([mflId, details]) => {
    const cleanName = cleanPlayerName(details.name);
    const pos = (details.position || '').toUpperCase();
    if (cleanName) {
      mflNameToIdMap[`${cleanName}_${pos}`] = mflId;
      if (!mflNameToIdMap[cleanName]) {
        mflNameToIdMap[cleanName] = mflId;
      }
    }
  });

  const crosswalkMap = {};
  const unmatchedKtcAssets = [];

  Object.entries(ktcPlayers).forEach(([slug, details]) => {
    const cleanKtcName = cleanPlayerName(details.name);
    const pos = (details.pos || '').toUpperCase();

    let matchedMflId = mflNameToIdMap[`${cleanKtcName}_${pos}`] || mflNameToIdMap[cleanKtcName];

    if (matchedMflId) {
      crosswalkMap[matchedMflId] = slug;
    } else {
      unmatchedKtcAssets.push({ slug, ...details });
    }
  });

  fs.writeFileSync(mapOutputPath, JSON.stringify(crosswalkMap, null, 2));
  console.log(`✅ MFL-to-KTC crosswalk map generated: ${Object.keys(crosswalkMap).length} KTC assets mapped to MFL IDs.`);

  if (unmatchedKtcAssets.length > 0) {
    fs.writeFileSync(unmatchedOutputPath, JSON.stringify(unmatchedKtcAssets, null, 2));
    console.warn(`⚠️ ${unmatchedKtcAssets.length} active KTC assets unmapped. Details saved to pbr/unmatched_assets.json`);
  } else {
    if (fs.existsSync(unmatchedOutputPath)) fs.unlinkSync(unmatchedOutputPath);
    console.log(`🎉 100% of active KTC players mapped cleanly!`);
  }
}

runMapper();