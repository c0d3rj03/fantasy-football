/**
 * BaD standings post after Weeks 11-14: standings with who has clinched a
 * playoff spot (top 6) or a first-round bye (top 2), who is eliminated, and
 * next week's known clinch / elimination scenarios. After Week 12 and Week 13
 * it adds the order for choosing Week 13 / 14 opponents; after Week 14 it
 * gives the playoff field and the Week 15 games.
 *
 * Clinch math (sound, but conservative): each week has 15 VP (5 wins x 2 + 5
 * top-5 scores), at most 3 per team.
 *   Clinched top k: even if the team gets no more VP, k other teams can't all
 *     reach its total (a tie counts as being caught, since a tiebreaker could go
 *     either way). Uses the real matchups for next week when MFL has them,
 *     otherwise only the 15-VP and 3-per-team limits.
 *   Eliminated from top k: even with 3 VP every week, the other teams can't
 *     absorb the VP they must get without k of them ending above it.
 * So a team marked clinched or eliminated really is; a few might be decided a
 * week earlier than shown.
 *
 * Usage: node standings_post.js --after N [--post-slack]
 */
import fs from 'fs';
import { finalResults, franchiseNames, computeStandings, mflPairs, postToSlack, exportJson } from './themed_matchups.js';

const LAST_REGULAR_WEEK = 14;
const PLAYOFF_SPOTS = 6;
const BYE_SPOTS = 2;
const WEEK_VP = 15;   // 5 wins x 2 + 5 top-5 points
const TEAM_MAX = 3;   // win + top-5 score
// Week 14 picking order by standings place (bylaws, Week 14 theme).
const WEEK14_ORDER = [7, 6, 8, 5, 4, 3, 9, 2, 1, 10];

// ---------- clinch / elimination bounds ----------

// Can k other teams all reach X's total, if X gains xGain more and the others
// share `budget` VP with at most `cap` each? If not, X has clinched top k.
function clinchHolds(vp, x, k, xGain, budget, cap) {
  const floor = vp[x] + xGain;
  const needs = Object.keys(vp).filter(y => y !== x)
    .map(y => Math.max(0, floor - vp[y]))
    .filter(n => n <= cap)
    .sort((a, b) => a - b);
  if (needs.length < k) return true;
  return needs.slice(0, k).reduce((s, n) => s + n, 0) > budget;
}

// With X at xMax, must k others end strictly above it? Others must absorb
// `budget` VP, at most `cap` each; up to k-1 of them may pass X.
function eliminatedHolds(vp, x, k, xMax, budget, cap) {
  const others = Object.keys(vp).filter(y => y !== x);
  const above = others.filter(y => vp[y] > xMax);
  if (above.length >= k) return true;
  let capacity = 0;
  const extra = [];
  for (const y of others) {
    if (vp[y] > xMax) { capacity += cap; continue; }
    const below = Math.min(cap, xMax - vp[y]);
    capacity += below;
    extra.push(cap - below);
  }
  extra.sort((a, b) => b - a);
  capacity += extra.slice(0, k - 1 - above.length).reduce((s, n) => s + n, 0);
  return capacity < budget;
}

// Every VP outcome of one week with known pairs: each game has a winner (+2),
// and exactly 5 teams get the top-5 point; a loser in the top 5 means its
// winner is too.
function weekOutcomes(pairs) {
  const out = [];
  const states = [[3, 1], [3, 0], [2, 0]]; // [winner, loser] gains: both top-5, winner only, neither
  const top5 = [2, 1, 0];
  (function walk(i, acc, top) {
    if (i === pairs.length) { if (top === 5) out.push({ ...acc }); return; }
    const [a, b] = pairs[i];
    for (const [w, l] of [[a, b], [b, a]]) {
      states.forEach(([gw, gl], s) => {
        if (top + top5[s] > 5) return;
        walk(i + 1, { ...acc, [w]: gw, [l]: gl }, top + top5[s]);
      });
    }
  })(0, {}, 0);
  return out;
}

const add = (vp, gains) => Object.fromEntries(Object.entries(vp).map(([id, v]) => [id, v + (gains[id] || 0)]));

