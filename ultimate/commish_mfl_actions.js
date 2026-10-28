import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LEAGUE_ID, SEASON_YEAR, MFL_HOST } from './config.js';
import { WEEKLY_SCHEDULE, POSITIONS, getCutCount, formatLimit } from './league_schedule.js';
import MflCommishClient from './mfl_commish_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * End-of-Week MFL Actions (commish_mfl_actions.js)
 * Runs after commish_automation.js has recorded Week W's cut. Compares MFL's
 * league state with what Week W+1 needs (RULES.md, league_schedule.js) and
 * prints the commissioner checklist:
 *   1. Second cut (Weeks 2-6)                    -> manual (C=MANDROP)
 *   2. Clear FAAB of eliminated teams (optional)  -> manual (C=BBIDWAIV)
 *   3. Weeks 1-4 winner gets $10 FAAB             -> manual (C=BBIDWAIV)
 *   4. Roster size for Week W+1                   -> manual (C=GENERAL)
 *   5. Starting lineup limits for Week W+1        -> manual (C=LINEUP)
 *   6. Week W single score as Week W+1 starting adjustment -> automated
 *
 * Every step reads MFL first, so a step already done shows as OK and is never repeated.
 * Only step 6 writes to MFL (import TYPE=franchiseScoreAdjustment), and only with
 * --apply or MFL_WRITES=1; otherwise this is a dry run. Steps 1-5 have no MFL
 * import API; they stay manual until their csetup form fields are verified
 * (run with --inspect to print them).
 *
 * Usage: node commish_mfl_actions.js [--apply] [--inspect]
 */

const USER_AGENT = 'UltimateGuillotineCommish/1.0 (+https://github.com/c0d3rj03/fantasy-football)';
const CSETUP_PAGES = ['MANDROP', 'BBIDWAIV', 'GENERAL', 'LINEUP'];

