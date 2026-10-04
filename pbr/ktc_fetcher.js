const fs = require('fs');
const path = require('path');

const targetDate = process.argv[2] || new Date().toISOString().split('T')[0];
const [targetYear, targetMonth] = targetDate.split('-');

const isHistoryYear = targetYear !== '2026';
const baseDir = isHistoryYear 
  ? path.join(__dirname, 'history', targetYear) 
  : __dirname;

const ktcDir = path.join(baseDir, 'ktc-values');
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

async function fetchUrl(url, isText = false) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
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

    console.log(`✅ Successfully extracted ${rawPlayers.length} items from KeepTradeCut.`);

    if (!fs.existsSync(ktcDir)) fs.mkdirSync(ktcDir, { recursive: true });
    const ktcBackupFile = path.join(ktcDir, `KTC-${targetYear}-${targetMonth}.json`);
    fs.writeFileSync(ktcBackupFile, JSON.stringify(rawPlayers, null, 2));
    console.log(`💾 Saved raw KTC snapshot backup to ${ktcBackupFile}`);

    let ktcData = {
      year: targetYear,
      last_updated: new Date().toISOString(),
      players: {},
      monthly_player_values: {}
    };

    if (fs.existsSync(dataPath)) {
      try {
        ktcData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      } catch (e) {
        console.warn('Existing KTC data file was empty or corrupt, creating fresh.');
      }
    }

    const valueMap = {};
    rawPlayers.forEach(p => {
      const rawName = (p.playerName || p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.slug || '').trim();
      if (!rawName) return;

      const pos = p.position || p.pos || 'FLEX';
      const team = p.team || 'FA';
      const val = parseValuation(p);
      const slug = slugify(`${rawName}_${pos}`);

      ktcData.players[slug] = { name: rawName, pos, team };
      valueMap[slug] = val;
    });

    if (!ktcData.monthly_player_values) ktcData.monthly_player_values = {};
    ktcData.monthly_player_values[targetDate] = valueMap;
    ktcData.last_updated = new Date().toISOString();

    fs.writeFileSync(dataPath, JSON.stringify(ktcData, null, 2));
    console.log(`🎉 Successfully updated ${dataPath} for ${targetDate}!`);

  } catch (err) {
    console.error(`❌ KTC fetch failed: ${err.message}`);
    process.exit(1);
  }
}

run();