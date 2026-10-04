/**
 * MFL-to-KTC Asset Mapper (mfl_ktc_mapper.js)
 * 
 * Maps MFL Player IDs & Draft Pick strings to KTC Canonical Slugs.
 * 
 * KEY INSIGHT:
 * MFL's database contains 2,600+ players (IDP, offensive linemen, retired/practice squad).
 * KTC only ranks ~500-550 active dynasty fantasy players & draft picks.
 * 
 * Unranked MFL players simply have $0 KTC value — they are NOT errors and do NOT belong
 * in an exception review queue.
 * 
 * Only active traded assets or unmapped KTC top assets are flagged for review.
 */

const fs = require('fs');
const path = require('path');

const mflPlayersPath = path.join(__dirname, 'mfl_players.json');
const ktcDataPath = path.join(__dirname, 'ktc-2026-data.json');
const mapOutputPath = path.join(__dirname, 'mfl_ktc_player_map.json');
const exceptionsPath = path.join(__dirname, 'unmatched_assets.json');

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cleanName(name) {
  if (!name) return '';
  let cleaned = name;
  if (cleaned.includes(',')) {
    const parts = cleaned.split(',').map(s => s.trim());
    cleaned = `${parts[1] || ''} ${parts[0] || ''}`.trim();
  }
  return cleaned
    .replace(/\b(Jr|Sr|III|II|IV|V)\b\.?/gi, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Convert MFL position codes to KTC standard positions
function normalizePos(pos) {
  if (!pos) return 'FLEX';
  const p = pos.toUpperCase();
  if (p === 'PK') return 'K';
  if (p === 'DEF' || p === 'OFF') return p;
  return p;
}

function runMapper() {
  console.log("🔄 Running MFL-to-KTC Asset Crosswalk Mapper...");

  if (!fs.existsSync(mflPlayersPath)) {
    console.error(`❌ Missing ${mflPlayersPath}. Please run 'node mfl_fetcher.js' first.`);
    return;
  }

  if (!fs.existsSync(ktcDataPath)) {
    console.error(`❌ Missing ${ktcDataPath}. Please run 'node merge_ktc_history.js 2026' first.`);
    return;
  }

  const mflData = JSON.parse(fs.readFileSync(mflPlayersPath, 'utf8'));
  const ktcData = JSON.parse(fs.readFileSync(ktcDataPath, 'utf8'));

  const mflPlayers = mflData.players || mflData;
  const ktcPlayers = ktcData.players || {};

  const crosswalkMap = {};
  const ktcSlugsFound = new Set();

  // Create lookup maps for MFL players
  const mflBySlug = {};
  const mflByNamePos = {};

  Object.entries(mflPlayers).forEach(([mflId, p]) => {
    const name = cleanName(p.name || `${p.first_name || ''} ${p.last_name || ''}`);
    const pos = normalizePos(p.position);
    if (!name) return;

    const slug = slugify(`${name}_${pos}`);
    mflBySlug[slug] = mflId;
    mflByNamePos[`${name.toLowerCase()}_${pos.toLowerCase()}`] = mflId;
  });

  // Match each KTC asset to an MFL ID
  let matchedCount = 0;
  const unmatchedKtcAssets = [];

  Object.entries(ktcPlayers).forEach(([ktcSlug, p]) => {
    const ktcName = cleanName(p.name);
    const ktcPos = normalizePos(p.pos);

    // 1. Direct Slug Match
    let mflId = mflBySlug[ktcSlug];

    // 2. Name + Pos Match
    if (!mflId) {
      mflId = mflByNamePos[`${ktcName.toLowerCase()}_${ktcPos.toLowerCase()}`];
    }

    // 3. Name-only fallback for skill positions
    if (!mflId && ['QB', 'RB', 'WR', 'TE', 'K'].includes(ktcPos)) {
      const match = Object.entries(mflPlayers).find(([, mp]) => {
        const mpName = cleanName(mp.name || `${mp.first_name || ''} ${mp.last_name || ''}`);
        return mpName.toLowerCase() === ktcName.toLowerCase() && normalizePos(mp.position) === ktcPos;
      });
      if (match) mflId = match[0];
    }

    if (mflId) {
      crosswalkMap[mflId] = ktcSlug;
      ktcSlugsFound.add(ktcSlug);
      matchedCount++;
    } else if (ktcPos !== 'RDP') {
      // Unmatched KTC player asset
      unmatchedKtcAssets.push({ ktcSlug, name: p.name, pos: p.pos });
    }
  });

  // Draft Pick Translation Rules (Explicitly embedded in crosswalk documentation)
  crosswalkMap["_draft_pick_rules"] = {
    "early": [1, 2, 3, 4],
    "mid": [5, 6, 7, 8],
    "late": [9, 10, 11, 12, 13, 14]
  };

  // Write Crosswalk Map
  fs.writeFileSync(mapOutputPath, JSON.stringify(crosswalkMap, null, 2));
  console.log(`✅ MFL-to-KTC crosswalk map generated: ${matchedCount} KTC assets mapped to MFL IDs.`);

  // Write Unmatched KTC Assets (only real fantasy assets missing from MFL)
  if (unmatchedKtcAssets.length > 0) {
    fs.writeFileSync(exceptionsPath, JSON.stringify(unmatchedKtcAssets, null, 2));
    console.log(`⚠️ ${unmatchedKtcAssets.length} KTC assets could not be matched to MFL IDs (saved to pbr/unmatched_assets.json).`);
  } else {
    if (fs.existsSync(exceptionsPath)) fs.unlinkSync(exceptionsPath);
    console.log(`🎉 100% of active KTC players mapped cleanly to MFL IDs! No exceptions found.`);
  }
}

runMapper();
