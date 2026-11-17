/**
 * BaD Week 11 "Ten Kissing Sisters": pair teams by projected score.
 *
 * Each team's best possible lineup (2 QB, 2 RB, 3 WR, 1 TE, 3 RB/WR/TE flex) is
 * built from MFL's projected scores at the moment the script runs. Teams are
 * ranked by that total; 1st plays 2nd, 3rd plays 4th, and so on. The
 * commissioner sets these on Thursday at 3pm ET (RULES, Schedule, Week 11).
 *
 * Usage: node kissing_sisters.js [--week 11] [--inspect | --dry-run | --apply]
 *   (no flag)  print the lineups and matchups from public exports; no login.
 *   --inspect  log in and print the WEEKSCHED form's fields (emails masked).
 *
 * Writes to MFL are not built yet: the WEEKSCHED field names come from --inspect.
 */
import fs from 'fs';
import { LEAGUE_ID, SEASON_YEAR, MFL_HOST, LINEUP, FLEX } from './config.js';

const USER_AGENT = 'BaDCommish/1.0 (+https://github.com/c0d3rj03/fantasy-football)';
const args = process.argv.slice(2);
const weekArg = args.indexOf('--week');
const WEEK = Number(weekArg >= 0 ? args[weekArg + 1] : (process.env.WEEK || 11));

const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

async function exportJson(type, params = {}, host = MFL_HOST) {
  const query = new URLSearchParams({ TYPE: type, L: LEAGUE_ID, JSON: '1', ...params });
  const res = await fetch(`https://${host}/${SEASON_YEAR}/export?${query}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`MFL export ${type}: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.error) throw new Error(`MFL export ${type}: ${JSON.stringify(json.error)}`);
  return json;
}

// Best lineup for one roster: fill the fixed slots by projection, then the flex
// slots with the best leftover RB/WR/TE. Greedy is optimal here because the
// flex accepts every position that is left over.
export function bestLineup(roster) {
  const byPos = {};
  for (const p of roster) (byPos[p.pos] ||= []).push(p);
  for (const list of Object.values(byPos)) list.sort((a, b) => b.proj - a.proj);
  const starters = [];
  const leftovers = [];
  for (const [pos, count] of Object.entries(LINEUP)) {
    const list = byPos[pos] || [];
    if (list.length < count) throw new Error(`Roster has only ${list.length} ${pos} (needs ${count}).`);
    starters.push(...list.slice(0, count).map(p => ({ ...p, slot: pos })));
    if (FLEX.positions.includes(pos)) leftovers.push(...list.slice(count));
  }
  leftovers.sort((a, b) => b.proj - a.proj);
  starters.push(...leftovers.slice(0, FLEX.count).map(p => ({ ...p, slot: 'FLEX' })));
  const total = Math.round(starters.reduce((s, p) => s + p.proj, 0) * 100) / 100;
  return { starters, total };
}

export async function computeMatchups(week = WEEK) {
  const [{ league }, { rosters }] = await Promise.all([exportJson('league'), exportJson('rosters')]);
  const names = Object.fromEntries(asArray(league.franchises.franchise).map(f => [f.id, f.name]));
  const franchises = asArray(rosters.franchise);
  const ids = franchises.flatMap(f => asArray(f.player).filter(p => p.status === 'ROSTER').map(p => p.id));

  const [{ projectedScores }, { players }] = await Promise.all([
    exportJson('projectedScores', { W: String(week), PLAYERS: ids.join(',') }),
    exportJson('players', { PLAYERS: ids.join(',') }, 'api.myfantasyleague.com')
  ]);
  // A blank score means MFL has no projection (bye week, injured): counts as 0.
  const proj = Object.fromEntries(asArray(projectedScores.playerScore).map(p => [p.id, Number(p.score) || 0]));
  const info = Object.fromEntries(asArray(players.player).map(p => [p.id, p]));

  const teams = franchises.map(f => {
    const roster = asArray(f.player)
      .filter(p => p.status === 'ROSTER')
      .map(p => ({ id: p.id, name: info[p.id]?.name || p.id, team: info[p.id]?.team || '', pos: info[p.id]?.position, proj: proj[p.id] ?? 0 }))
      .filter(p => ['QB', 'RB', 'WR', 'TE'].includes(p.pos));
    return { id: f.id, name: names[f.id] || f.id, ...bestLineup(roster) };
  });
  teams.sort((a, b) => b.total - a.total);
  teams.forEach((t, i) => { t.rank = i + 1; });

  const matchups = [];
  for (let i = 0; i < teams.length; i += 2) matchups.push([teams[i], teams[i + 1]]);
  return { week, teams, matchups, at: new Date() };
}

const etTime = d => d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

// Slack-ready post: one code block, so the columns line up in Slack.
export function slackPost({ week, teams, matchups, at }) {
  const w = Math.max(...teams.map(t => t.name.length));
  const lines = [];
  lines.push(`*Week ${week}: "Ten Kissing Sisters"* :kiss:`);
  lines.push(`Paired by best possible lineup on MFL projections (${etTime(at)}). 1st plays 2nd, 3rd plays 4th, and so on.`);
  lines.push('```');
  lines.push(`${padL('#', 2)}  ${pad('Team', w)}  ${padL('Proj', 6)}`);
  teams.forEach((t, i) => {
    lines.push(`${padL(t.rank, 2)}  ${pad(t.name, w)}  ${padL(t.total.toFixed(2), 6)}`);
    if (i % 2 === 1 && i < teams.length - 1) lines.push('');
  });
  lines.push('```');
  lines.push('*Matchups*');
  matchups.forEach(([a, b], i) => lines.push(`Game ${i + 1}: ${a.name} (${a.total.toFixed(2)}) vs ${b.name} (${b.total.toFixed(2)})`));
  return lines.join('\n');
}

export function lineupDetail({ teams }) {
  const out = [];
  for (const t of teams) {
    out.push(`${t.rank}. ${t.name} (${t.id}): ${t.total.toFixed(2)}`);
    for (const p of t.starters) out.push(`     ${pad(p.slot, 5)} ${pad(p.pos, 3)} ${pad(p.name, 28)} ${pad(p.team, 4)} ${padL(p.proj.toFixed(2), 6)}`);
  }
  return out.join('\n');
}

async function inspect(week) {
  const { MflCommishClient } = await import('../common/mfl_commish_client.js');
  const { describeForms } = await import('../common/mfl_csetup_form.js');
  const client = new MflCommishClient(SEASON_YEAR, LEAGUE_ID, MFL_HOST, { userAgent: USER_AGENT });
  await client.login();
  const html = await client.fetchCommishPage('WEEKSCHED', { W: String(week) });
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || '';
  console.log(`\n===== csetup C=WEEKSCHED&W=${week} (title "${title}", ${html.length} chars) =====\n${describeForms(html)}`);
}

async function main() {
  if (args.includes('--inspect')) return inspect(WEEK);
  if (args.includes('--apply') || args.includes('--dry-run')) {
    throw new Error('Setting the schedule is not built yet: run --inspect first so the WEEKSCHED field names are known.');
  }
  const result = await computeMatchups(WEEK);
  const post = slackPost(result);
  console.log(`${post}\n\n----- Best lineups -----\n${lineupDetail(result)}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Slack post\n\n\`\`\`\`text\n${post}\n\`\`\`\`\n\n### Best lineups\n\n\`\`\`text\n${lineupDetail(result)}\n\`\`\`\n`);
  }
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