function normalizeArray(item) {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

async function fetchExport(type, params = {}) {
  const query = new URLSearchParams({ TYPE: type, L: LEAGUE_ID, JSON: '1', ...params }).toString();
  const res = await fetch(`https://${MFL_HOST}/${SEASON_YEAR}/export?${query}`, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!res.ok) {
    throw new Error(`MFL API error [${type}]: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

/**
 * Reads the MFL state the checklist depends on (all read-only exports).
 */
export async function fetchMflState(nextWeek) {
  const [leagueJson, rostersJson, nextResultsJson] = await Promise.all([
    fetchExport('league'),
    fetchExport('rosters'),
    fetchExport('weeklyResults', { W: String(nextWeek) })
  ]);
  const league = leagueJson.league;

  const faab = {};
  for (const f of normalizeArray(league.franchises?.franchise)) {
    faab[f.id] = parseFloat(f.bbidAvailableBalance ?? '0');
  }
  const rosterCounts = {};
  for (const f of normalizeArray(rostersJson.rosters?.franchise)) {
    rosterCounts[f.id] = normalizeArray(f.player).length;
  }
  // adj_score is the franchise score adjustment MFL already holds for that week.
  const nextWeekAdjustments = {};
  for (const f of normalizeArray(nextResultsJson.weeklyResults?.franchise)) {
    if (f.adj_score !== undefined) nextWeekAdjustments[f.id] = parseFloat(f.adj_score);
  }
  const starterLimits = {};
  for (const p of normalizeArray(league.starters?.position)) {
    starterLimits[p.name] = p.limit;
  }

  return {
    rosterSize: parseInt(league.rosterSize, 10),
    startersCount: parseInt(league.starters?.count, 10),
    starterLimits,
    faab,
    rosterCounts,
    nextWeekAdjustments
  };
}

function teamName(data, fid) {
  return data.franchises?.[fid]?.name || fid;
}

/**
 * Builds the checklist for the week just finished (pure; no network).
 * Each item: { step, status: 'ok' | 'todo' | 'auto' | 'error', detail, ... }.
 * 'auto' items are the ones this script can apply itself.
 */
export function planEndOfWeekActions(data, mfl) {
  const week = data.currentWeek;
  const nextWeek = week + 1;
  const eliminated = data.eliminatedTeams || {};
  const items = [];

  // The week must be final and its cut recorded by commish_automation.js first.
  if (data.phase !== 'results' || data.lastCompletedWeek !== week) {
    throw new Error(`Week ${week} is not final in data.json (phase ${data.phase}, lastCompletedWeek ${data.lastCompletedWeek}). Run the score sync and commish_automation.js first.`);
  }
  const cutThisWeek = Object.keys(eliminated).filter(fid => eliminated[fid].eliminatedWeek === week);
  if (getCutCount(week) > 0 && cutThisWeek.length === 0) {
    throw new Error(`Week ${week} cut is not recorded in data.json. Run commish_automation.js first.`);
  }
  if (week >= 17) {
    items.push({ step: 'Season over', status: 'ok', detail: 'Week 17 was the final week. No setup for a next week.' });
    return { week, nextWeek, items };
  }

  // Alive going into the next week: never eliminated.
  const alive = Object.keys(data.franchises || {}).filter(fid => !eliminated[fid]);

  // 1. Second cut (Weeks 2-6): MFL cuts one team; the commissioner empties the other.
  if (getCutCount(week) === 2) {
    const stillRostered = cutThisWeek.filter(fid => (mfl.rosterCounts[fid] ?? 0) > 0);
    items.push(stillRostered.length === 0
      ? { step: 'Second cut', status: 'ok', detail: `Both Week ${week} cut teams have empty rosters.` }
      : { step: 'Second cut', status: 'todo', detail: `Drop all players (C=MANDROP): ${stillRostered.map(fid => `${teamName(data, fid)} (${fid}, ${mfl.rosterCounts[fid]} players)`).join(', ')}.` });
  }

  // 2. Clear leftover FAAB of eliminated teams (optional duty).
  const withFaab = Object.keys(eliminated).filter(fid => (mfl.faab[fid] ?? 0) > 0);
  items.push(withFaab.length === 0
    ? { step: 'Clear cut teams\' FAAB', status: 'ok', detail: 'No eliminated team has FAAB left.' }
    : { step: 'Clear cut teams\' FAAB', status: 'todo', detail: `Set to $0 (C=BBIDWAIV): ${withFaab.map(fid => `${teamName(data, fid)} $${mfl.faab[fid]}`).join(', ')}.` });

  // 3. Weeks 1-4 high score gets $10 FAAB. MFL keeps no record of it, so data.json does.
  const winner = data.weeklyWinners?.[week];
  if (winner?.prize?.type === 'FAAB') {
    items.push(winner.faabAwarded
      ? { step: 'FAAB prize', status: 'ok', detail: `$${winner.prize.amount} FAAB to ${winner.franchiseName} marked as awarded.` }
      : { step: 'FAAB prize', status: 'todo', detail: `Add $${winner.prize.amount} FAAB (C=BBIDWAIV) to ${winner.franchiseName} (${winner.franchiseId}), now $${mfl.faab[winner.franchiseId] ?? '?'}. Then set weeklyWinners[${week}].faabAwarded = true in data.json.` });
  } else if (week <= 4) {
    items.push({ step: 'FAAB prize', status: 'error', detail: `Week ${week} winner is not recorded in data.json.` });
  }

  // 4. Roster size for next week.
  const target = WEEKLY_SCHEDULE[nextWeek];
  items.push(mfl.rosterSize === target.rosterSize
    ? { step: 'Roster size', status: 'ok', detail: `Week ${nextWeek} roster size is ${target.rosterSize}.` }
    : { step: 'Roster size', status: 'todo', detail: `Change roster size ${mfl.rosterSize} → ${target.rosterSize} for Week ${nextWeek} (C=GENERAL).` });

  // 5. Starting lineup limits for next week.
  const lineupDiffs = [];
  if (mfl.startersCount !== target.starters.total) {
    lineupDiffs.push(`total starters ${mfl.startersCount} → ${target.starters.total}`);
  }
  for (const pos of POSITIONS) {
    const want = formatLimit(target.starters.min[pos], target.starters.max[pos]);
    if (mfl.starterLimits[pos] !== want) lineupDiffs.push(`${pos} ${mfl.starterLimits[pos] ?? 'unset'} → ${want}`);
  }
  items.push(lineupDiffs.length === 0
    ? { step: 'Starting lineup', status: 'ok', detail: `Week ${nextWeek} lineup limits already set.` }
    : { step: 'Starting lineup', status: 'todo', detail: `For Week ${nextWeek} (C=LINEUP; set min and max starters): ${lineupDiffs.join('; ')}.` });

  // 6. Week W single score becomes each survivor's Week W+1 starting adjustment.
  const adjustments = [];
  const conflicts = [];
  for (const fid of alive) {
    const points = data.weeklySingleScores?.[week]?.[fid];
    if (points === undefined) {
      conflicts.push(`${teamName(data, fid)}: no Week ${week} score in data.json`);
      continue;
    }
    const existing = mfl.nextWeekAdjustments[fid];
    if (existing === undefined || existing === 0) {
      adjustments.push({ fid, points });
    } else if (Math.abs(existing - points) > 0.005) {
      // Never stack a second adjustment on top of one already entered.
      conflicts.push(`${teamName(data, fid)}: MFL has ${existing}, expected ${points}`);
    }
  }
  if (conflicts.length > 0) {
    items.push({ step: 'Score carryover', status: 'error', detail: `Fix by hand (C=FSCOREADJ), Week ${nextWeek}: ${conflicts.join('; ')}.` });
  }
  if (adjustments.length > 0) {
    items.push({
      step: 'Score carryover',
      status: 'auto',
      detail: `Add Week ${week} single score as Week ${nextWeek} adjustment for ${adjustments.length} team(s): ${adjustments.map(a => `${teamName(data, a.fid)} ${a.points}`).join(', ')}.`,
      adjustments
    });
  } else if (conflicts.length === 0) {
    items.push({ step: 'Score carryover', status: 'ok', detail: `All ${alive.length} surviving teams have their Week ${nextWeek} adjustment.` });
  }

  return { week, nextWeek, items };
}

const STATUS_ICON = { ok: '✅', todo: '📝', auto: '🤖', error: '❌' };

function printChecklist(plan, applied) {
  const lines = [`## Week ${plan.week} → Week ${plan.nextWeek} commissioner checklist`, ''];
  for (const item of plan.items) {
    const suffix = item.status === 'auto' ? (applied ? ' (applied)' : ' (dry run: not applied)') : '';
    lines.push(`- ${STATUS_ICON[item.status]} **${item.step}**${suffix}: ${item.detail}`);
  }
  const text = lines.join('\n');
  console.log(text);
  // Shows the checklist on the GitHub Actions run page.
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  }
}

/**
 * Pushes the starting score adjustments, then re-reads MFL to confirm them.
 */
async function applyScoreCarryover(client, plan) {
  const item = plan.items.find(i => i.step === 'Score carryover' && i.status === 'auto');
  if (!item) return;
  for (const { fid, points } of item.adjustments) {
    await client.apiRequest('import', {
      TYPE: 'franchiseScoreAdjustment',
      FRANCHISE: fid,
      WEEK: String(plan.nextWeek),
      POINTS: points.toFixed(2),
      EXPLANATION: `Week ${plan.week} single-week score carryover`
    }, 'POST');
    console.log(`➕ Week ${plan.nextWeek} adjustment ${points.toFixed(2)} for ${fid}`);
  }
  const after = await fetchMflState(plan.nextWeek);
  const missing = item.adjustments.filter(a => Math.abs((after.nextWeekAdjustments[a.fid] ?? 0) - a.points) > 0.005);
  if (missing.length > 0) {
    throw new Error(`MFL does not show the Week ${plan.nextWeek} adjustment for: ${missing.map(a => `${a.fid} (has ${after.nextWeekAdjustments[a.fid] ?? 'none'})`).join(', ')}. Check C=FSCOREADJ before rerunning.`);
  }
  console.log(`✅ MFL confirms all ${item.adjustments.length} Week ${plan.nextWeek} adjustments.`);
}

// --inspect: print the csetup forms' fields so the manual steps can be automated.
// Action logs may be public, so emails are masked and password-like fields are skipped.
function describeForms(html) {
  const mask = v => v.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');
  const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find(v => v !== undefined) ?? '';
  const out = [];
  for (const form of html.match(/<form[\s\S]*?<\/form>/gi) || []) {
    out.push(`FORM method=${attr(form, 'method')} action=${attr(form, 'action')}`);
    for (const tag of form.match(/<(input|select|textarea)\b[^>]*>/gi) || []) {
      const kind = tag.match(/^<(\w+)/)[1].toLowerCase();
      const name = attr(tag, 'name');
      if (!name || /pass|cookie|token/i.test(name)) continue;
      const type = kind === 'input' ? (attr(tag, 'type') || 'text') : kind;
      let value = attr(tag, 'value');
      if (kind === 'select') {
        const body = form.slice(form.indexOf(tag)).split(/<\/select>/i)[0];
        const options = body.match(/<option\b[^>]*>/gi) || [];
        const selected = options.find(o => /\bselected\b/i.test(o));
        value = `${selected ? attr(selected, 'value') : ''} (${options.length} options)`;
      }
      const checked = /\bchecked\b/i.test(tag) ? ' [checked]' : '';
      out.push(`  ${type} ${name} = ${mask(value).slice(0, 80)}${checked}`);
    }
  }
  return out.join('\n') || '  (no forms found: not logged in as commissioner?)';
}

async function inspectCommishForms() {
  const client = new MflCommishClient(SEASON_YEAR, LEAGUE_ID);
  for (const c of CSETUP_PAGES) {
    const html = await client.fetchCommishPage(c);
    console.log(`\n===== csetup C=${c} =====\n${describeForms(html)}`);
  }
}

export async function runCommishMflActions({ apply = false } = {}) {
  const dataPath = path.join(__dirname, 'data.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const mfl = await fetchMflState(data.currentWeek + 1);
  const plan = planEndOfWeekActions(data, mfl);

  if (apply && plan.items.some(i => i.status === 'auto')) {
    const client = new MflCommishClient(SEASON_YEAR, LEAGUE_ID);
    await client.login();
    await applyScoreCarryover(client, plan);
  }
  printChecklist(plan, apply);

  if (plan.items.some(i => i.status === 'error')) {
    throw new Error('Checklist has errors. Review the ❌ items.');
  }
}

// Run only when executed directly (lets tests import planEndOfWeekActions)
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  const run = args.includes('--inspect')
    ? inspectCommishForms()
    : runCommishMflActions({ apply: args.includes('--apply') || process.env.MFL_WRITES === '1' });
  run.catch(err => {
    console.error('Fatal error in commish_mfl_actions.js:', err.message);
    // exitCode (not exit()) lets open fetch sockets close; exit() can crash Node on Windows.
    process.exitCode = 1;
  });
}
