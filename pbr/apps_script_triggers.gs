/**
 * PBR: Google Apps Script trigger (copy of the code that runs in Apps Script).
 * No secrets in this file. Set these in Project Settings > Script properties:
 *   GITHUB_PAT    fine-grained token for c0d3rj03/fantasy-football with "Contents: Read and write"
 *   GITHUB_OWNER  c0d3rj03
 *   GITHUB_REPO   fantasy-football
 *
 * Can live in the same Apps Script project as ultimate/apps_script_triggers.gs (add it as a second
 * file); every name here is pbr-prefixed so nothing clashes.
 *
 * Setup: paste this file, run installPbrWeeklyTrigger(), installPbrDailyTokenTrigger(),
 * installPbrDailyScoreTrigger() and installPbrLiveTrigger() once, and
 * approve the permissions. Delete any old PBR triggers/functions (for example ones that dispatch
 * pbr-sync-trigger, or the Token Tracker sheet's grabDailyMFLTransactions / updateMonthlyTradeValues).
 *
 * Every Tuesday at about 6:00 AM Pacific (after Monday Night Football):
 *   pbr-endweek-trigger -> pbr_endweek.yml: fetch MFL results into data.json, push in-division VPs
 *   to MFL, Gemmy recap (PBR_RECAP_MODE below), commit data.json for the dashboard.
 * Every day at about 9:00 AM Pacific (after the 11 AM ET waiver run):
 *   pbr-tokens-trigger -> pbr_tokens.yml: save this month's KTC values if not saved yet (so the 1st
 *   of the month takes the new snapshot), rebuild the token ledger (tokens_data.json).
 * Every day at about 2:00 AM Pacific:
 *   pbr-dailyscore-trigger -> pbr_dailyscore.yml: refetch MFL into data.json so the dashboard shows
 *   the week in progress (tentative scores, VP, PP and standings). Read-only on MFL.
 * Every 10 minutes (installPbrLiveTrigger), only while an NFL game is in its window (kickoff to
 *   kickoff + 4.5 h, from MFL's nflSchedule, so Thu/Sun/Mon/Europe/holiday slots all work):
 *   pbr-livescore-trigger -> pbr_dailyscore.yml, same sync, so the dashboard follows games live.
 * Reruns are safe, so pbrEndweekRun(), pbrTokensRun() and pbrDailyScoreRun() can also be run by hand.
 */

const PBR_TZ = 'America/Los_Angeles';
const PBR_TRIGGER_HOUR = 6; // Apps Script fires somewhere within 6:00-7:00 AM
// 'auto' posts the Gemmy recap straight to Slack. 'draft' only commits pbr/gemmy_drafts/week_<N>.md
// for review; then run "PBR End-of-Week" by hand with recap_mode = publish.
const PBR_RECAP_MODE = 'auto';

/** Run once by hand. Replaces any earlier PBR end-of-week trigger so there is exactly one. */
function installPbrWeeklyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pbrEndweekRun')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('pbrEndweekRun')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.TUESDAY)
    .atHour(PBR_TRIGGER_HOUR)
    .inTimezone(PBR_TZ) // follows PST/PDT automatically
    .create();
  Logger.log(`Installed Tuesday ${PBR_TRIGGER_HOUR} AM Pacific trigger for pbrEndweekRun.`);
}

/** Called by the time trigger. Safe to run by hand too. */
function pbrEndweekRun() {
  pbrDispatchRepositoryEvent('pbr-endweek-trigger', { recap_mode: PBR_RECAP_MODE });
}

const PBR_TOKENS_HOUR = 9; // fires somewhere within 9:00-10:00 AM Pacific

/** Run once by hand. Replaces any earlier daily token trigger so there is exactly one. */
function installPbrDailyTokenTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pbrTokensRun')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('pbrTokensRun')
    .timeBased()
    .everyDays(1)
    .atHour(PBR_TOKENS_HOUR)
    .inTimezone(PBR_TZ)
    .create();
  Logger.log(`Installed daily ${PBR_TOKENS_HOUR} AM Pacific trigger for pbrTokensRun.`);
}

/** Called by the daily trigger. Safe to run by hand too. */
function pbrTokensRun() {
  pbrDispatchRepositoryEvent('pbr-tokens-trigger', {});
}

const PBR_DAILY_SCORE_HOUR = 2; // fires somewhere within 2:00-3:00 AM Pacific, after the night's last game

