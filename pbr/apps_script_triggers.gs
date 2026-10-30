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
 * Setup: paste this file, run installPbrWeeklyTrigger() and installPbrDailyTokenTrigger() once, and
 * approve the permissions. Delete any old PBR triggers/functions (for example ones that dispatch
 * pbr-sync-trigger, or the Token Tracker sheet's grabDailyMFLTransactions / updateMonthlyTradeValues).
 *
 * Every Tuesday at about 6:00 AM Pacific (after Monday Night Football):
 *   pbr-endweek-trigger -> pbr_endweek.yml: fetch MFL results into data.json, push in-division VPs
 *   to MFL, Gemmy recap (PBR_RECAP_MODE below), commit data.json for the dashboard.
 * Every day at about 9:00 AM Pacific (after the 11 AM ET waiver run):
 *   pbr-tokens-trigger -> pbr_tokens.yml: save this month's KTC values if not saved yet (so the 1st
 *   of the month takes the new snapshot), rebuild the token ledger (tokens_data.json).
 * Reruns are safe, so pbrEndweekRun() and pbrTokensRun() can also be run by hand.
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
