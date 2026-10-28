const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { LEAGUE_ID, YEAR, MFL_HOST, DIVISION_NAMES, DIVISION_ORDER } = require('./config.js');
const { QUARTER_WEEKS, quarterSchedule, scheduleLine, postseasonBonus } = require('./pbr_rules.js');

/**
 * PBR End-of-Week MFL Actions (commish_mfl_actions.js), RULES.md §10.
 * Runs after mfl_scores_fetcher.js has written data.json for week W. Compares MFL
 * with what data.json says MFL should hold, and lists each step:
 *   Every week 1-12   In-division top-2 VP                 (csetup C=STANDADJ&VICTORY_POINTS=1)
 *   Weeks 5, 9        W-L-T reset                          (csetup C=STANDADJ)
 *                     VP reset, folded into the VP step    (C=STANDADJ&VICTORY_POINTS=1)
 *                     Division moves                       (csetup C=DIVCONF)
 *   Weeks 4, 8        P&R result, next quarter schedule    (options O=168)
 *   Week 12           P&R result, Week 13 Postseason Bonus (import franchiseScoreAdjustment)
 *
 * Every step reads MFL first, so a step already done shows as OK and is never repeated.
 * The VP step pushes the difference between data.json's quarter VP and MFL's VP, so a
 * rerun pushes nothing.
 *
 * Writes:
 *   --apply           writes every automated step.
 *   PBR_MFL_WRITES=1  writes only the weekly VP step (for the Tuesday dispatch); the
 *                     quarter-change steps stay dry runs until run with --apply.
 * Otherwise it is a dry run: with MFL credentials it still loads each form and logs the
 * exact fields it would change. After writing, it re-reads MFL and fails unless every
 * written step shows as done. A step that only becomes possible after another (the VP
 * step after a W-L-T reset) runs in a second pass of the same run.
 *
 * Usage: node commish_mfl_actions.js [week] [--apply] [--inspect]
 */

const USER_AGENT = 'PBRCommish/1.0 (+https://github.com/c0d3rj03/fantasy-football)';
const VP_EXPLANATION = 'In-Division Top 2 Score';
const EPS = 0.001;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const asArray = x => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);
const fmt = n => String(Math.round(n * 10000) / 10000);
const signed = n => (n > 0 ? `+${fmt(n)}` : fmt(n));

async function loadClient() {
  const { MflCommishClient } = await import(pathToFileURL(path.join(__dirname, '..', 'common', 'mfl_commish_client.js')).href);
  return new MflCommishClient(YEAR, LEAGUE_ID, MFL_HOST, { userAgent: USER_AGENT });
}

