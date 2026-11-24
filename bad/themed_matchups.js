/**
 * BaD themed weeks: works out a week's head-to-head matchups and sets them on MFL.
 *
 *   Week 10 "I've Earned This": standings after Week 9, 1st vs 10th, 2nd vs 9th, ...
 *   Week 11 "Ten Kissing Sisters": each team's best possible lineup (2 QB, 2 RB,
 *     3 WR, 1 TE, 3 RB/WR/TE flex) from MFL's projections at the moment the
 *     script runs; 1st vs 2nd, 3rd vs 4th, ... (set Thursday 3pm ET).
 *   Week 12 "Separate the Wheat from the Chaff": standings after Week 11,
 *     1st vs 6th, 2nd vs 7th, ... 5th vs 10th (set Tuesday).
 * Weeks 13 and 14 are picked by the owners, so they are not here.
 *
 * Standings (bylaws): victory points (2 for an H2H win, 1 for a top-5 score
 * that week), then win %, head-to-head (2 teams: their record against each
 * other; 3+: only a team that swept the others), points for, points against.
 * They are computed from MFL's final weekly results and must match MFL's VP.
 *
 * Usage: node themed_matchups.js --week N [--inspect | --dry-run | --apply [--force]]
 *   (no flag)  print the Slack post and details from public exports; no login.
 *   --inspect  log in and print the WEEKSCHED form's fields (emails masked).
 *   --dry-run  log in and log the exact WEEKSCHED field changes; post nothing.
 *   --apply    save the matchups on MFL, then re-read the schedule export.
 *   --force    replace matchups MFL already has for the week (otherwise refused,
 *              so a late rerun can't reshuffle games).
 *   --post-slack  with --apply: post the Slack text to the league's #general
 *              (BAD_SLACK_WEBHOOK_URL) once MFL confirms the save.
 * node themed_matchups.js --slack-test  posts a one-line test message.
 */
import fs from 'fs';
import { LEAGUE_ID, SEASON_YEAR, MFL_HOST, LINEUP, FLEX } from './config.js';

const USER_AGENT = 'BaDCommish/1.0 (+https://github.com/c0d3rj03/fantasy-football)';

// Standings-based themes: [higher rank, lower rank] per game, 1-based.
const THEMES = {
  10: { title: "I've Earned This", emoji: ':medal:', rule: 'Best plays the worst: 1st vs 10th, 2nd vs 9th, and so on.',
    pairs: [[1, 10], [2, 9], [3, 8], [4, 7], [5, 6]] },
  11: { title: 'Ten Kissing Sisters', emoji: ':kiss:', projected: true },
  12: { title: 'Separate the Wheat from the Chaff', emoji: ':ear_of_rice:', rule: 'The top half plays the bottom half: 1st vs 6th, 2nd vs 7th, and so on.',
    pairs: [[1, 6], [2, 7], [3, 8], [4, 9], [5, 10]] }
};

const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
const decode = s => String(s).replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"');

async function exportJson(type, params = {}, host = MFL_HOST) {
  const query = new URLSearchParams({ TYPE: type, L: LEAGUE_ID, JSON: '1', ...params });
  const res = await fetch(`https://${host}/${SEASON_YEAR}/export?${query}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`MFL export ${type}: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.error) throw new Error(`MFL export ${type}: ${JSON.stringify(json.error)}`);
  return json;
}

async function franchiseNames() {
  const { league } = await exportJson('league');
  return Object.fromEntries(asArray(league.franchises.franchise).map(f => [f.id, decode(f.name)]));
}

// ---------- Week 11: projections ----------

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

async function projectedMatchups(week) {
  const [names, { rosters }] = await Promise.all([franchiseNames(), exportJson('rosters')]);
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
  return { week, kind: 'projected', teams, matchups, at: new Date() };
}

// ---------- Weeks 10 and 12: standings ----------

// Final results for Weeks 1..throughWeek from the schedule export. MFL fills in
// scores and W/L only once a week is final (until then: score 0, result T).
async function finalResults(throughWeek) {
  const { schedule } = await exportJson('schedule');
  const weeks = asArray(schedule.weeklySchedule).filter(w => Number(w.week) <= throughWeek);
  const games = [];
  for (const w of weeks) {
    for (const m of asArray(w.matchup)) {
      const [a, b] = asArray(m.franchise);
      games.push({ week: Number(w.week), a: { id: a.id, score: Number(a.score) || 0, result: a.result }, b: { id: b.id, score: Number(b.score) || 0, result: b.result } });
    }
  }
  for (let wk = 1; wk <= throughWeek; wk++) {
    const g = games.filter(x => x.week === wk);
    if (g.length === 0 || g.some(x => x.a.score === 0 && x.b.score === 0)) {
      throw new Error(`Week ${wk} isn't final on MFL yet (no scores in the schedule export). Try again later.`);
    }
  }
  return games;
}

