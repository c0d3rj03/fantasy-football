// Recent MFL transactions as short readable lines for Gemmy's recap prompt:
// trades, waiver claims (with bids), free-agent adds/drops and IR moves.
// Read-only public exports; no login.
const { LEAGUE_ID, YEAR, MFL_HOST } = require('./config.js');

const asArray = x => (Array.isArray(x) ? x : x ? [x] : []);
// MFL lists ids as "a,b," with a trailing comma.
const ids = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);
const MAX_LINES = 30;
// Trades first: they're the best banter. IR moves last.
const ORDER = { TRADE: 0, BBID_WAIVER: 1, FREE_AGENT: 2, IR: 3 };

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'pbr-gemmy' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from MFL ${new URL(url).searchParams.get('TYPE')}`);
  const json = await res.json();
  if (json.error) throw new Error(`MFL ${new URL(url).searchParams.get('TYPE')} error: ${json.error.$t || JSON.stringify(json.error)}`);
  return json;
}
const leagueExport = (type, params = '') =>
  getJson(`https://${MFL_HOST}/${YEAR}/export?TYPE=${type}&L=${LEAGUE_ID}&JSON=1${params}`);
// players is only served by the api host.
const apiExport = (type, params = '') =>
  getJson(`https://api.myfantasyleague.com/${YEAR}/export?TYPE=${type}&JSON=1${params}`);

async function fetchPlayers(playerIds) {
  const players = {};
  const list = [...playerIds];
  for (let i = 0; i < list.length; i += 100) {
    const data = await apiExport('players', `&PLAYERS=${list.slice(i, i + 100).join(',')}`);
    asArray(data.players?.player).forEach(p => { players[p.id] = p; });
  }
  return players;
}

const ordinal = n => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`;

/**
 * Lines like "Sat: TRADE Peaky Fookin Blinders sends Jalen Royals (WR, KCC); The Meaty Ogres sends ...".
 * days: how far back to look (matches the Slack banter window).
 */
async function recentTransactions(days) {
  const [tx, league] = await Promise.all([
    // All types, filtered below: MFL sometimes rejects a TRANS_TYPE list that includes IR.
    leagueExport('transactions', `&DAYS=${days}`),
    leagueExport('league')
  ]);
  const team = {};
  asArray(league.league?.franchises?.franchise).forEach(f => { team[f.id] = f.name; });
  const all = asArray(tx.transactions?.transaction).filter(t => t.type in ORDER);

  const playerIds = new Set();
  for (const t of all) {
    const fields = t.type === 'TRADE' ? [t.franchise1_gave_up, t.franchise2_gave_up]
      : t.type === 'IR' ? [t.activated, t.deactivated]
        : (t.transaction || '').split('|');
    fields.flatMap(ids).filter(id => /^\d+$/.test(id)).forEach(id => playerIds.add(id));
  }
  const players = await fetchPlayers(playerIds);

  // "Royals, Jalen" (WR, KCC) → "Jalen Royals (WR, KCC)"; picks and FAAB spelled out.
  const asset = id => {
    const p = players[id];
    if (p) {
      const [last, first] = p.name.split(',').map(s => s.trim());
      return `${first ? `${first} ${last}` : last} (${p.position}${p.team && p.team !== 'FA' ? `, ${p.team}` : ''})`;
    }
    let m = id.match(/^FP_(\d{4})_(\d{4})_(\d+)$/);
    if (m) {
      const owner = team[m[1]] || m[1];
      return `${owner}${owner.endsWith('s') ? "'" : "'s"} ${m[2]} ${ordinal(Number(m[3]))}-round pick`;
    }
    m = id.match(/^DP_(\d+)_(\d+)$/);
    if (m) return `${YEAR} pick ${Number(m[1]) + 1}.${String(Number(m[2]) + 1).padStart(2, '0')}`;
    m = id.match(/^BB_([\d.]+)$/);
    if (m) return `$${Number(m[1])} FAAB`;
    return /^\d+$/.test(id) ? `player #${id}` : id;
  };
  const list = s => ids(s).map(asset).join(', ');
  const day = ts => new Date(Number(ts) * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'America/New_York' });

  const describe = t => {
    const who = team[t.franchise] || t.franchise;
    if (t.type === 'TRADE') {
      const comment = t.comments ? ` (comment: "${t.comments.slice(0, 150)}")` : '';
      return `TRADE ${who} sends ${list(t.franchise1_gave_up) || 'nothing'}; ${team[t.franchise2] || t.franchise2} sends ${list(t.franchise2_gave_up) || 'nothing'}${comment}`;
    }
    if (t.type === 'BBID_WAIVER') {
      const [added, bid, dropped] = (t.transaction || '').split('|');
      return `WAIVER ${who} claims ${list(added)} for $${Number(bid || 0)}${ids(dropped).length ? `, drops ${list(dropped)}` : ''}`;
    }
    if (t.type === 'FREE_AGENT') {
      const [added, dropped] = (t.transaction || '').split('|');
      const parts = [ids(added).length && `adds ${list(added)}`, ids(dropped).length && `drops ${list(dropped)}`].filter(Boolean);
      return parts.length ? `FREE AGENT ${who} ${parts.join(', ')}` : null;
    }
    const parts = [ids(t.deactivated).length && `moves ${list(t.deactivated)} to IR`, ids(t.activated).length && `activates ${list(t.activated)}`].filter(Boolean);
    return parts.length ? `IR ${who} ${parts.join(', ')}` : null;
  };

  return all
    .sort((a, b) => ORDER[a.type] - ORDER[b.type] || Number(b.timestamp) - Number(a.timestamp))
    .map(t => { const line = describe(t); return line && `${day(t.timestamp)}: ${line}`; })
    .filter(Boolean)
    .slice(0, MAX_LINES);
}

module.exports = { recentTransactions };

if (require.main === module) {
  recentTransactions(Number(process.argv[2] || 7))
    .then(lines => console.log(lines.join('\n') || '(no transactions)'))
    .catch(err => { console.error(`❌ ${err.message}`); process.exit(1); });
}
