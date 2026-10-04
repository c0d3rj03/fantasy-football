const fs = require('fs');
const path = require('path');

const targetYear = process.argv[2] || '2026';
const isHistoryYear = targetYear !== '2026';

const baseDir = isHistoryYear 
  ? path.join(__dirname, 'history', targetYear) 
  : __dirname;

const ktcDir = fs.existsSync(path.join(baseDir, 'ktc-values'))
  ? path.join(baseDir, 'ktc-values')
  : path.join(__dirname, 'ktc-values');

const dataPath = path.join(baseDir, `ktc-${targetYear}-data.json`);

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseValuation(p) {
  if (!p) return 0;

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
  }

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
  console.log(`🔄 Starting KeepTradeCut History Merge for Year: ${targetYear}...`);

  if (!fs.existsSync(ktcDir)) {
    console.error(`❌ Directory not found: ${ktcDir}`);
    console.log(`👉 Please create a 'ktc-values' folder inside 'pbr/' (or 'pbr/history/${targetYear}/') and place your KTC-YYYY-MM.json files into it.`);
    process.exit(1);
  }

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  let ktcData = {
    year: targetYear,
    last_updated: new Date().toISOString(),
    players: {},
    monthly_player_values: {}
  };

  const nameToSlugMap = {};

  const fileRegex = new RegExp(`^KTC-${targetYear}-(\\d{2})\\.json$`, 'i');
  const files = fs.readdirSync(ktcDir).filter(f => fileRegex.test(f)).sort();

  if (files.length === 0) {
    console.log(`⚠️ No KTC-${targetYear}-MM.json files found in ${ktcDir}`);
    return;
  }

  console.log(`📂 Found ${files.length} snapshot file(s) for ${targetYear}:`, files);

  let totalProcessed = 0;

  files.forEach(file => {
    const filePath = path.join(ktcDir, file);
    const match = file.match(fileRegex);
    if (!match) return;

    const month = match[1];
    const dateKey = `${targetYear}-${month}-01`;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const rawArray = JSON.parse(content);
      const playersList = Array.isArray(rawArray) ? rawArray : (rawArray.players || rawArray.data || []);

      const valueMap = {};

      playersList.forEach(p => {
        const rawName = (p.playerName || p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.slug || '').trim();
        if (!rawName) return;

        const pos = p.position || p.pos || 'FLEX';
        const team = p.team || 'FA';
        const val = parseValuation(p);

        const nameKey = `${rawName.toLowerCase()}_${pos.toLowerCase()}`;
        let slug = nameToSlugMap[nameKey];
        if (!slug) {
          slug = slugify(`${rawName}_${pos}`);
          nameToSlugMap[nameKey] = slug;
        }

        ktcData.players[slug] = { name: rawName, pos, team };
        valueMap[slug] = val;
      });

      const itemCount = Object.keys(valueMap).length;
      ktcData.monthly_player_values[dateKey] = valueMap;

      if (itemCount < 100) {
        if (!ktcData.warnings) ktcData.warnings = {};
        ktcData.warnings[dateKey] = `Low item count: ${itemCount} items parsed.`;
        console.warn(`  ⚠️ WARNING: ${file} ➔ "${dateKey}" only parsed ${itemCount} items (< 100 threshold)!`);
      } else {
        if (ktcData.warnings) delete ktcData.warnings[dateKey];
        console.log(`  ✅ Processed ${file} ➔ Snapshot key "${dateKey}" (${itemCount} items)`);
      }

      totalProcessed++;

    } catch (err) {
      console.error(`  ❌ Failed to parse ${file}: ${err.message}`);
    }
  });

  ktcData.last_updated = new Date().toISOString();

  fs.writeFileSync(dataPath, JSON.stringify(ktcData, null, 2));
  console.log(`\n🎉 Successfully merged ${totalProcessed} monthly snapshots into ${dataPath}!`);
}

runMerger();