export function computeStandings(games, names) {
  const t = {};
  const team = id => (t[id] ||= { id, name: names[id] || id, vp: 0, w: 0, l: 0, tie: 0, pf: 0, pa: 0, vsWins: {}, vsGames: {} });
  for (const week of [...new Set(games.map(g => g.week))]) {
    const wk = games.filter(g => g.week === week);
    const scores = wk.flatMap(g => [g.a.score, g.b.score]).sort((x, y) => y - x);
    const fifth = scores[4];
    for (const g of wk) {
      for (const [me, opp] of [[g.a, g.b], [g.b, g.a]]) {
        const s = team(me.id);
        s.pf += me.score;
        s.pa += opp.score;
        s.vsGames[opp.id] = (s.vsGames[opp.id] || 0) + 1;
        if (me.result === 'W') { s.w++; s.vp += 2; s.vsWins[opp.id] = (s.vsWins[opp.id] || 0) + 1; }
        else if (me.result === 'L') s.l++;
        else s.tie++;
        if (me.score >= fifth) s.vp += 1;
      }
    }
  }
  const all = Object.values(t);
  for (const s of all) {
    s.pct = (s.w + s.tie / 2) / (s.w + s.l + s.tie);
    s.pf = Math.round(s.pf * 100) / 100;
    s.pa = Math.round(s.pa * 100) / 100;
  }

  const notes = [];
  const label = s => s.name;
  // Orders a group tied on VP, using the tiebreakers from step i on.
  const steps = ['pct', 'h2h', 'pf', 'pa'];
  const stepName = { pct: 'win %', h2h: 'head-to-head', pf: 'points for', pa: 'points against' };
  function order(group, i = 0) {
    if (group.length <= 1) return group;
    if (i >= steps.length) {
      notes.push(`${group.map(label).join(', ')} are tied on every tiebreaker (left in franchise order; commissioner's call).`);
      return [...group].sort((a, b) => a.id.localeCompare(b.id));
    }
    const step = steps[i];
    if (step === 'h2h') {
      if (group.length === 2) {
        const [a, b] = group;
        const aw = a.vsWins[b.id] || 0;
        const bw = b.vsWins[a.id] || 0;
        if (aw !== bw) {
          const [win, lose] = aw > bw ? [a, b] : [b, a];
          notes.push(`${label(win)} over ${label(lose)} on head-to-head (${Math.max(aw, bw)}-${Math.min(aw, bw)}).`);
          return [win, lose];
        }
        return order(group, i + 1);
      }
      // 3+ tied: only a team that beat every other one in every meeting wins it.
      const sweepers = group.filter(s => group.every(o => o === s || ((s.vsGames[o.id] || 0) > 0 && (s.vsWins[o.id] || 0) === s.vsGames[o.id])));
      if (sweepers.length === 1) {
        const rest = group.filter(s => s !== sweepers[0]);
        notes.push(`${label(sweepers[0])} swept ${rest.map(label).join(', ')} head-to-head.`);
        return [sweepers[0], ...order(rest, 0)];
      }
      return order(group, i + 1);
    }
    const values = [...new Set(group.map(s => s[step]))].sort((x, y) => y - x);
    if (values.length === 1) return order(group, i + 1);
    const parts = values.map(v => group.filter(s => s[step] === v));
    const fmt = v => (step === 'pct' ? v.toFixed(3) : v.toFixed(2));
    notes.push(`${group.map(label).join(', ')} tied on VP; ${stepName[step]}: ${parts.map(p => `${p.map(label).join(' = ')} (${fmt(p[0][step])})`).join(', ')}.`);
    return parts.flatMap(p => order(p, i + 1));
  }

  const vps = [...new Set(all.map(s => s.vp))].sort((x, y) => y - x);
  const ranked = vps.flatMap(v => order(all.filter(s => s.vp === v)));
  ranked.forEach((s, i) => { s.rank = i + 1; });
  return { teams: ranked, notes };
}

