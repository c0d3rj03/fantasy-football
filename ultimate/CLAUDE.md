# CLAUDE.md: Ultimate Guillotine League (`ultimate/`)

Shared repo context, conventions, and run commands are in the root `CLAUDE.md`. This file covers only the Ultimate league.

Full league rules (scoring, eliminations, roster progression, FAAB, prizes) are here:

@RULES.md

**League ID:** `25918`, defined once in `ultimate/config.js` (with `SEASON_YEAR` and `MFL_HOST`). Never read it from env vars or secrets.

---

## Project Purpose

Automates commissioner administration and provides a web dashboard for a 24-team **Ultimate Guillotine Fantasy Football League** hosted on MyFantasyLeague (MFL).

* **League Commissioner (`c0d3rj03` / Joe):** Uses automated scripts and GitHub Actions to run weekly eliminations, execute mandatory roster drops (`C=MANDROP`) on MFL, and log prize winners.
* **24 League Contenders:** Use the GitHub Pages dashboard to track live rolling 2-week scores, see weekly high-score prize winners, and view eliminated ("axed") teams in the graveyard UI.

---

## Module Responsibilities & Data Flow

0. **`ultimate/config.js`**: Single source for `LEAGUE_ID`, `SEASON_YEAR` (env `SEASON_YEAR` overrides, default `'2026'`), and `MFL_HOST`. Every script imports from here.
1. **`ultimate/mfl_commish_client.js`**: Takes `seasonYear` and `leagueId` as constructor parameters (throws if missing). Authenticates via `https://www42.myfantasyleague.com/2026/login`, captures the `MFL_USER_ID` session cookie, and executes API requests (`apiRequest()`) or POST form submissions (`submitCommishForm()`).
2. **`ultimate/mfl_scores_fetcher.js`**: Fetches live scores from MFL, updates completed player points (`doneScore`) and remaining players (`ytp`), updates single-week scores, and handles live-to-final week transitions.
3. **`ultimate/commish_automation.js`**:
   * Reads `data.json`.
   * Calculates rolling 2-week sums for active teams.
   * Cuts bottom 2 teams (W2-W6) or bottom 1 team (W7-W16).
   * Submits `C=MANDROP` to MFL for cut franchise IDs.
   * Logs the weekly high-score winner to `data.weeklyWinners`.
   * Sets `isLive = false` and writes updated `data.json`.
4. **`ultimate/data.json`**: Single source of truth for league state (`currentWeek`, `isLive`, `franchises`, `eliminatedTeams`, `weeklySingleScores`, `weeklyWinners`, `liveDetails`).

### Automation Trigger Pipeline

```text
Google Apps Script (Code.gs)
  │
  ├── 2:00 AM ET (Game Nights)  ──> ultimate_dailyscore.yml ──> Runs mfl_scores_fetcher.js
  │                                  (repository_dispatch type: ultimate-sync-trigger)
  │
  └── 5:00 AM ET (Tuesdays)     ──> ultimate_endweek.yml    ──> Runs commish_automation.js
                                     (repository_dispatch type: ultimate-endweek-trigger)
```
* Both workflows also keep `workflow_dispatch` for manual runs. Neither has `push` or `schedule` triggers.
* Both share the `ultimate-data` concurrency group (they both commit `data.json`) and `git pull --rebase` before pushing.
* **Apps Script settings:** Tokens are loaded via `PropertiesService.getScriptProperties()` (`GITHUB_PAT`, `OWNER`, `REPO`).

---

## Current State

### Working
* `mfl_commish_client.js` authenticates cleanly and maintains session cookies.
* `commish_automation.js` correctly calculates rolling 2-week scores, identifies the bottom team(s), issues `C=MANDROP` roster cuts on MFL, logs high-score winners, and writes `data.json`.
* `.github/workflows/ultimate_dailyscore.yml` and `.github/workflows/ultimate_endweek.yml` run via `workflow_dispatch`. The repository_dispatch types were added 2026-10-25; the Apps Script must send them (see Known Issues).
* Google Apps Script correctly fetches properties from `PropertiesService`.

---

## Known Issues (code review against RULES.md, 2026-10-25)