/** Run once by hand. Replaces any earlier daily score trigger so there is exactly one. */
function installPbrDailyScoreTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pbrDailyScoreRun')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('pbrDailyScoreRun')
    .timeBased()
    .everyDays(1)
    .atHour(PBR_DAILY_SCORE_HOUR)
    .inTimezone(PBR_TZ)
    .create();
  Logger.log(`Installed daily ${PBR_DAILY_SCORE_HOUR} AM Pacific trigger for pbrDailyScoreRun.`);
}

/** Called by the daily trigger. Safe to run by hand too. Read-only on MFL; the week stays tentative until Tuesday. */
function pbrDailyScoreRun() {
  pbrDispatchRepositoryEvent('pbr-dailyscore-trigger', {});
}

// Game-day live scores: kickoff to kickoff + 4.5 h covers the final whistle, so the last run in a
// game's window captures its final score.
const PBR_SEASON = '2026';
const PBR_LIVE_WINDOW_MS = 4.5 * 60 * 60 * 1000;
const PBR_SCHEDULE_CACHE_SECONDS = 30 * 60;

/** Run once by hand. Replaces any earlier PBR live trigger so there is exactly one. */
function installPbrLiveTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pbrLiveTick')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('pbrLiveTick')
    .timeBased()
    .everyMinutes(10)
    .create();
  Logger.log('Installed 10-minute trigger for pbrLiveTick.');
}

/** Called every 10 minutes. Dispatches a PBR live score sync only while an NFL game is in its window. */
function pbrLiveTick() {
  const now = Date.now();
  const games = pbrNflSchedule();
  const live = games.filter(g => g.kickoffMs <= now && now <= g.kickoffMs + PBR_LIVE_WINDOW_MS);
  if (live.length === 0) {
    Logger.log(`No game in window (${games.length} games on the schedule). Skipping.`);
    return;
  }
  Logger.log(`${live.length} game(s) in window: ${live.map(g => g.teams).join(', ')}. Dispatching PBR live sync.`);
  pbrDispatchRepositoryEvent('pbr-livescore-trigger', {});
}

/**
 * This NFL week's games as [{kickoffMs, teams}] from MFL's nflSchedule export (current week).
 * Cached for 30 minutes so most ticks make no MFL call at all.
 */
function pbrNflSchedule() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('pbrNflSchedule');
  if (cached) return JSON.parse(cached);

  const url = `https://api.myfantasyleague.com/${PBR_SEASON}/export?TYPE=nflSchedule&JSON=1`;
  const response = UrlFetchApp.fetch(url, {
    headers: { 'User-Agent': 'GoogleAppsScript-PbrTrigger' },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(`nflSchedule failed (${response.getResponseCode()}): ${response.getContentText().slice(0, 200)}`);
  }
  const body = JSON.parse(response.getContentText());
  const games = [].concat((body.nflSchedule && body.nflSchedule.matchup) || [])
    .filter(m => m.kickoff)
    .map(m => ({
      kickoffMs: parseInt(m.kickoff, 10) * 1000,
      teams: [].concat(m.team || []).map(t => t.id).join('@')
    }));
  cache.put('pbrNflSchedule', JSON.stringify(games), PBR_SCHEDULE_CACHE_SECONDS);
  return games;
}

/** Sends a repository_dispatch event. Event types are league-prefixed so they never start Ultimate workflows. */
function pbrDispatchRepositoryEvent(eventType, clientPayload) {
  const props = PropertiesService.getScriptProperties();
  const pat = props.getProperty('GITHUB_PAT');
  const owner = props.getProperty('GITHUB_OWNER');
  const repo = props.getProperty('GITHUB_REPO');
  if (!pat || !owner || !repo) {
    throw new Error('Missing script property: GITHUB_PAT, GITHUB_OWNER, and GITHUB_REPO are required.');
  }

  const response = UrlFetchApp.fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'GoogleAppsScript-PbrTrigger'
    },
    contentType: 'application/json',
    payload: JSON.stringify({ event_type: eventType, client_payload: clientPayload || {} }),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  if (status === 204) {
    Logger.log(`Dispatched ${eventType}.`);
  } else {
    // Throwing makes Apps Script email the failure to the script owner.
    throw new Error(`Dispatch ${eventType} failed (${status}): ${response.getContentText()}`);
  }
}
