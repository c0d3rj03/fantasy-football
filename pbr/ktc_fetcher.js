/**
 * Saves this month's KeepTradeCut dynasty values to pbr/ktc-values/KTC-YYYY-MM.json (RULES.md §8:
 * trade tokens use KTC values at the time of the trade; the league uses the 1st-of-month snapshot).
 *
 *   node ktc_fetcher.js            # this month (Eastern time); does nothing if the file already exists
 *   node ktc_fetcher.js 2026-11    # a given month's file name
 *   node ktc_fetcher.js --force    # overwrite an existing file
 *
 * Source: the keeptradecut.com/dynasty-rankings page (its playersArray has MFL IDs and SF/TEP values).
 * Fallback: Kushan's feed (the sheet's old source), which has no MFL IDs.
 * The file is normalized to { name, position, team, mflid, "sf-tep-value" } (see ktc_snapshots.js).
 */
const fs = require('fs');
const { KTC_DIR, normalizeKtc, fileFor } = require('./ktc_snapshots.js');

const KTC_URL = 'https://keeptradecut.com/dynasty-rankings';
const KUSHAN_URL = 'http://173.230.138.125/ktc_values.json';
const MIN_PLAYERS = 300;
const MIN_PICKS = 12;

const args = process.argv.slice(2);
const force = args.includes('--force');
const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' })
  .format(new Date()).slice(0, 7);
const month = args.find(a => /^\d{4}-\d{2}$/.test(a)) || thisMonth;

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

// The rankings page carries its players as JSON in <script id="ktc-players">; older pages had a
// `playersArray = [...]` literal instead.
function extractPlayersArray(html) {
  const tag = html.match(/<script[^>]*id=["']ktc-players["'][^>]*>([\s\S]*?)<\/script>/);
  if (tag) return JSON.parse(tag[1]);
  const at = html.indexOf('playersArray = [');
  const start = at === -1 ? -1 : html.indexOf('[', at);
  if (start === -1) throw new Error('playersArray not found on the KTC page');
  let depth = 0, inString = false, quote = '';
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === quote) inString = false;
    } else if (c === '"' || c === "'") {
      inString = true; quote = c;
    } else if (c === '[') {
      depth++;
    } else if (c === ']' && --depth === 0) {
      return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw new Error('playersArray on the KTC page is not closed');
}

function check(rows, source) {
  const picks = rows.filter(r => r.position === 'RDP').length;
  const players = rows.length - picks;
  if (players < MIN_PLAYERS || picks < MIN_PICKS) {
    throw new Error(`${source} gave ${players} players and ${picks} picks (need ${MIN_PLAYERS}+ and ${MIN_PICKS}+)`);
  }
  return { players, picks };
}

async function main() {
  const out = fileFor(month);
  if (fs.existsSync(out) && !force) {
    console.log(`KTC-${month}.json already exists; nothing to do (--force to refetch).`);
    return;
  }

  let rows, source;
  try {
    rows = normalizeKtc(extractPlayersArray(await fetchText(KTC_URL)));
    source = 'keeptradecut.com';
    check(rows, source);
  } catch (err) {
    console.warn(`⚠️ KTC page failed: ${err.message}. Trying Kushan's feed.`);
    rows = normalizeKtc(JSON.parse(await fetchText(KUSHAN_URL)));
    source = "Kushan's feed";
    check(rows, source);
  }

  const { players, picks } = check(rows, source);
  fs.mkdirSync(KTC_DIR, { recursive: true });
  fs.writeFileSync(out, `[\n${rows.map(r => JSON.stringify(r)).join(',\n')}\n]\n`);
  console.log(`✅ Saved KTC-${month}.json from ${source}: ${players} players, ${picks} draft picks.`);
}

main().catch(err => {
  console.error(`❌ KTC fetch failed: ${err.message}`);
  process.exit(1);
});