async function fetchExport(type, params = {}) {
  const query = new URLSearchParams({ TYPE: type, L: LEAGUE_ID, JSON: '1', ...params }).toString();
  const res = await fetch(`https://${MFL_HOST}/${YEAR}/export?${query}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`MFL export error [${type}]: ${res.status} ${res.statusText}`);
  return await res.json();
}

/**
 * Reads the MFL state the checklist depends on (read-only exports).
 */
async function fetchMflState() {
  const [standingsJson, leagueJson, scheduleJson, week13Json] = await Promise.all([
    fetchExport('leagueStandings'),
    fetchExport('league'),
    fetchExport('schedule'),
    fetchExport('weeklyResults', { W: '13' })
  ]);
  const standings = {};
  for (const f of asArray(standingsJson.leagueStandings?.franchise)) {
    standings[f.id] = { vp: Number(f.vp), wins: Number(f.h2hw), losses: Number(f.h2hl), ties: Number(f.h2ht) };
  }
  const divisions = {};
  for (const f of asArray(leagueJson.league?.franchises?.franchise)) divisions[f.id] = f.division;
  const names = {};
  for (const f of asArray(leagueJson.league?.franchises?.franchise)) names[f.id] = f.name;
  // Matchups per week as sorted "a-b" pairs, for comparing with a generated schedule.
  const schedule = {};
  for (const w of asArray(scheduleJson.schedule?.weeklySchedule)) {
    schedule[Number(w.week)] = asArray(w.matchup).map(m => asArray(m.franchise).map(f => f.id));
  }
  // adj_score is the franchise score adjustment MFL already holds for Week 13.
  const week13Adjustments = {};
  const week13 = week13Json.weeklyResults || {};
  for (const f of [...asArray(week13.franchise), ...asArray(week13.matchup).flatMap(m => asArray(m.franchise))]) {
    if (f.adj_score !== undefined) week13Adjustments[f.id] = Number(f.adj_score);
  }
  return { standings, divisions, names, schedule, week13Adjustments };
}

const flatStandings = groups => Object.fromEntries(Object.values(groups || {}).flat().map(t => [t.id, t]));
const pairKey = ids => [...ids].sort().join('-');
const quarterOf = week => Math.ceil(week / 4);

function teamName(mfl, id) {
  return mfl.names[id] || id;
}

function slotsText(mfl, slots) {
  return DIVISION_ORDER.map(div => `${DIVISION_NAMES[div]}: ${slots[div].map((id, i) => `#${i + 1} ${teamName(mfl, id)}`).join(', ')}`).join(' · ');
}

/**
 * Builds the checklist for week W (pure; no network).
 * Each item: { step, status: 'ok' | 'auto' | 'manual' | 'error', scope: 'weekly' | 'quarter',
 * detail, lines? } plus what an 'auto' item writes (vpChanges, schedule, bonus).
 */
function planWeekActions(data, mfl, week) {
  const weekObj = data.weekly_data?.[String(week)];
  if (!weekObj) throw new Error(`Week ${week} is not in data.json.`);
  if (!weekObj.played) throw new Error(`Week ${week} has no results in data.json yet. Run mfl_scores_fetcher.js after the week is final.`);
  const quarter = quarterOf(week);
  const firstWeekOfQuarter = week === QUARTER_WEEKS[quarter][0] && quarter > 1;
  const items = [];

  // MFL standings are always current, so only the latest played week can be checked.
  const latest = Math.max(...Object.keys(data.weekly_data).filter(k => data.weekly_data[k].played).map(Number));
  if (week < latest) {
    items.push({ step: 'In-division VP', status: 'ok', scope: 'weekly', detail: `Skipped: Week ${latest} is played, and MFL standings only show the current total.` });
  } else if (week <= 12) {
    planVictoryPoints(items, weekObj, mfl, week, quarter, firstWeekOfQuarter, data);
  }
  if (firstWeekOfQuarter) planDivisionMoves(items, data, mfl, quarter);
  if (week === 4 || week === 8 || week === 12) {
    planPromotionRelegation(items, data, mfl, quarter);
    if (week < 12) planScheduleUpload(items, data, mfl, quarter + 1);
    else planPostseason(items, data, mfl, weekObj);
  }
  return { week, quarter, items };
}

function planVictoryPoints(items, weekObj, mfl, week, quarter, firstWeekOfQuarter, data) {
  const expected = flatStandings(weekObj.quarter_standings);
  const ids = Object.keys(expected).sort();

  // W-L-T must match first, so the VP difference is only the in-division VP.
  const wltOff = ids.filter(id => {
    const m = mfl.standings[id] || {};
    return m.wins !== expected[id].wins || m.losses !== expected[id].losses || m.ties !== expected[id].ties;
  });
  if (wltOff.length > 0) {
    const prior = flatStandings(data.weekly_data?.[String(week - 1)]?.quarter_standings);
    const isReset = firstWeekOfQuarter && wltOff.every(id => {
      const m = mfl.standings[id] || {};
      const p = prior[id] || {};
      return m.wins - expected[id].wins === p.wins && m.losses - expected[id].losses === p.losses && m.ties - expected[id].ties === p.ties;
    });
    if (isReset) {
      items.push({
        step: 'W-L-T reset',
        status: 'auto',
        scope: 'quarter',
        detail: `MFL still counts Q${quarter - 1} games. Subtract each team's Q${quarter - 1} W-L-T on C=STANDADJ (explanation "Q${quarter} Reset").`,
        lines: wltOff.map(id => `${teamName(mfl, id)} (${id}): W −${prior[id].wins}, L −${prior[id].losses}, T −${prior[id].ties}`),
        wltChanges: { ids: wltOff, prior, explanation: `Q${quarter} Reset` }
      });
      items.push({ step: 'In-division VP', status: 'error', scope: 'weekly', detail: 'Waits for the W-L-T reset above (with --apply it runs right after it).' });
    } else {
      items.push({
        step: 'In-division VP',
        status: 'error',
        scope: 'weekly',
        detail: `MFL W-L-T differs from data.json for Week ${week}, so the VP difference can't be trusted. Rerun mfl_scores_fetcher.js (stat corrections?) or check MFL standings.`,
        lines: wltOff.map(id => {
          const m = mfl.standings[id] || {};
          return `${teamName(mfl, id)} (${id}): MFL ${m.wins}-${m.losses}-${m.ties}, data.json ${expected[id].wins}-${expected[id].losses}-${expected[id].ties}`;
        })
      });
    }
    return;
  }
  if (firstWeekOfQuarter) {
    items.push({ step: 'W-L-T reset', status: 'ok', scope: 'quarter', detail: `MFL W-L-T counts only Q${quarter} games.` });
  }

  const delta = Object.fromEntries(ids.map(id => [id, Math.round((expected[id].vp - (mfl.standings[id]?.vp ?? 0)) * 10000) / 10000]));
  const changed = ids.filter(id => Math.abs(delta[id]) > EPS);
  if (changed.length === 0) {
    items.push({ step: 'In-division VP', status: 'ok', scope: 'weekly', detail: `MFL VP equals the Q${quarter} standings through Week ${week} for all teams.` });
    return;
  }

  // A normal week differs only by this week's in-division VP. A first week of a quarter
  // also carries the previous quarter's in-division VP, which this push removes.
  const thisWeek = Object.fromEntries(Object.values(weekObj.battle_royale || {}).flat().map(t => [t.id, t.battle_vp]));
  const unexpected = ids.filter(id => Math.abs(delta[id] - (thisWeek[id] || 0)) > EPS);
  const explanation = firstWeekOfQuarter ? `Q${quarter} Reset + ${VP_EXPLANATION}` : VP_EXPLANATION;
  const lines = changed.map(id => `${teamName(mfl, id)} (${id}): MFL ${fmt(mfl.standings[id].vp)} → ${fmt(expected[id].vp)} (${signed(delta[id])})`);
  if (!firstWeekOfQuarter && unexpected.length > 0) {
    items.push({
      step: 'In-division VP',
      status: 'error',
      scope: 'weekly',
      detail: `MFL VP is off by more than Week ${week}'s in-division VP for ${unexpected.map(id => teamName(mfl, id)).join(', ')} (an earlier week missing or doubled?). Fix it on C=STANDADJ&VICTORY_POINTS=1 by hand, or rerun with --sync-vp to push the whole difference.`,
      lines,
      vpChanges: { delta, ids: changed, explanation: `${VP_EXPLANATION} (sync)` }
    });
    return;
  }
  items.push({
    step: 'In-division VP',
    status: 'auto',
    scope: 'weekly',
    detail: `Add the VP difference on C=STANDADJ&VICTORY_POINTS=1 (explanation "${explanation}").`,
    lines,
    vpChanges: { delta, ids: changed, explanation }
  });
}