// status of team x for top k: 'clinched' | 'eliminated' | null.
// filter (optional) limits next week's outcomes to a scenario for x.
function decide(vp, x, k, weeksLeft, outcomes, filter) {
  if (weeksLeft === 0) return null; // final: standings decide
  if (outcomes) {
    const cases = outcomes.filter(o => !filter || filter(o[x]));
    const later = weeksLeft - 1;
    if (cases.every(o => clinchHolds(add(vp, o), x, k, 0, WEEK_VP * later, TEAM_MAX * later))) return 'clinched';
    if (cases.every(o => { const v = add(vp, o); return eliminatedHolds(v, x, k, v[x] + TEAM_MAX * later, (WEEK_VP - TEAM_MAX) * later, TEAM_MAX * later); })) return 'eliminated';
    return null;
  }
  // Next week's games unknown: X gains g (one of `gains`) next week, nothing / everything after.
  const gains = filter ? [0, 1, 2, 3].filter(filter) : [0, 1, 2, 3];
  const cap = TEAM_MAX * weeksLeft;
  if (gains.every(g => clinchHolds(vp, x, k, g, WEEK_VP * weeksLeft - g, cap))) return 'clinched';
  if (gains.every(g => { const xMax = vp[x] + g + TEAM_MAX * (weeksLeft - 1); return eliminatedHolds(vp, x, k, xMax, WEEK_VP * weeksLeft - g - TEAM_MAX * (weeksLeft - 1), cap); })) return 'eliminated';
  return null;
}

// ---------- post ----------