State at review time: `data.json` has `currentWeek: 7`, `isLive: true`. The end-of-week workflow has not committed since 2026-10-08; Weeks 5 and 6 were handled manually.

### Critical: do not run `ultimate_endweek.yml` until #2–#4 and #10 are fixed
1. **(Data fixed 2026-10-25.)** `eliminatedTeams` was rebuilt from a read-only MFL `rosters` export (10 empty rosters, 2 per week W2–W6), checked against the commissioner's published results sheet. `weeklyWinners` W4 was converted to the UI format and W5/W6 were added. Original problem: **`data.json` `eliminatedTeams` was out of sync with the league.** It lists 8 teams, all from Weeks 2–4. Four are logged as Week 4 cuts from two separate runs (2026-10-07 and 2026-10-08, both with `currentWeek` still 4). `0004` (Ichabod Crane) is marked eliminated but scored in Weeks 5 and 6, so it is still alive. Teams actually cut after Weeks 5 and 6 (for example `0020`, plus the teams with Week 6 scores but no Week 7 activity) are missing. A Tuesday run would treat eliminated teams as active, likely "cut" one with a 0 score, and MANDROP the wrong franchise. Reconcile before the next run: an eliminated team has 0 players on its MFL roster, so a read-only `export?TYPE=rosters` call identifies who is alive. Rebuild `eliminatedTeams` from that and the Weeks 2–6 results.
2. **No idempotency guard.** `commish_automation.js` never records which week it processed. Running it twice for the same `currentWeek` cuts again (this is how Week 4 got four cuts in `data.json`). It should refuse to run if `eliminatedTeams` already has entries for `currentWeek`.
3. **Wrong-week risk.** It uses `data.currentWeek`, which the fetcher sets from MFL `liveScoring.week`. If the fetcher runs after MFL rolls the week over, the commish run processes the new week with no scores.
4. **MANDROP result is never checked.** `submitCommishForm()` ignores `res.ok` and the HTML response. A MANDROP can legitimately fail when the commissioner already dropped the roster by hand, so failure is not an error by itself. The script should instead confirm the franchise's roster is empty (via `rosters` export) after the drop, and warn only if players remain. The `FRANCHISE_ID` form field name is unverified against MFL's actual form.

### Rules mismatches
5. **Week 6 cut count (fixed 2026-10-25).** The code and RULES.md prose cut 2 teams only through Week 5. Confirmed by the commissioner and the rules doc: **2 cuts after Weeks 2–6**, 1 after Weeks 7–16. Both are corrected.
6. **No elimination tiebreaker.** Ties in rolling score are ordered arbitrarily by `Array.sort`. RULES.md defines none; decide one (for example lower single-week score, then season total).
7. **Weekly winner.** Ties are not handled (the first franchise seen wins). It also awards a "winner" for Week 17, which has no weekly prize, and it does not record the prize amount or type from RULES.md.
8. **Week 17 finish not implemented.** Nothing computes 1st/2nd/3rd from the final rolling scores.
9. **Prize table conflict in the reference docx.** Its weekly table shows $10/$10/$20/$40 and 3rd place $60, while its prose (and RULES.md) say $15/$30/$50 and $85. The prose matches the $1,115 pool, so RULES.md is treated as correct.

### Data and dashboard
10. **Schema mismatch between script and UI (existing data fixed 2026-10-25; the script still writes the wrong shape).** `commish_automation.js` writes `eliminatedTeams[fid] = {week, score, name}` and `weeklyWinners[w] = {fid, name, score}`, but `index.html` reads `eliminatedWeek` and `franchiseName`. So Week 4's cuts and winner are broken on the dashboard (Week 4 teams vanish from every week, and the winner name shows `undefined`). Older entries use `{eliminatedWeek, rollingScore, singleScore, franchiseName}` and `{franchiseId, franchiseName, score, prize}`; standardize on that.
11. **Single-week scores depend on manual MFL adjustments.** The fetcher derives `single(W) = MFL(W) − single(W−1)`, which is only right if the prior week's score was entered as a starting adjustment on MFL. Without it, `Math.max(0, …)` hides the error. This is why the `adjustScores` push (Next Steps #1) matters.
12. **Fetcher starter filter.** Players with no `status` are counted as starters, which may include bench players if MFL omits the field.
13. **Fetcher rewrites `data.json` from scratch.** Only `eliminatedTeams` and `weeklyWinners` are carried over; any other top-level key added later is lost.
14. `ultimate/index_html.txt` is an empty stray file.