function planDivisionMoves(items, data, mfl, quarter) {
  const slots = data.quarter_slots?.[String(quarter)];
  if (!slots) {
    items.push({ step: 'Division moves', status: 'error', scope: 'quarter', detail: `data.json has no Q${quarter} slots (was the Week ${QUARTER_WEEKS[quarter][0] - 1} P&R computed?).` });
    return;
  }
  const moves = [];
  const divChanges = {};
  for (const div of DIVISION_ORDER) {
    for (const id of slots[div]) {
      if (mfl.divisions[id] === div) continue;
      moves.push(`${teamName(mfl, id)} (${id}): ${DIVISION_NAMES[mfl.divisions[id]] || mfl.divisions[id]} → ${DIVISION_NAMES[div]}`);
      divChanges[id] = div;
    }
  }
  items.push(moves.length === 0
    ? { step: 'Division moves', status: 'ok', scope: 'quarter', detail: `MFL divisions match Q${quarter}.` }
    : { step: 'Division moves', status: 'auto', scope: 'quarter', detail: `Move these teams on C=DIVCONF to their Q${quarter} divisions.`, lines: moves, divChanges });
}

function planPromotionRelegation(items, data, mfl, quarter) {
  const pr = data.promotion_relegation?.[String(quarter)];
  const nextSlots = data.quarter_slots?.[String(quarter + 1)];
  if (!pr || !nextSlots) {
    items.push({ step: 'Promotion & Relegation', status: 'error', scope: 'quarter', detail: `data.json has no Q${quarter} P&R. Rerun mfl_scores_fetcher.js.` });
    return;
  }
  const lines = [
    ...Object.entries(pr.promoted).map(([div, id]) => `Promoted from ${DIVISION_NAMES[div]}: ${teamName(mfl, id)} (${id})`),
    ...Object.entries(pr.relegated).map(([div, id]) => `Relegated from ${DIVISION_NAMES[div]}: ${teamName(mfl, id)} (${id})`),
    `${quarter < 3 ? `Q${quarter + 1}` : 'Postseason'} slots: ${slotsText(mfl, nextSlots)}`
  ];
  const flips = pr.coin_flips || [];
  items.push(flips.length > 0
    ? { step: 'Promotion & Relegation', status: 'error', scope: 'quarter', detail: `Coin flip needed: ${flips.join('; ')}. Fix quarter_slots in data.json by hand.`, lines }
    : { step: 'Promotion & Relegation', status: 'ok', scope: 'quarter', detail: `Q${quarter} result (pbr_rules.js, RULES.md §5). Announce it.`, lines });
}