async function standingsMatchups(week) {
  const theme = THEMES[week];
  const [names, games, { leagueStandings }] = await Promise.all([franchiseNames(), finalResults(week - 1), exportJson('leagueStandings')]);
  const { teams, notes } = computeStandings(games, names);

  // MFL's standings must agree when they cover the same weeks; they lag the
  // schedule export briefly after a week goes final.
  const mfl = asArray(leagueStandings.franchise);
  const played = mfl.map(f => Number(f.h2hw) + Number(f.h2hl) + Number(f.h2ht));
  if (played.some(n => n < week - 1)) {
    throw new Error(`MFL standings don't include Week ${week - 1} yet (games played: ${[...new Set(played)].join('/')}). Try again later.`);
  }
  if (played.every(n => n === week - 1)) {
    const off = mfl.filter(f => teams.find(s => s.id === f.id)?.vp !== Number(f.vp));
    if (off.length) {
      throw new Error(`Computed VP differs from MFL for ${off.map(f => `${decode(f.fname)} (MFL ${f.vp}, computed ${teams.find(s => s.id === f.id)?.vp})`).join(', ')}. Check standings adjustments before setting Week ${week}.`);
    }
    console.log(`✓ VP matches MFL standings for all ${mfl.length} teams.`);
  } else {
    console.log(`(MFL standings are past Week ${week - 1}; VP check skipped.)`);
  }

  const byRank = Object.fromEntries(teams.map(s => [s.rank, s]));
  const matchups = theme.pairs.map(([hi, lo]) => [byRank[hi], byRank[lo]]);
  return { week, kind: 'standings', teams, matchups, notes, at: new Date() };
}

export async function computeMatchups(week) {
  const theme = THEMES[week];
  if (!theme) throw new Error(`Week ${week} has no automated theme (only ${Object.keys(THEMES).join(', ')}).`);
  return theme.projected ? projectedMatchups(week) : standingsMatchups(week);
}

// ---------- Output ----------

const etTime = d => d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

// Slack-ready post: one code block, so the columns line up in Slack.
export function slackPost(result) {
  const { week, kind, teams, matchups, at } = result;
  const theme = THEMES[week];
  const w = Math.max(...teams.map(t => t.name.length));
  const lines = [`*Week ${week}: "${theme.title}"* ${theme.emoji}`];
  if (kind === 'projected') {
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
  } else {
    lines.push(`${theme.rule} Based on standings after Week ${week - 1}.`);
    lines.push('```');
    lines.push(`${padL('#', 2)}  ${pad('Team', w)}  ${padL('VP', 3)}  ${pad('W-L', 5)}  ${padL('PF', 8)}`);
    const half = theme.pairs.length;
    teams.forEach((t, i) => {
      if (week === 12 && i === half) lines.push('');
      lines.push(`${padL(t.rank, 2)}  ${pad(t.name, w)}  ${padL(t.vp, 3)}  ${pad(`${t.w}-${t.l}${t.tie ? `-${t.tie}` : ''}`, 5)}  ${padL(t.pf.toFixed(2), 8)}`);
    });
    lines.push('```');
    lines.push('*Matchups*');
    matchups.forEach(([a, b], i) => lines.push(`Game ${i + 1}: (${a.rank}) ${a.name} vs (${b.rank}) ${b.name}`));
    if (result.notes.length) lines.push(`_Tiebreakers: ${result.notes.join(' ')}_`);
  }
  return lines.join('\n');
}

export function detail(result) {
  if (result.kind !== 'projected') {
    return result.teams.map(t => `${padL(t.rank, 2)}. ${t.id} ${pad(t.name, 24)} VP ${padL(t.vp, 2)}  ${t.w}-${t.l}-${t.tie}  pct ${t.pct.toFixed(3)}  PF ${t.pf.toFixed(2)}  PA ${t.pa.toFixed(2)}`).join('\n');
  }
  const out = [];
  for (const t of result.teams) {
    out.push(`${t.rank}. ${t.name} (${t.id}): ${t.total.toFixed(2)}`);
    for (const p of t.starters) out.push(`     ${pad(p.slot, 5)} ${pad(p.pos, 3)} ${pad(p.name, 28)} ${pad(p.team, 4)} ${padL(p.proj.toFixed(2), 6)}`);
  }
  return out.join('\n');
}

// ---------- MFL ----------

async function inspect(week) {
  const { MflCommishClient } = await import('../common/mfl_commish_client.js');
  const { describeForms } = await import('../common/mfl_csetup_form.js');
  const client = new MflCommishClient(SEASON_YEAR, LEAGUE_ID, MFL_HOST, { userAgent: USER_AGENT });
  await client.login();
  const html = await client.fetchCommishPage('WEEKSCHED', { W: String(week) });
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || '';
  console.log(`\n===== csetup C=WEEKSCHED&W=${week} (title "${title}", ${html.length} chars) =====\n${describeForms(html)}`);
}

