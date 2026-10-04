/**
 * KeepTradeCut Monthly Snapshot Fetcher (ktc_fetcher.js)
 * 
 * Schedule: 1st of every month (or manual execution)
 * 
 * Actions:
 * 1. Fetches live KeepTradeCut rankings from https://keeptradecut.com/dynasty-rankings
 * 2. Saves raw snapshot backup to pbr/ktc-values/KTC-YYYY-MM.json
 * 3. Updates pbr/ktc-YYYY-data.json (or pbr/history/YYYY/ktc-YYYY-data.json)
 */

const fs = require('fs');
const path = require('path');

const targetDate = process.argv[2] || new Date().toISOString().split('T')[0];
const [year, month] = targetDate.split('-');

const isCurrentYear = year === new Date().getFullYear().toString();
const targetDir = isCurrentYear 
  ? __dirname 
  : path.join(__dirname, 'history', year);

const ktcDir = path.join(targetDir, 'ktc-values');
const ktcDataFile = path.join(targetDir, `ktc-${year}-data.json`);

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

async function fetchUrl(url, isText = false) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  if (!res.ok) throw new Error(`HTTP error ${res.status} from ${url}`);
  return isText ? await res.text() : await res.json();
}

async function run() {
  console.log(`🌐 Fetching KeepTradeCut rankings for snapshot date: ${targetDate}...`);
  try {
    const html = await fetchUrl('https://keeptradecut.com/dynasty-rankings', true);
    
    const scriptMatch = html.match(/<script[^>]*id=["']ktc-players["'][^>]*>(.*?)<\/script>/s);
    let rawPlayers = [];

    if (scriptMatch && scriptMatch[1]) {
      rawPlayers = JSON.parse(scriptMatch[1]);
    } else {
      const arrayIdx = html.indexOf('playersArray');
      if (arrayIdx !== -1) {
        const startBracket = html.indexOf('[', arrayIdx);
        if (startBracket !== -1) {
          let openBrackets = 0;
          let endBracket = -1;
          let inString = false;
          let stringChar = '';

          for (let i = startBracket; i < html.length; i++) {
            const char = html[i];
            if (inString) {
              if (char === stringChar && html[i - 1] !== '\\') inString = false;
            } else {
              if (char === '"' || char === "'") { inString = true; stringChar = char; }
              else if (char === '[') openBrackets++;
              else if (char === ']') {
                openBrackets--;
                if (openBrackets === 0) { endBracket = i; break; }
              }
            }
          }
          if (endBracket !== -1) {
            rawPlayers = JSON.parse(html.substring(startBracket, endBracket + 1));
          }
        }
      }
    }

    if (!rawPlayers || rawPlayers.length < 100) {
      throw new Error(`KTC extraction yielded only ${rawPlayers ? rawPlayers.length : 0} items (< 100 safety threshold). Aborting save.`);
    }

    console.log(`✅ Successfully extracted ${rawPlayers.length} items (players & draft picks) from KeepTradeCut.`);

    // 1. Save raw snapshot backup
    if (!fs.existsSync(ktcDir)) fs.mkdirSync(ktcDir, { recursive: true });
    const ktcBackupFile = path.join(ktcDir, `KTC-${year}-${month}.json`);
    fs.writeFileSync(ktcBackupFile, JSON.stringify(rawPlayers, null, 2));
    console.log(`💾 Saved raw KTC snapshot backup to ${ktcBackupFile}`);

    // 2. Load or initialize ktc-YYYY-data.json
    let seasonKtcData = {
      year,
      last_updated: new Date().toISOString(),
      players: {},
      monthly_player_values: {}
    };

    if (fs.existsSync(ktcDataFile)) {
      try {
        seasonKtcData = JSON.parse(fs.readFileSync(ktcDataFile, 'utf8'));
      } catch (e) {
        console.warn(`Existing ${ktcDataFile} was empty or invalid. Initializing fresh.`);
      }
    }

    if (!seasonKtcData.players) seasonKtcData.players = {};
    if (!seasonKtcData.monthly_player_values) seasonKtcData.monthly_player_values = {};

    // 3. Process raw players
    const dateKey = `${year}-${month}-01`;
    const valueMap = {};

    rawPlayers.forEach(p => {
      const rawName = (p.playerName || p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.slug || '').trim();
      if (!rawName || /^\d+$/.test(rawName)) return;

      const pos = p.position || p.pos || 'FLEX';
      const team = p.team || 'FA';
      const val = parseValuation(p);

      const slug = slugify(`${rawName}_${pos}`);

      seasonKtcData.players[slug] = { name: rawName, pos, team };
      valueMap[slug] = val;
    });

    seasonKtcData.monthly_player_values[dateKey] = valueMap;
    if (seasonKtcData.warnings) delete seasonKtcData.warnings[dateKey];
    seasonKtcData.last_updated = new Date().toISOString();

    fs.writeFileSync(ktcDataFile, JSON.stringify(seasonKtcData, null, 2));
    console.log(`🎉 Successfully updated ${ktcDataFile} for ${dateKey} (${Object.keys(valueMap).length} items)!`);

  } catch (err) {
    console.error(`⚠️ KTC fetch failed: ${err.message}`);
  }
}

run();