function planScheduleUpload(items, data, mfl, nextQuarter) {
  const slots = data.quarter_slots?.[String(nextQuarter)];
  if (!slots) return; // P&R item already reports the error.
  const games = quarterSchedule(nextQuarter, slots);
  const weeks = QUARTER_WEEKS[nextQuarter];
  const differs = weeks.filter(w => {
    const want = games.filter(g => g.week === w).map(g => pairKey([g.home, g.away])).sort();
    const have = (mfl.schedule[w] || []).map(pairKey).sort();
    return JSON.stringify(want) !== JSON.stringify(have);
  });
  if (differs.length === 0) {
    items.push({ step: `Q${nextQuarter} schedule`, status: 'ok', scope: 'quarter', detail: `MFL Weeks ${weeks[0]}-${weeks[3]} match the Q${nextQuarter} slots.` });
    return;
  }
  items.push({
    step: `Q${nextQuarter} schedule`,
    status: 'auto',
    scope: 'quarter',
    detail: `In the season schedule box (options O=168), replace the Weeks ${weeks[0]}-${weeks[3]} lines with the Q${nextQuarter} games; every other line stays as MFL has it. MFL differs in Week(s) ${differs.join(', ')}.`,
    lines: games.map(g => `${scheduleLine(g)}  ${teamName(mfl, g.home)} vs ${teamName(mfl, g.away)}`),
    schedule: { weeks, games }
  });
}

function planPostseason(items, data, mfl, weekObj) {
  const slots = data.quarter_slots?.['4'];
  if (!slots) return;
  items.push({ step: 'Postseason schedule', status: 'manual', scope: 'quarter', detail: 'Set up the Weeks 13-17 postseason on MFL (not automated yet).' });
  const season = flatStandings(weekObj.season_standings);
  const bonus = postseasonBonus(season, slots);
  const toAdd = [];
  const conflicts = [];
  for (const [id, points] of Object.entries(bonus)) {
    if (points <= 0) continue;
    const existing = mfl.week13Adjustments[id];
    if (existing === undefined || existing === 0) toAdd.push({ id, points });
    else if (Math.abs(existing - points) > 0.005) conflicts.push(`${teamName(mfl, id)}: MFL has ${existing}, expected ${points}`);
  }
  const lines = Object.entries(bonus).map(([id, points]) => `${teamName(mfl, id)} (${id}): ${points.toFixed(2)}`);
  if (conflicts.length > 0) {
    items.push({ step: 'Postseason Bonus', status: 'error', scope: 'quarter', detail: `Fix by hand (C=FSCOREADJ), Week 13: ${conflicts.join('; ')}.`, lines });
  } else if (toAdd.length > 0) {
    items.push({ step: 'Postseason Bonus', status: 'auto', scope: 'quarter', detail: `Add Week 13 score adjustments (import franchiseScoreAdjustment, explanation "Postseason Bonus") for ${toAdd.length} team(s).`, lines, bonus: toAdd });
  } else {
    items.push({ step: 'Postseason Bonus', status: 'ok', scope: 'quarter', detail: 'MFL has every Week 13 bonus.', lines });
  }
}

