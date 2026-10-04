/**
 * PBR KTC History Merger (merge_ktc_history.js)
 * 
 * Supports:
 * - Isolated yearly files (ktc-2026-data.json, history/2025/ktc-2025-data.json)
 * - Nested KTC October schema (p.superflexValues.tep.value) as well as legacy flat schemas
 * - Canonical slug normalization (drake_maye_qb, 2026_early_1st_rdp)
 * 
 * Usage:
 *   node merge_ktc_history.js [YEAR]
 *   Example: node merge_ktc_history.js 2026
 *   Example: node merge_ktc_history.js 2025
 */

const fs = require('fs');
const path = require('path');

const yearArg = process.argv[2] || '2026';
const isCurrentYear = (yearArg === '2026');

// Directories
const rootDir = __dirname;
const historyDir = path.join(rootDir, 'history', yearArg);
const targetDir = isCurrentYear ? rootDir : historyDir;

// KTC raw values input folder
const rawDirPrimary = isCurrentYear ? path.join(rootDir, 'ktc-values') : path.join(historyDir, 'ktc-values');
const rawDirFallback = path.join(rootDir, 'ktc-values');
const ktcDir = fs.existsSync(rawDirPrimary) ? rawDirPrimary : rawDirFallback;

// Output json path
const dataFileName = isCurrentYear ? `ktc-${yearArg}-data.json` : `ktc-${yearArg}-data.json`;
const dataPath = path.join(targetDir, dataFileName);

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseValuation(p) {
  if (!p) return 0;

  // 1. Nested superflexValues structure (e.g. p.superflexValues.tep.value)
  if (p.superflexValues) {
    if (p.superflexValues.tep) {
      if (typeof p.superflexValues.tep === 'object' && p.superflexValues.tep.value !== undefined) {
        return parseInt(p.superflexValues.tep.value, 10);
      }
      if (typeof p.superflexValues.tep === 'number' || typeof p.superflexValues.tep === 'string') {
        return parseInt(p.superflexValues.tep, 10);
      }
    }
    if (p.superflexValues.value !== undefined) {
      return parseInt(p.superflexValues.value, 10);
    }
    if (typeof p.superflexValues === 'number' || typeof p.superflexValues === 'string') {
      return parseInt(p.superflexValues, 10);
    }
  }

  // 2. Nested superflex object (e.g. p.superflex.tep.value)
  if (p.superflex && typeof p.superflex === 'object') {
    if (p.superflex.tep !== undefined) {
      const v = typeof p.superflex.tep === 'object' ? p.superflex.tep.value : p.superflex.tep;
      if (v !== undefined) return parseInt(v, 10);
    }
    if (p.superflex.value !== undefined) return parseInt(p.superflex.value, 10);
  }

  // 3. Flat properties (sf-tep-value, sfTepValue, superflexValue, etc.)
  if (p['sf-tep-value'] !== undefined) return parseInt(p['sf-tep-value'], 10);
  if (p.sfTepValue !== undefined) return parseInt(p.sfTepValue, 10);
  if (p.superflexValue !== undefined) return parseInt(p.superflexValue, 10);
  if (p['sf-value'] !== undefined) return parseInt(p['sf-value'], 10);
  if (p.sfValue !== undefined) return parseInt(p.sfValue, 10);
  if (p.value !== undefined) return parseInt(p.value, 10);
  if (p['tep-value'] !== undefined) return parseInt(p['tep-value'], 10);
  if (p.oneQBValue !== undefined) return parseInt(p.oneQBValue, 10);

  return 0;
}

function runMerger() {
  console.log(`🔄 Starting KeepTradeCut History Merge for Year: ${yearArg}...`);

  if (!fs.existsSync(ktcDir)) {
    console.error(`❌ Directory not found: ${ktcDir}`);
    console.log(`👉 Please place your KTC-${yearArg}-MM.json files in ${ktcDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let yearData = {
    year: yearArg,
    last_updated: new Date().toISOString(),
    players: {},
    monthly_player_values: {}
  };

  const regex = new RegExp(`^KTC-${yearArg}-(\\d{2})\\.json$`, 'i');
  const files = fs.readdirSync(ktcDir).filter(f => f.match(regex)).sort();

  if (files.length === 0) {
    console.log(`⚠️ No KTC-${yearArg}-MM.json files found in ${ktcDir}`);
    return;
  }

  console.log(`📂 Found ${files.length} snapshot file(s) for ${yearArg}:`, files);

  let totalProcessed = 0;

  files.forEach(file => {
    const filePath = path.join(ktcDir, file);
    const match = file.match(regex);
    if (!match) return;

    const month = match[1];
    const dateKey = `${yearArg}-${month}-01`;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const rawArray = JSON.parse(content);
      const playersList = Array.isArray(rawArray) ? rawArray : (rawArray.players || rawArray.data || []);

      const valueMap = {};

      playersList.forEach(p => {
        const rawName = (p.playerName || p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.slug || '').trim();
        if (!rawName || /^\d+$/.test(rawName)) return;

        const pos = p.position || p.pos || 'FLEX';
        const team = p.team || 'FA';
        const val = parseValuation(p);

        const slug = slugify(`${rawName}_${pos}`);

        yearData.players[slug] = { name: rawName, pos, team };
        valueMap[slug] = val;
      });

      const itemCount = Object.keys(valueMap).length;
      yearData.monthly_player_values[dateKey] = valueMap;

      if (itemCount < 100) {
        if (!yearData.warnings) yearData.warnings = {};
        yearData.warnings[dateKey] = `Low item count: ${itemCount} items parsed.`;
        console.warn(`  ⚠️ WARNING: ${file} ➔ "${dateKey}" only parsed ${itemCount} items (< 100 threshold)!`);
      } else {
        if (yearData.warnings) delete yearData.warnings[dateKey];
        console.log(`  ✅ Processed ${file} ➔ Snapshot key "${dateKey}" (${itemCount} items)`);
      }

      totalProcessed++;

    } catch (err) {
      console.error(`  ❌ Failed to parse ${file}: ${err.message}`);
    }
  });

  if (yearData.warnings && Object.keys(yearData.warnings).length === 0) {
    delete yearData.warnings;
  }

  yearData.last_updated = new Date().toISOString();

  fs.writeFileSync(dataPath, JSON.stringify(yearData, null, 2));
  console.log(`\n🎉 Successfully merged ${totalProcessed} monthly snapshots into ${dataPath}!`);
}

runMerger();
