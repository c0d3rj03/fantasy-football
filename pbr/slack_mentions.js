// Slack @mentions for owners, added only to the text posted to Slack. The recap saved
// to data.json (the dashboard) stays plain, so the web page never shows <@U…> codes.
//
// PBR_SLACK_OWNERS (repo variable): JSON of franchise ID → Slack member ID,
//   e.g. {"0001":"U012ABCDEF","0002":"U034GHIJKL"}. A member ID is in the owner's
//   Slack profile: ⋮ → Copy member ID. Teams left out are simply not tagged.

function loadOwners(raw = process.env.PBR_SLACK_OWNERS) {
  if (!raw) return {};
  try {
    const owners = JSON.parse(raw);
    return Object.fromEntries(Object.entries(owners).filter(([fid, uid]) => /^\d{4}$/.test(fid) && /^[UW][A-Z0-9]+$/.test(uid)));
  } catch (e) {
    console.warn(`⚠️ PBR_SLACK_OWNERS is not valid JSON (${e.message}); posting without @mentions.`);
    return {};
  }
}

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Tags each owner once, after the first mention of their team:
 * "*Hamsterdam* gets flushed" → "*Hamsterdam* (<@U…>) gets flushed".
 * teams: { fid: teamName }. A straight apostrophe in a name also matches a curly one.
 */
function addMentions(text, teams, owners = loadOwners()) {
  let out = text;
  for (const [fid, uid] of Object.entries(owners)) {
    const name = teams[fid];
    if (!name || out.includes(`<@${uid}>`)) continue;
    const pattern = escapeRegex(name).replace(/'/g, "['’]");
    // Keep a closing bold/italic marker attached to the name, and skip a name already tagged.
    const re = new RegExp(`(${pattern})([*_]*)(?! \\(<@)`);
    out = out.replace(re, (m, n, close) => `${n}${close} (<@${uid}>)`);
  }
  return out;
}

// Removes the tags again (for text pulled back from Slack into data.json).
function stripMentions(text) {
  return (text || '').replace(/ ?\(<@[UW][A-Z0-9]+(\|[^>]*)?>\)/g, '').replace(/<@[UW][A-Z0-9]+(\|[^>]*)?>/g, '');
}

const DASHBOARD_URL = 'https://c0d3rj03.github.io/fantasy-football/pbr/';

// Posts to #officialcomms open with @channel (so everyone gets notified) and a dashboard link line.
function withChannelHeader(text, linkLabel = 'Results & standings on the PBR dashboard') {
  return `<!channel>\n<${DASHBOARD_URL}|📊 ${linkLabel}>\n\n${text}`;
}

// Removes that header again (for text pulled back from Slack into data.json).
function stripChannelHeader(text) {
  return (text || '')
    .replace(/^\s*<!channel>\s*\n?/, '')
    .replace(/^\s*<https:\/\/c0d3rj03\.github\.io\/fantasy-football\/pbr\/?[^>]*>\s*\n*/, '');
}

// { fid: team name } from data.json's weekly matchups.
function teamNamesFrom(pbrData) {
  const names = {};
  for (const w of Object.values(pbrData.weekly_data || {})) {
    for (const m of w.matchups || []) for (const t of [m.team1, m.team2]) if (t?.id && t.name) names[t.id] = t.name;
  }
  return names;
}

module.exports = { loadOwners, addMentions, stripMentions, withChannelHeader, stripChannelHeader, teamNamesFrom, DASHBOARD_URL };
