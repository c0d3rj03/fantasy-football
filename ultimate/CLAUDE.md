# CLAUDE.md: Ultimate Guillotine League (`ultimate/`)

Shared repo context, conventions, and run commands are in the root `CLAUDE.md`. This file covers only the Ultimate league.

Full league rules (scoring, eliminations, roster progression, FAAB, prizes) are here:

@RULES.md

**League ID:** `25918` (fixed; defined in this folder's code, not in env vars or secrets).

---

## Project Purpose

Automates commissioner administration and provides a web dashboard for a 24-team **Ultimate Guillotine Fantasy Football League** hosted on MyFantasyLeague (MFL).

* **League Commissioner (`c0d3rj03` / Joe):** Uses automated scripts and GitHub Actions to run weekly eliminations, execute mandatory roster drops (`C=MANDROP`) on MFL, and log prize winners.
* **24 League Contenders:** Use the GitHub Pages dashboard to track live rolling 2-week scores, see weekly high-score prize winners, and view eliminated ("axed") teams in the graveyard UI.

---

## Module Responsibilities & Data Flow

1. **`ultimate/mfl_commish_client.js`**: Authenticates via `https://www42.myfantasyleague.com/2026/login`, captures the `MFL_USER_ID` session cookie, and executes API requests (`apiRequest()`) or POST form submissions (`submitCommishForm()`).
2. **`ultimate/mfl_scores_fetcher.js`**: Fetches live scores from MFL, updates completed player points (`doneScore`) and remaining players (`ytp`), updates single-week scores, and handles live-to-final week transitions.
3. **`ultimate/commish_automation.js`**:
   * Reads `data.json`.
   * Calculates rolling 2-week sums for active teams.
   * Cuts bottom 2 teams (W2-W5) or bottom 1 team (W6-W16).
   * Submits `C=MANDROP` to MFL for cut franchise IDs.
   * Logs the weekly high-score winner to `data.weeklyWinners`.
   * Sets `isLive = false` and writes updated `data.json`.
4. **`ultimate/data.json`**: Single source of truth for league state (`currentWeek`, `isLive`, `franchises`, `eliminatedTeams`, `weeklySingleScores`, `weeklyWinners`, `liveDetails`).

### Automation Trigger Pipeline

```text
Google Apps Script (Code.gs)
  │
  ├── 2:00 AM ET (Game Nights)  ──> Dispatches ultimate.yml ──> Runs mfl_scores_fetcher.js
  │
  └── 5:00 AM ET (Tuesdays)     ──> Dispatches commish.yml  ──> Runs commish_automation.js
```
* **Apps Script settings:** Tokens are loaded via `PropertiesService.getScriptProperties()` (`GITHUB_PAT`, `OWNER`, `REPO`).

---

## Current State

### Working
* `mfl_commish_client.js` authenticates cleanly and maintains session cookies.
* `commish_automation.js` correctly calculates rolling 2-week scores, identifies the bottom team(s), issues `C=MANDROP` roster cuts on MFL, logs high-score winners, and writes `data.json`.
* `.github/workflows/ultimate.yml` and `.github/workflows/commish.yml` run cleanly via `workflow_dispatch`.
* Google Apps Script correctly fetches properties from `PropertiesService`.

### Known Issue: Missing MFL Score Adjustments (`TYPE=adjustScores`)
* **Symptom:** `commish_automation.js` updates rolling scores locally in `data.json`, but does NOT push the prior week's single-scores to MFL as starting adjustments (`import?TYPE=adjustScores&W={currentWeek+1}`). Starting scores are therefore missing on MFL's website unless entered manually in `csetup?C=FSCOREADJ`.

---

## Frontend UI Theme

Heavy metal / blood-red guillotine styling, dark metallic progress bars, split 2-part scoring bars (prior week + current week), and "axed/slashed" graveyard callouts for eliminated teams.

---

## Next Steps

1. **[High priority] Add the MFL score adjustment loop to `commish_automation.js`:** Insert an `import?TYPE=adjustScores` POST loop targeting `W: currentWeek + 1` for surviving teams, so single-week carryover scores populate natively on MFL for the upcoming week.
2. **GroupMe bot integration:** Use the GroupMe Bot API (`dev.groupme.com`) to post weekly elimination announcements and high-score prize callouts after the Tuesday 5:00 AM ET commissioner run.
3. **Finalize the GitHub Pages frontend:** Complete the dashboard (`c0d3rj03.github.io/fantasy-football/ultimate`) with split 2-part progress bars, weekly winner callout cards, and graveyard elimination visuals.
4. **Validation:** Monitor the automated 2:00 AM ET and 5:00 AM ET GitHub Action runs during active game weeks to confirm zero-error execution.
