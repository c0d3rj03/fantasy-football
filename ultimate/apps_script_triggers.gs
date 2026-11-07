/**
 * Ultimate Guillotine: Google Apps Script triggers (copy of the code that runs in Apps Script).
 * No secrets in this file. Set these in Project Settings > Script properties:
 *   GITHUB_PAT    fine-grained token for c0d3rj03/fantasy-football with "Contents: Read and write"
 *   GITHUB_OWNER  c0d3rj03
 *   GITHUB_REPO   fantasy-football
 *
 * Setup: paste this file, run installUltimateDailyTrigger() once, and approve the permissions.
 *
 * Every day at about 2:00 AM Pacific:
 *   Tuesday:     ultimate-endweek-trigger (ultimate_endweek.yml: score sync, then cut + weekly winner)
 *   Other days:  ultimate-dailyscore-trigger (ultimate_dailyscore.yml: score sync only)
 * The sync decides the dashboard phase itself (results vs live), so running it daily also
 * catches Wednesday games.
 *
 * Game-day live scores: run installUltimateLiveTrigger() once. Every 10 minutes ultimateLiveTick()
 * reads MFL's NFL schedule for the current week and, only while a game is in its window
 * (kickoff to kickoff + 4.5 h), dispatches ultimate-livescore-trigger (ultimate_dailyscore.yml
 * with FETCH_MODE=live). The schedule covers every slot (Sun, Mon, Thu, Europe mornings,
 * Wed/Sat/holiday games), so nothing is hardcoded by day. The window runs past the final
 * whistle so the last run captures final scores.
 */

const ULTIMATE_TZ = 'America/Los_Angeles';
const ULTIMATE_SEASON = '2026';
const LIVE_WINDOW_MS = 4.5 * 60 * 60 * 1000;
const SCHEDULE_CACHE_SECONDS = 30 * 60;

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

/** Run once by hand. Replaces any earlier live trigger so there is exactly one. */
function installUltimateLiveTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'ultimateLiveTick')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('ultimateLiveTick')
    .timeBased()
    .everyMinutes(10)
    .create();
  Logger.log('Installed 10-minute trigger for ultimateLiveTick.');
}

/** Called every 10 minutes. Dispatches a live score sync only while an NFL game is on. */
function ultimateLiveTick() {
  const now = Date.now();
  const games = getUltimateNflSchedule();
  const live = games.filter(g => g.kickoffMs <= now && now <= g.kickoffMs + LIVE_WINDOW_MS);
  if (live.length === 0) {
    Logger.log(`No game in window (${games.length} games on the schedule). Skipping.`);
    return;
  }
  Logger.log(`${live.length} game(s) in window: ${live.map(g => g.teams).join(', ')}. Dispatching live sync.`);
  dispatchRepositoryEvent('ultimate-livescore-trigger');
}

/**
 * This week's NFL games as [{kickoffMs, teams}] from MFL's nflSchedule export (current NFL week
 * when no W is given). Cached for 30 minutes so most ticks make no MFL call at all.
 */
function getUltimateNflSchedule() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('ultimateNflSchedule');
  if (cached) return JSON.parse(cached);

  const url = `https://api.myfantasyleague.com/${ULTIMATE_SEASON}/export?TYPE=nflSchedule&JSON=1`;
  const response = UrlFetchApp.fetch(url, {
    headers: { 'User-Agent': 'GoogleAppsScript-GuillotineTrigger' },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(`nflSchedule failed (${response.getResponseCode()}): ${response.getContentText().slice(0, 200)}`);
  }
  const body = JSON.parse(response.getContentText());
  const matchups = [].concat((body.nflSchedule && body.nflSchedule.matchup) || []);
  const games = matchups
    .filter(m => m.kickoff)
    .map(m => ({
      kickoffMs: parseInt(m.kickoff, 10) * 1000,
      teams: [].concat(m.team || []).map(t => t.id).join('@')
    }));
  cache.put('ultimateNflSchedule', JSON.stringify(games), SCHEDULE_CACHE_SECONDS);
  return games;
}

/** Sends a repository_dispatch event. Event types are league-prefixed so they never start PBR workflows. */
function dispatchRepositoryEvent(eventType) {
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