const STATUS_ICON = { ok: '✅', auto: '🤖', manual: '✋', error: '❌' };

function printChecklist(title, plan, modeFor) {
  const out = [`## ${title}: Week ${plan.week} (Q${plan.quarter})`, ''];
  for (const item of plan.items) {
    const suffix = item.status === 'auto' ? ` (${modeFor(item)})` : '';
    out.push(`- ${STATUS_ICON[item.status]} **${item.step}**${suffix}: ${item.detail}`);
    for (const line of item.lines || []) out.push(`  - ${line}`);
    for (const change of item.formChanges || []) out.push(`  - \`${change}\``);
  }
  const text = out.join('\n');
  console.log(text);
  // Shows the checklist on the GitHub Actions run page.
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n\n');
}

// STANDADJ VP fields per franchise (confirmed by --inspect 2026-10-27).
// requireExisting makes the run fail if the live form names them differently.
function vpFormChanges(plan, vpChanges) {
  const changes = {};
  for (const id of vpChanges.ids) {
    changes[`WEEK${id}`] = String(plan.week);
    changes[`ADJUST_VP${id}`] = fmt(vpChanges.delta[id]);
    changes[`EXP${id}`] = vpChanges.explanation;
  }
  return changes;
}

// STANDADJ W-L-T fields per franchise (W<fid>, L<fid>, T<fid>; --inspect 2026-10-27).
function wltFormChanges(plan, wltChanges) {
  const changes = {};
  const minus = n => (n ? String(-n) : '');
  for (const id of wltChanges.ids) {
    const p = wltChanges.prior[id];
    changes[`WEEK${id}`] = String(plan.week);
    changes[`W${id}`] = minus(p.wins);
    changes[`L${id}`] = minus(p.losses);
    changes[`T${id}`] = minus(p.ties);
    changes[`EXP${id}`] = wltChanges.explanation;
  }
  return changes;
}

/**
 * The schedule box holds the whole season as "WW,FFFF,FFFF" lines (192 on 2026-10-27,
 * Weeks 13-16 as BYE lines). Replaces only the given weeks' lines and keeps every
 * other line, in week order. Returns the new text and the lines it removed.
 */
function replaceScheduleWeeks(current, weeks, games) {
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const weekOf = line => Number(line.split(',')[0]);
  const old = current.split(/\r?\n/).filter(line => line.trim() !== '');
  const removed = old.filter(line => weeks.includes(weekOf(line)));
  const kept = old.filter(line => !weeks.includes(weekOf(line)));
  // Stable sort by week keeps MFL's order within each week.
  const merged = [...kept, ...games.map(scheduleLine)]
    .map((line, i) => ({ line, i, week: Number.isFinite(weekOf(line)) ? weekOf(line) : 99 }))
    .sort((a, b) => a.week - b.week || a.i - b.i)
    .map(x => x.line);
  return { text: merged.join(eol), removed, before: old.length, after: merged.length };
}

