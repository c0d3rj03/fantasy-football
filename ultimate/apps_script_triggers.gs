/**
 * Ultimate Guillotine: Google Apps Script triggers (copy of the code that runs in Apps Script).
 * No secrets in this file. Set these in Project Settings > Script properties:
 *   GITHUB_PAT  fine-grained token for c0d3rj03/fantasy-football with "Contents: Read and write"
 *   OWNER       c0d3rj03
 *   REPO        fantasy-football
 *
 * Setup: paste this file, run installUltimateDailyTrigger() once, and approve the permissions.
 *
 * Every day at about 2:00 AM Pacific:
 *   Tuesday:     ultimate-endweek-trigger (ultimate_endweek.yml: score sync, then cut + weekly winner)
 *   Other days:  ultimate-dailyscore-trigger (ultimate_dailyscore.yml: score sync only)
 * The sync decides the dashboard phase itself (results vs live), so running it daily also
 * catches Wednesday games.
 */

const ULTIMATE_TZ = 'America/Los_Angeles';

/** Run once by hand. Replaces any earlier Ultimate trigger so there is exactly one. */
function installUltimateDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'ultimateDailyRun')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('ultimateDailyRun')
    .timeBased()
    .everyDays(1)
    .atHour(2)              // Apps Script fires somewhere within 2:00-3:00 AM
    .inTimezone(ULTIMATE_TZ) // follows PST/PDT automatically
    .create();
  Logger.log('Installed daily 2 AM Pacific trigger for ultimateDailyRun.');
}

/** Called by the time trigger. Safe to run by hand too. */
function ultimateDailyRun() {
  // 'u': 1 = Monday ... 7 = Sunday
  const day = parseInt(Utilities.formatDate(new Date(), ULTIMATE_TZ, 'u'), 10);
  if (day === 2) {
    Logger.log('Tuesday: dispatching end-of-week run (sync + commish).');
    dispatchRepositoryEvent('ultimate-endweek-trigger');
  } else {
    Logger.log(`Day ${day}: dispatching daily score sync.`);
    dispatchRepositoryEvent('ultimate-dailyscore-trigger');
  }
}

/** Sends a repository_dispatch event. Event types are league-prefixed so they never start PBR workflows. */
function dispatchRepositoryEvent(eventType) {
  const props = PropertiesService.getScriptProperties();
  const pat = props.getProperty('GITHUB_PAT');
  const owner = props.getProperty('OWNER');
  const repo = props.getProperty('REPO');
  if (!pat || !owner || !repo) {
    throw new Error('Missing script property: GITHUB_PAT, OWNER, and REPO are required.');
  }

  const response = UrlFetchApp.fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'GoogleAppsScript-GuillotineTrigger'
    },
    contentType: 'application/json',
    payload: JSON.stringify({ event_type: eventType }),
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