### Workflows and scheduling
15. **`ultimate-sync-trigger` is listed in `.github/workflows/pbr_endweek.yml`.** If the Apps Script sends that event, it starts the PBR end-of-week workflow. The Ultimate live sync now listens on the same type, so remove it from the PBR workflow (a PBR-side change).
16. **Apps Script triggers are deleted (2026-10-25) and will be rebuilt.** The old functions (`triggerUltimateDailyScoreUpdate`, `triggerUltimateEndOfWeekCommishActions`) called `workflow_dispatch` on `ultimate.yml` / `commish.yml`, which no longer exist, so they would have returned 404. The rebuild should either call `workflow_dispatch` on `ultimate_dailyscore.yml` / `ultimate_endweek.yml`, or send `repository_dispatch` with `ultimate-sync-trigger` / `ultimate-endweek-trigger`. The old helper read script properties `GITHUB_PAT`, `GITHUB_OWNER`, `GITHUB_REPO` (the root `CLAUDE.md` says `OWNER`/`REPO`); pick one set.
17. **Push trigger removed (2026-10-25).** `ultimate_dailyscore.yml` used to run on every push to `ultimate/**`, so doc edits started live syncs and raced local pushes. Scheduling is external, so it was dropped.

### Missing MFL Score Adjustments (`TYPE=adjustScores`)
* **Symptom:** `commish_automation.js` updates rolling scores locally in `data.json`, but does NOT push the prior week's single-scores to MFL as starting adjustments (`import?TYPE=adjustScores&W={currentWeek+1}`). Starting scores are therefore missing on MFL's website unless entered manually in `csetup?C=FSCOREADJ`.

---

## Candidates for shared `common/` (not built yet)

From `mfl_commish_client.js` (`pbr/mfl_updater.js` has its own copy of most of this):
* **Login and cookie capture** (`login()`): `Set-Cookie` header with the XML `cookie_value` fallback. Add re-login when the cookie expires.
* **`apiRequest()`**: `export`/`import` GET/POST with `L` and `JSON=1`, plus the `!res.ok` error.
* **`submitCommishForm()`**: `csetup` form POSTs (`MANDROP`, `STANDADJ`, `DIVCONF`, `FSCOREADJ`). Add response validation (detect MFL error HTML) before sharing it.
* **Retry / rate-limit wrapper** (none exists today).
* **User-Agent**: make it a parameter (currently hardcoded `UltimateGuillotineCommish`).
* From `mfl_scores_fetcher.js`: `fetchMFL()` (unauthenticated export GET), `normalizeArray()`, and the `weeklyResults` / `liveScoring` fetches.

Stays in `ultimate/`: `config.js`, rolling-score math, the cut schedule, prize tiers, and the `data.json` shape. The client constructor already takes `seasonYear`/`leagueId` as parameters with no league defaults, so it is ready to move.

---

## Frontend UI Theme

Heavy metal / blood-red guillotine styling, dark metallic progress bars, split 2-part scoring bars (prior week + current week), and "axed/slashed" graveyard callouts for eliminated teams.

---

## Next Steps

1. **[High priority] Add the MFL score adjustment loop to `commish_automation.js`:** Insert an `import?TYPE=adjustScores` POST loop targeting `W: currentWeek + 1` for surviving teams, so single-week carryover scores populate natively on MFL for the upcoming week.
2. **GroupMe bot integration:** Use the GroupMe Bot API (`dev.groupme.com`) to post weekly elimination announcements and high-score prize callouts after the Tuesday 5:00 AM ET commissioner run.
3. **Finalize the GitHub Pages frontend:** Complete the dashboard (`c0d3rj03.github.io/fantasy-football/ultimate`) with split 2-part progress bars, weekly winner callout cards, and graveyard elimination visuals.
4. **Validation:** Monitor the automated 2:00 AM ET and 5:00 AM ET GitHub Action runs during active game weeks to confirm zero-error execution.
