/**
 * Monthly KeepTradeCut snapshots in pbr/ktc-values/KTC-YYYY-MM.json, read for trade values.
 * Values are Superflex + TE-premium ("sf-tep"), as in the Token Tracker sheet.
 *
 * Three file formats exist, all read here:
 *   Kushan's feed (2021 to Sep 2026): [{ name, position, team, "sf-tep-value", ... }], with repeated
 *     rows (the sheet's VLOOKUP took the first), and no MFL IDs.
 *   Raw KTC page scrape: [{ playerName, position, team, mflid, superflexValues: { tep: { value } } }].
 *   Normalized (written by ktc_fetcher.js from Oct 2026): [{ name, position, team, mflid, "sf-tep-value" }].
 * Draft picks are rows with position "RDP" and names like "2027 Early 1st".
 */
const fs = require('fs');
const path = require('path');

const KTC_DIR = path.join(__dirname, 'ktc-values');

const nameOf = p => (p.name || p.playerName || '').trim();
const valueOf = p => {
  const v = p['sf-tep-value'] ?? p.superflexValues?.tep?.value;
  return v === undefined || v === null ? null : Number(v);
};

// "St. Brown, Amon-Ra" / "Amon-Ra St. Brown" / "Kenneth Walker III" → comparable key.
function normName(name) {
  let n = name || '';
  if (n.includes(',')) {
    const [last, first] = n.split(',').map(s => s.trim());
    n = `${first} ${last}`;
  }
  return n.toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Raw KTC page rows → normalized rows (what ktc_fetcher.js saves). */
function normalizeKtc(rows) {
  return rows
    .map(p => ({
      name: nameOf(p),
      position: p.position,
      team: p.team,
      ...(p.mflid ? { mflid: String(p.mflid) } : {}),
      'sf-tep-value': valueOf(p)
    }))
    .filter(p => p.name && p['sf-tep-value'] !== null);
}

const fileFor = month => path.join(KTC_DIR, `KTC-${month}.json`);
const availableMonths = () => fs.existsSync(KTC_DIR)
  ? fs.readdirSync(KTC_DIR).map(f => f.match(/^KTC-(\d{4}-\d{2})\.json$/)?.[1]).filter(Boolean).sort()
  : [];

const cache = {};

/**
 * Loads one month. Returns { month, byId: {mflid: value}, byName: {"name|POS": value},
 * nameOnly: {name: value | undefined if ambiguous}, pickValues: {"2027 Early 1st": value}, count }.
 */
function loadMonth(month) {
  if (cache[month]) return cache[month];
  const rows = JSON.parse(fs.readFileSync(fileFor(month), 'utf8'));
  const snap = { month, byId: {}, byName: {}, nameOnly: {}, pickValues: {}, count: 0 };
  const seenNames = {};
  for (const p of rows) {
    const name = nameOf(p);
    const value = valueOf(p);
    if (!name || value === null) continue;
    if (p.position === 'RDP') {
      if (!(name in snap.pickValues)) snap.pickValues[name] = value;
      continue;
    }
    const key = `${normName(name)}|${p.position}`;
    if (key in snap.byName) continue; // first row wins (Kushan's feed repeats players)
    snap.count++;
    snap.byName[key] = value;
    if (p.mflid) snap.byId[String(p.mflid)] = value;
    const n = normName(name);
    seenNames[n] = (seenNames[n] || 0) + 1;
    snap.nameOnly[n] = seenNames[n] > 1 ? undefined : value;
  }
  cache[month] = snap;
  return snap;
}

/**
 * Snapshot for a trade in `month` (YYYY-MM): that month's file, else the latest earlier one,
 * else the earliest later one. Returns { snap, fallback } (fallback true when not the exact month).
 */
function snapshotFor(month) {
  const months = availableMonths();
  if (!months.length) return { snap: null, fallback: true };
  if (months.includes(month)) return { snap: loadMonth(month), fallback: false };
  const earlier = months.filter(m => m < month);
  const use = earlier.length ? earlier[earlier.length - 1] : months[0];
  return { snap: loadMonth(use), fallback: true };
}

/**
 * KTC value of an MFL player in a snapshot. player: { id, name ("Last, First"), position }.
 * overrideName: KTC spelling to use when names differ (token_settings.json ktc_names).
 */
function playerValue(snap, player, overrideName) {
  if (!snap) return null;
  if (snap.byId[player.id] !== undefined) return snap.byId[player.id];
  const n = normName(overrideName || player.name);
  const byPos = snap.byName[`${n}|${player.position}`];
  if (byPos !== undefined) return byPos;
  return snap.nameOnly[n] ?? null;
}

module.exports = { KTC_DIR, normName, normalizeKtc, availableMonths, loadMonth, snapshotFor, playerValue, fileFor };