// The schedule box is the only textarea on options O=168; its name is read from the page.
const hasTextarea = form => /<textarea\b/i.test(form);
function textareaName(html) {
  const form = (html.match(/<form\b[\s\S]*?<\/form>/gi) || []).find(hasTextarea);
  const names = (form?.match(/<textarea\b[^>]*>/gi) || []).map(t => t.match(/\sname\s*=\s*["']?([^"'\s>]+)/i)?.[1]).filter(Boolean);
  if (names.length !== 1) throw new Error(`options O=168: expected one schedule textarea, found ${names.length}. Run --inspect.`);
  return names[0];
}

/**
 * Runs each 'auto' item. Items outside the write scope (or all, on a dry run) only load
 * their forms and record the field changes.
 */
async function runAutoItems(client, plan, canWrite, items = plan.items.filter(i => i.status === 'auto')) {
  for (const item of items) {
    const dryRun = !canWrite(item);
    item.formChanges = [];
    // STANDADJ pages also have a "Delete Selected Standings Adjustments" button (DSUBMIT).
    if (item.wltChanges) {
      const changed = await client.submitCsetupForm('STANDADJ', wltFormChanges(plan, item.wltChanges), {
        dryRun, requireExisting: true, submit: 'ASUBMIT'
      });
      item.formChanges.push(...changed.map(line => `C=STANDADJ: ${line}`));
    }
    if (item.vpChanges) {
      const changed = await client.submitCsetupForm('STANDADJ', vpFormChanges(plan, item.vpChanges), {
        dryRun, params: { VICTORY_POINTS: '1' }, requireExisting: true, submit: 'ASUBMIT'
      });
      item.formChanges.push(...changed.map(line => `C=STANDADJ&VICTORY_POINTS=1: ${line}`));
    }
    if (item.divChanges) {
      const changes = Object.fromEntries(Object.entries(item.divChanges).map(([id, div]) => [`FRANCHISE_DIVISION${id}`, div]));
      const changed = await client.submitCsetupForm('DIVCONF', changes, { dryRun, requireExisting: true });
      item.formChanges.push(...changed.map(line => `C=DIVCONF: ${line}`));
    }
    if (item.schedule) {
      const { parseMflForm } = await import(pathToFileURL(path.join(__dirname, '..', 'common', 'mfl_csetup_form.js')).href);
      const html = await client.fetchPage('options', { O: '168' });
      const name = textareaName(html);
      const current = parseMflForm(html, hasTextarea, 'options O=168').fields.find(f => f[0] === name)?.[1] ?? '';
      const next = replaceScheduleWeeks(current, item.schedule.weeks, item.schedule.games);
      const changed = await client.submitPageForm('options', { O: '168' }, hasTextarea, { [name]: next.text }, { dryRun, requireExisting: true });
      // The box is long; summarize instead of printing every line.
      const removedSummary = Object.entries(next.removed.reduce((acc, l) => ({ ...acc, [l]: (acc[l] || 0) + 1 }), {}))
        .slice(0, 6).map(([l, n]) => (n > 1 ? `${n}× ${l}` : l)).join(', ');
      item.formChanges.push(...changed.map(line => line.startsWith(`${name} `)
        ? `O=168: ${name}: ${next.removed.length} lines for Weeks ${item.schedule.weeks.join('/')} replaced by ${item.schedule.games.length} (${next.before} → ${next.after} lines). Removed: ${removedSummary || 'none'}${next.removed.length > 6 ? ', …' : ''}`
        : `O=168: ${line}`));
    }
    if (item.bonus) {
      for (const { id, points } of item.bonus) {
        item.formChanges.push(`import franchiseScoreAdjustment FRANCHISE=${id} WEEK=13 POINTS=${points.toFixed(2)}`);
        if (dryRun) continue;
        await client.apiRequest('import', {
          TYPE: 'franchiseScoreAdjustment', FRANCHISE: id, WEEK: '13', POINTS: points.toFixed(2), EXPLANATION: 'Postseason Bonus'
        }, 'POST');
      }
    }
  }
}

async function inspectCommishForms() {
  const { describeForms } = await import(pathToFileURL(path.join(__dirname, '..', 'common', 'mfl_csetup_form.js')).href);
  const client = await loadClient();
  await client.login();
  const pages = [
    ['csetup', { C: 'STANDADJ', VICTORY_POINTS: '1' }],
    ['csetup', { C: 'STANDADJ' }],
    ['csetup', { C: 'DIVCONF' }],
    ['options', { O: '168' }]
  ];
  for (const [page, params] of pages) {
    const html = await client.fetchPage(page, params);
    // Page title and size help tell a login or error page from a settings page.
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim().replace(/\s+/g, ' ');
    const hint = /Commissioner Access Required/i.test(html) ? ', COMMISSIONER ACCESS REQUIRED' : '';
    console.log(`\n===== ${page}?${new URLSearchParams(params)} (title "${title}", ${html.length} chars${hint}) =====\n${describeForms(html)}`);
  }
}

function targetWeek(data, arg) {
  if (arg) return Number(arg);
  const played = Object.keys(data.weekly_data || {}).filter(k => data.weekly_data[k].played).map(Number);
  if (played.length === 0) throw new Error('No played weeks in data.json.');
  return Math.max(...played);
}

async function runCommishMflActions({ week, apply, weeklyWrites, syncVp }) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const w = targetWeek(data, week);
  const planNow = async () => {
    const plan = planWeekActions(data, await fetchMflState(), w);
    if (syncVp) {
      // --sync-vp: push the whole VP difference even when it is more than this week's.
      for (const item of plan.items) if (item.step === 'In-division VP' && item.vpChanges && item.status === 'error') item.status = 'auto';
    }
    return plan;
  };
  const canWrite = item => apply || (weeklyWrites && item.scope === 'weekly');
  const hasCredentials = Boolean(process.env.MFL_USERNAME && process.env.MFL_PASSWORD);
  const modeFor = item => canWrite(item) && hasCredentials ? 'applied'
    : hasCredentials ? 'dry run: not posted'
    : 'dry run: no MFL login, form changes not checked';

  let plan = await planNow();
  let client = null;
  const attempted = new Set();
  // Pass 1 writes what it can; a later pass picks up steps that were waiting on it
  // (the VP step after a W-L-T reset). Each step is written at most once per run.
  for (let pass = 1; pass <= 3; pass++) {
    const auto = plan.items.filter(i => i.status === 'auto');
    const toWrite = hasCredentials ? auto.filter(i => canWrite(i) && !attempted.has(i.step)) : [];
    if (pass > 1 && toWrite.length === 0) break;
    if (hasCredentials && auto.length > 0) {
      if (!client) {
        client = await loadClient();
        await client.login();
      }
      // Errors in the auto items are not caught: the run stops and the job fails.
      await runAutoItems(client, plan, canWrite, pass === 1 ? auto : toWrite);
    }
    printChecklist(pass === 1 ? 'PBR commissioner checklist' : `PBR commissioner checklist, pass ${pass}`, plan, modeFor);
    if (toWrite.length === 0) break;

    // Confirm on MFL: every written step must now read as done. Exports can lag a few seconds.
    const written = toWrite.map(i => i.step);
    written.forEach(step => attempted.add(step));
    let after;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await sleep(5000);
      after = await planNow();
      if (after.items.filter(i => written.includes(i.step)).every(i => i.status === 'ok')) break;
    }
    printChecklist('After applying (MFL re-read)', after, () => 'still not done on MFL');
    const notDone = after.items.filter(i => written.includes(i.step) && i.status !== 'ok');
    if (notDone.length > 0) {
      throw new Error(`MFL does not show ${notDone.map(i => i.step).join(', ')} as done. Check MFL before rerunning.`);
    }
    plan = after;
  }
  if (plan.items.some(i => i.status === 'error')) {
    throw new Error('Checklist has errors. Review the ❌ items.');
  }
}

module.exports = { planWeekActions, fetchMflState, replaceScheduleWeeks };

if (require.main === module) {
  const args = process.argv.slice(2);
  const run = args.includes('--inspect')
    ? inspectCommishForms()
    : runCommishMflActions({
        week: args.find(a => /^\d+$/.test(a)),
        apply: args.includes('--apply'),
        weeklyWrites: process.env.PBR_MFL_WRITES === '1',
        syncVp: args.includes('--sync-vp')
      });
  run.catch(err => {
    console.error('Fatal error in commish_mfl_actions.js:', err.message);
    // exitCode (not exit()) lets open fetch sockets close; exit() can crash Node on Windows.
    process.exitCode = 1;
  });
}