// Matchups MFL has for the week, as sorted "a-b" pairs.
async function mflPairs(week) {
  const { schedule } = await exportJson('schedule', { W: String(week) });
  const weekly = asArray(schedule?.weeklySchedule).find(w => Number(w.week) === week) || {};
  return asArray(weekly.matchup)
    .map(m => asArray(m.franchise).map(f => f.id).sort().join('-'))
    .filter(p => !p.includes('BYE'))
    .sort();
}

// WEEKSCHED form (csetup C=WEEKSCHED&W=<week>, --inspect 2026-11-17): rows
// AWAY_<n> / HOME_<n> (selects of franchise IDs or BYE), DEL_<n>, SUBMIT.
// The higher-ranked team of each pair is home.
async function setSchedule(result, { apply, force }) {
  const week = result.week;
  const want = result.matchups.map(([a, b]) => [a.id, b.id].sort().join('-')).sort();
  const have = await mflPairs(week);
  if (have.join() === want.join()) {
    console.log(`\n✅ MFL already has these Week ${week} matchups. Nothing to do.`);
    return 'unchanged';
  }
  if (have.length > 0 && !force) {
    throw new Error(`MFL already has different Week ${week} matchups (${have.join(', ')}). Rerun with force to replace them.`);
  }

  const { MflCommishClient } = await import('../common/mfl_commish_client.js');
  const client = new MflCommishClient(SEASON_YEAR, LEAGUE_ID, MFL_HOST, { userAgent: USER_AGENT });
  await client.login();
  const changes = {};
  result.matchups.forEach(([home, away], n) => {
    changes[`HOME_${n}`] = home.id;
    changes[`AWAY_${n}`] = away.id;
  });
  const changed = await client.submitCsetupForm('WEEKSCHED', changes, {
    dryRun: !apply, params: { W: String(week) }, requireExisting: true, submit: 'SUBMIT'
  });
  console.log(`\n${apply ? '✍️ Saved' : '🧪 Dry run, would save'} WEEKSCHED W=${week}:\n  ${changed.join('\n  ') || '(no field changes)'}`);
  if (!apply) return 'dry-run';

  for (let attempt = 1; attempt <= 3; attempt++) {
    await new Promise(r => setTimeout(r, 5000));
    const now = await mflPairs(week);
    if (now.join() === want.join()) {
      console.log(`✅ Confirmed on MFL: ${now.join(', ')}`);
      return 'saved';
    }
    console.log(`  check ${attempt}: MFL shows ${now.join(', ') || 'no matchups'}`);
  }
  throw new Error(`MFL does not show the Week ${week} matchups after saving. Check csetup?L=${LEAGUE_ID}&C=WEEKSCHED&W=${week}.`);
}

// ---------- Slack (league #general, incoming webhook) ----------

// Posts text to BAD_SLACK_WEBHOOK_URL. The URL is a secret: never log it.
async function postToSlack(text) {
  const url = process.env.BAD_SLACK_WEBHOOK_URL;
  if (!url) throw new Error('BAD_SLACK_WEBHOOK_URL is not set, so nothing was posted to Slack.');
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  const body = await res.text();
  if (!res.ok || body.trim() !== 'ok') throw new Error(`Slack webhook answered ${res.status}: ${body.slice(0, 200)}`);
  console.log('📣 Posted to Slack.');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--slack-test')) {
    return postToSlack(':wave: Test from the BaD commissioner tools: themed-week matchups will post here once they are set on MFL.');
  }
  const weekArg = args.indexOf('--week');
  const week = Number(weekArg >= 0 ? args[weekArg + 1] : process.env.WEEK);
  if (!week) throw new Error('Pass --week N (or set WEEK).');
  if (args.includes('--inspect')) return inspect(week);

  const result = await computeMatchups(week);
  const post = slackPost(result);
  const more = detail(result);
  console.log(`${post}\n\n----- ${result.kind === 'projected' ? 'Best lineups' : 'Standings detail'} -----\n${more}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Slack post\n\n\`\`\`\`text\n${post}\n\`\`\`\`\n\n### Detail\n\n\`\`\`text\n${more}\n\`\`\`\n`);
  }
  if (args.includes('--apply') || args.includes('--dry-run')) {
    const status = await setSchedule(result, { apply: args.includes('--apply'), force: args.includes('--force') });
    // Post only when this run saved the matchups (and MFL confirmed them), so a
    // rerun or a dry run never posts twice.
    if (args.includes('--post-slack')) {
      if (status === 'saved') await postToSlack(post);
      else console.log(`(Slack: not posted, ${status === 'unchanged' ? 'the matchups were already set' : 'dry run'}.)`);
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main().catch(err => {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
  });
}
