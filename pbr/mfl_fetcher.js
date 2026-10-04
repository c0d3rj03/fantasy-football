/**
 * MyFantasyLeague (MFL) Daily/Weekly Fetcher (mfl_fetcher.js)
 * 
 * Schedule: Daily or Weekly (or manual execution)
 * 
 * Actions:
 * 1. Fetches MFL Player Catalog (TYPE=players) -> pbr/mfl_players.json
 * 2. Fetches MFL Completed Trades (TYPE=transactions&TRANS_TYPE=TRADE)
 * 3. Fetches MFL Waiver Claims ($25+) (TYPE=transactions&TRANS_TYPE=BBID_WAIVER)
 * 4. Updates pbr/tokens_data.json
 */

const fs = require('fs');
const path = require('path');

const LEAGUE_ID = process.env.MFL_LEAGUE_ID || '63213';
const YEAR = process.env.MFL_YEAR || '2026';

const mflPlayersFile = path.join(__dirname, 'mfl_players.json');
const tokensDataFile = path.join(__dirname, 'tokens_data.json');

async function fetchUrl(url, isText = false) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`HTTP error ${res.status} from ${url}`);
  return isText ? await res.text() : await res.json();
}

/**
 * 1. Sync MFL Master Player Catalog
 */
async function syncMflPlayerCatalog() {
  console.log(`🏈 Syncing MFL Master Player Catalog for ${YEAR}...`);
  try {
    const url = `https://www42.myfantasyleague.com/${YEAR}/export?TYPE=players&L=${LEAGUE_ID}&DETAILS=1&JSON=1`;
    const data = await fetchUrl(url);
    const playersList = data?.players?.player || [];
    
    const catalog = {};
    playersList.forEach(p => {
      if (!p.id) return;
      catalog[p.id] = {
        name: p.name,
        position: p.position,
        team: p.team || 'FA'
      };
    });

    fs.writeFileSync(mflPlayersFile, JSON.stringify(catalog, null, 2));
    console.log(`✅ Saved ${Object.keys(catalog).length} MFL players to ${mflPlayersFile}`);
    return catalog;
  } catch (err) {
    console.error(`⚠️ MFL Player Catalog sync failed: ${err.message}`);
    return {};
  }
}

/**
 * 2. Fetch Completed Trades
 */
async function fetchMflTrades() {
  console.log(`🏈 Fetching MFL Trades for League ${LEAGUE_ID}...`);
  try {
    const url = `https://www42.myfantasyleague.com/${YEAR}/export?TYPE=transactions&L=${LEAGUE_ID}&TRANS_TYPE=TRADE&JSON=1`;
    const data = await fetchUrl(url);
    const transList = data?.transactions?.transaction || [];
    const trades = Array.isArray(transList) ? transList : [transList];

    return trades.map(t => {
      const tradeVal = parseInt(t.trade_value || 0, 10);
      let tokensAwarded = 2;
      if (tradeVal >= 30000) tokensAwarded = 10;
      else if (tradeVal >= 22500) tokensAwarded = 8;
      else if (tradeVal >= 15000) tokensAwarded = 6;
      else if (tradeVal >= 7500) tokensAwarded = 4;

      return {
        timestamp: t.timestamp,
        date: new Date(parseInt(t.timestamp, 10) * 1000).toISOString().split('T')[0],
        team1: t.franchise,
        team1_assets: t.franchise1_gave || '',
        team2: t.franchise2,
        team2_assets: t.franchise2_gave || '',
        total_value: tradeVal,
        tokens_awarded: tokensAwarded
      };
    });
  } catch (err) {
    console.error(`⚠️ MFL Trades fetch failed: ${err.message}`);
    return [];
  }
}

/**
 * 3. Fetch Waiver Claims ($25+)
 */
async function fetchMflWaivers() {
  console.log(`⚡ Fetching MFL Waiver Claims ($25+) for League ${LEAGUE_ID}...`);
  try {
    const url = `https://www42.myfantasyleague.com/${YEAR}/export?TYPE=transactions&L=${LEAGUE_ID}&TRANS_TYPE=BBID_WAIVER&JSON=1`;
    const data = await fetchUrl(url);
    const transList = data?.transactions?.transaction || [];
    const claims = Array.isArray(transList) ? transList : [transList];

    return claims
      .filter(c => parseFloat(c.bid || 0) >= 25)
      .map(c => ({
        timestamp: c.timestamp,
        date: new Date(parseInt(c.timestamp, 10) * 1000).toISOString().split('T')[0],
        team: c.franchise,
        player_id: c.transaction?.split(',')[0] || c.transaction,
        bid: parseFloat(c.bid),
        tokens_earned: 1
      }));
  } catch (err) {
    console.error(`⚠️ MFL Waivers fetch failed: ${err.message}`);
    return [];
  }
}

async function run() {
  await syncMflPlayerCatalog();

  let tokensData = {
    last_updated: new Date().toISOString(),
    teams: {},
    trades: [],
    waivers: []
  };

  if (fs.existsSync(tokensDataFile)) {
    try {
      tokensData = JSON.parse(fs.readFileSync(tokensDataFile, 'utf8'));
    } catch (e) {
      console.warn('Existing tokens_data.json was empty or invalid.');
    }
  }

  const mflTrades = await fetchMflTrades();
  if (mflTrades.length > 0) tokensData.trades = mflTrades;

  const mflWaivers = await fetchMflWaivers();
  if (mflWaivers.length > 0) tokensData.waivers = mflWaivers;

  tokensData.last_updated = new Date().toISOString();

  fs.writeFileSync(tokensDataFile, JSON.stringify(tokensData, null, 2));
  console.log(`🎉 Successfully updated ${tokensDataFile}!`);
}

run();