export async function standingsPost(after) {
  if (after < 1 || after > LAST_REGULAR_WEEK) throw new Error(`--after must be 1-${LAST_REGULAR_WEEK}.`);
  const [names, games] = await Promise.all([franchiseNames(), finalResults(after)]);
  const { teams, notes } = computeStandings(games, names);
  const { leagueStandings } = await exportJson('leagueStandings');
  const mfl = Array.isArray(leagueStandings.franchise) ? leagueStandings.franchise : [leagueStandings.franchise];
  const played = mfl.map(f => Number(f.h2hw) + Number(f.h2hl) + Number(f.h2ht));
  if (played.every(n => n === after)) {
    const off = mfl.filter(f => teams.find(s => s.id === f.id)?.vp !== Number(f.vp));
    if (off.length) throw new Error(`Computed VP differs from MFL for ${off.map(f => f.id).join(', ')}. Check standings adjustments.`);
  } else if (played.some(n => n < after)) {
    throw new Error(`MFL standings don't include Week ${after} yet. Try again later.`);
  }

  const vp = Object.fromEntries(teams.map(t => [t.id, t.vp]));
  const weeksLeft = LAST_REGULAR_WEEK - after;
  const next = after + 1;
  const pairs = weeksLeft > 0 ? (await mflPairs(next)).map(p => p.split('-')) : [];
  const outcomes = pairs.length === 5 ? weekOutcomes(pairs) : null;
  const opp = Object.fromEntries(pairs.flatMap(([a, b]) => [[a, b], [b, a]]));
  const name = id => names[id] || id;

  for (const t of teams) {
    if (weeksLeft === 0) {
      t.mark = t.rank <= BYE_SPOTS ? 'y' : t.rank <= PLAYOFF_SPOTS ? 'x' : 'e';
      continue;
    }
    const playoff = decide(vp, t.id, PLAYOFF_SPOTS, weeksLeft, outcomes);
    const bye = decide(vp, t.id, BYE_SPOTS, weeksLeft, outcomes);
    t.mark = bye === 'clinched' ? 'y' : playoff === 'clinched' ? 'x' : playoff === 'eliminated' ? 'e' : '';
    t.byeOut = bye === 'eliminated';
    if (!t.mark) {
      const win = g => g >= 2, winTop = g => g === 3, loss = g => g <= 1, lossNoTop = g => g === 0;
      if (decide(vp, t.id, PLAYOFF_SPOTS, weeksLeft, outcomes, win) === 'clinched') t.scenario = 'clinches a playoff spot with a win';
      else if (decide(vp, t.id, PLAYOFF_SPOTS, weeksLeft, outcomes, winTop) === 'clinched') t.scenario = 'clinches a playoff spot with a win and a top-5 score';
      if (decide(vp, t.id, PLAYOFF_SPOTS, weeksLeft, outcomes, loss) === 'eliminated') t.elimScenario = 'is eliminated with a loss';
      else if (decide(vp, t.id, PLAYOFF_SPOTS, weeksLeft, outcomes, lossNoTop) === 'eliminated') t.elimScenario = 'is eliminated with a loss and no top-5 score';
    }
    if (t.mark === 'x' && !t.byeOut) {
      const win = g => g >= 2, winTop = g => g === 3;
      if (decide(vp, t.id, BYE_SPOTS, weeksLeft, outcomes, win) === 'clinched') t.byeScenario = 'clinches a first-round bye with a win';
      else if (decide(vp, t.id, BYE_SPOTS, weeksLeft, outcomes, winTop) === 'clinched') t.byeScenario = 'clinches a first-round bye with a win and a top-5 score';
    }
  }

  // ----- text -----
  const w = Math.max(...teams.map(t => t.name.length));
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  const lines = [];
  if (weeksLeft === 0) {
    lines.push(`*BaD Final Standings* :trophy:`);
    lines.push('The regular season is over. The top 6 are in the playoffs; seeds 1 and 2 have a Week 15 bye.');
  } else {
    lines.push(`*BaD Standings after Week ${after}* :bar_chart:`);
    lines.push(`${weeksLeft} week${weeksLeft === 1 ? '' : 's'} left. Top 6 make the playoffs and the top 2 get a bye. Up to 3 VP a week (2 for a win, 1 for a top-5 score).`);
  }
  lines.push('```');
  lines.push(`${padL('#', 2)}  ${pad('Team', w)}  ${padL('VP', 3)}  ${pad('W-L', 5)}  ${padL('PF', 8)}`);
  for (const t of teams) {
    lines.push(`${padL(t.rank, 2)}  ${pad(t.name, w)}  ${padL(t.vp, 3)}  ${pad(`${t.w}-${t.l}${t.tie ? `-${t.tie}` : ''}`, 5)}  ${padL(t.pf.toFixed(2), 8)}  ${t.mark || ''}`.trimEnd());
    if (t.rank === PLAYOFF_SPOTS) lines.push(`${'-'.repeat(2 + 2 + w + 2 + 3 + 2 + 5 + 2 + 8)}`);
  }
  lines.push(weeksLeft === 0 ? 'y = bye, x = playoffs, e = out' : 'y = clinched a bye, x = clinched a playoff spot, e = eliminated');
  lines.push('```');

  if (weeksLeft === 0) {
    const seed = r => teams[r - 1];
    lines.push('*Playoffs*');
    lines.push(`Week 15: (3) ${seed(3).name} vs (6) ${seed(6).name}, (4) ${seed(4).name} vs (5) ${seed(5).name}`);
    lines.push(`Byes: (1) ${seed(1).name}, (2) ${seed(2).name}. In Week 16, (1) plays the lowest seed left and (2) the other winner.`);
  } else {
    const clinched = teams.filter(t => t.mark === 'x' || t.mark === 'y');
    const out = teams.filter(t => t.mark === 'e');
    lines.push('*Playoff picture*');
    lines.push(`• Clinched: ${clinched.length ? clinched.map(t => `${t.name}${t.mark === 'y' ? ' (bye)' : ''}`).join(', ') : 'nobody yet'}`);
    if (out.length) lines.push(`• Eliminated: ${out.map(t => t.name).join(', ')}`);
    const scen = teams.flatMap(t => [t.byeScenario, t.scenario, t.elimScenario].filter(Boolean).map(s => `${t.name} ${s}${opp[t.id] ? ` (vs ${name(opp[t.id])})` : ''}.`));
    if (scen.length) {
      lines.push(`*Week ${next} scenarios*${outcomes ? '' : ' (matchups not set yet)'}`);
      for (const s of scen) lines.push(`• ${s}`);
    } else {
      lines.push(`No team can clinch or be eliminated by its own Week ${next} result alone.`);
    }
  }
  if (notes.length) lines.push(`_Tiebreakers: ${notes.join(' ')}_`);

  if (after === 12) {
    const order = [...teams].sort((a, b) => b.pf - a.pf);
    lines.push('*Week 13 "Perks of My Success": opponent picks, by points for*');
    lines.push(order.map((t, i) => `${i + 1}. ${t.name} (${t.pf.toFixed(2)})`).join('\n'));
    lines.push('First pick is Wednesday at 12:30 PM ET; each pick has 3 hours. No pick defaults to the lowest-ranked team left.');
  } else if (after === 13) {
    lines.push('*Week 14 "Give the Little Guy a Chance": opponent picks, by standings*');
    lines.push(WEEK14_ORDER.map((place, i) => `${i + 1}. ${teams[place - 1].name} (${place}${['th', 'st', 'nd', 'rd'][place] || 'th'})`).join('\n'));
    lines.push('First pick is Wednesday at 12:30 PM ET; each pick has 3 hours. No pick defaults to the lowest-ranked team left.');
  }
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--after');
  const after = Number(i >= 0 ? args[i + 1] : process.env.WEEK);
  if (!after) throw new Error('Pass --after N (the week just finished).');
  const post = await standingsPost(after);
  console.log(post);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Standings post\n\n\`\`\`\`text\n${post}\n\`\`\`\`\n`);
  if (args.includes('--post-slack')) await postToSlack(post);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main().catch(err => {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
  });
}
