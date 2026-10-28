# CLAUDE.md: Premier Battle Royale League (`pbr/`)

Shared repo context, conventions, secrets, and run commands are in the root `CLAUDE.md`. This file covers only the PBR league.

Full league rules (VP scoring, quarters, promotion/relegation, postseason guillotine, tokens, prizes, commish calendar) are here:

@RULES.md

**League ID:** `63213` (fixed; defined in this folder's code, not in env vars or secrets).

---

## Project Purpose

Automation and a GitHub Pages dashboard for the 12-team **PBR Superflex dynasty league** on MFL. Teams are split into Upper/Middle/Lower divisions that change through quarterly Promotion & Relegation, followed by a postseason guillotine in each division.

* **Commissioner (`c0d3rj03` / Joe Sosa):** uses the scripts and GitHub Actions to tally weekly Victory Points, push VP adjustments to MFL, track Participation Tokens, and post weekly recaps to Slack.
* **12 owners:** use the dashboard (`c0d3rj03.github.io/fantasy-football/pbr`) for standings, recaps, tokens, and prizes, and read the AI-written recap ("Gemmy") in Slack.

---

## Module Responsibilities

The `pbr/` scripts are currently **CommonJS** (`require`), not ES Modules. See Known Issues.

### Scores, standings, MFL admin
* **`mfl_scores_fetcher.js`**: Reads MFL exports (league, schedule, weekly results). Computes per-week H2H VP, in-division top-2 VP, PF/PP, and quarter standings, and evaluates P&R. Writes `data.json`. Holds the hardcoded `LEAGUE_ID`, `YEAR`, and a default franchise → division map.
* **`mfl_updater.js`**: Logs into MFL with `MFL_USERNAME`/`MFL_PASSWORD` (cookie accumulation, hidden-field scraping). POSTs in-division VPs to `csetup?C=STANDADJ&VICTORY_POINTS=1`. Writes debug HTML (`csetup_form.html`, `mfl_response.html`).

### Recaps ("Gemmy") and Slack
* **`generate_post.js`**: Builds the weekly recap.
  * Pulls recent Slack banter from the PBR channels.
  * Prompts Gemini (`@google/generative-ai`) for a creative league post.
  * Posts it to `#officialcomms` (bot token, falling back to the webhook).
  * Saves the recap into `data.json` / `recap.json` for the dashboard.
* **`gemmy_custom_post.js`**: One-off Gemmy announcement from a free-text prompt (REST call to Gemini, posted to Slack).
* **`sync_recaps.js`**: Pulls posted recaps back from Slack `#officialcomms` into `data.json` and `gemmy_week_N.md`.
* **`save_recap.js`, `embed_recaps.js`**: Helpers that write or merge recap text into `data.json`.
* **`../notify_slack.js`** (repo root): Posts a markdown file to `SLACK_WEBHOOK_URL`. PBR-only in practice.

### Tokens (Participation Tokens, KTC trade values)
* **`mfl_tx_fetcher.js`**: Pulls MFL trades and `BBID_WAIVER` claims of $25 or more into `tokens_data.json`.
* **`process_trades.js`, `process_waivers.js`, `rebuild_tokens.js`**: Apply the token rules (trade value tiers, $25+ waiver claims capped at 5 per quarter) to `tokens_data.json`.
* **`ktc_fetcher.js`, `merge_ktc_history.js`, `mfl_ktc_mapper.js`**: Fetch KeepTradeCut values (monthly snapshots in `ktc-values/`, yearly roll-ups in `history/<year>/` and `ktc-<year>-data.json`). Map MFL player IDs to KTC (`mfl_ktc_player_map.json`; misses go to `unmatched_assets.json`). `mfl_players.json` is the cached MFL player list.

### Frontend (GitHub Pages)
* **`index.html` + `pbr.js`**: Standings and weekly results dashboard (reads `data.json`).
* **`tokens.html` + `tokens.js`**: Token tracker (reads `tokens_data.json`).
* **`prizes.html`**: Prize tracker.
* The `*_html.txt` / `*_json.txt` files are text copies of the matching files (for pasting into AI tools). They are not used at runtime.

### Data files
* **`data.json`**: Single source of truth for PBR league state.
  * `weekly_data["1".."12"]` → `{ week, quarter, played, active_divisions, matchups[], recap }`.
  * Division codes: `"00"` = Upper, `"01"` = Middle, `"02"` = Lower.
* **`tokens_data.json`**: Token ledger (trades, waivers, promotions, balances).

---

## Automation (GitHub Actions)

| Workflow | Trigger | What it runs |
| --- | --- | --- |
| `pbr_endweek.yml` | `workflow_dispatch`, `repository_dispatch: pbr-endweek-trigger` | `mfl_scores_fetcher.js` → `mfl_updater.js` → `generate_post.js`, then commits `data.json`, `recap.json`, `tokens_data.json` |
| `pbr_sync.yml` | `workflow_dispatch`, `repository_dispatch: pbr-sync-trigger` | Scores fetch → (`commish_watch.js`, which doesn't exist yet) → `gemmy_custom_post.js` with a prompt, then commits `pbr/` |
| `gemmy_alerts.yml` | `workflow_dispatch` (prompt input) | `gemmy_custom_post.js "<prompt>"` |

External dispatches come from Google Apps Script (same `GITHUB_PAT` / `OWNER` / `REPO` properties as Ultimate).

Secrets used by PBR: `MFL_USERNAME`, `MFL_PASSWORD`, `GEMINI_API_KEY`, `SLACK_PBR_BOT_TOKEN`, `SLACK_WEBHOOK_URL`, and the four `PBR_SLACK_CHANNEL_*` IDs. See the root `CLAUDE.md` for what each one is.

---

## Lessons from Ultimate MFL automation (2026-10-27)

Ultimate's end-of-week MFL writes were rebuilt and verified live. Their code is `ultimate/mfl_commish_client.js`, `ultimate/mfl_csetup_form.js` and `ultimate/commish_mfl_actions.js`; see `ultimate/CLAUDE.md`. Apply the same pattern here, ideally by moving the login and form helper into `common/`.

* **Commissioner mode:** after login, GET `logout?L=…&BECOME=0000` and keep the `MFL_IS_COMMISH` cookie. `mfl_updater.js` already does this.
* **Post the whole csetup form.** GET the form fresh (it has an `input_expires` token), parse every field a browser would send, change only ours, and POST everything back. `mfl_csetup_form.js` does this and takes no league ID. `pushInDivisionVPs()` instead builds its payload by hand from the hidden fields plus guessed names (`WEEK<fid>`, `ADJUST_VP<fid>`, `EXP<fid>`, `PREFIX`, `ASUBMIT`), so any other field on the STANDADJ form is dropped.
* **Get field names from the live form.** Use an inspect mode that prints the form's fields (emails masked, password fields skipped; Action logs may be public). Never guess them.
* **Check before writing; verify after.** MFL answers 200 even when it ignores a form. Each step should read MFL first and skip work already done, so reruns are safe, then re-read MFL afterwards and fail if the change isn't there. Today `pushInDivisionVPs()` adds +1 VP on every run (a rerun doubles it) and only logs errors, so the job still passes.
* **Gate writes.** Ultimate writes only with the dispatch input `apply` or repo variable `ULTIMATE_MFL_WRITES=1`. A dry run logs the exact field changes. A PBR equivalent would be `PBR_MFL_WRITES`.
* **Score adjustments:** use the documented `import?TYPE=franchiseScoreAdjustment` (`FRANCHISE`, `WEEK`, `POINTS`, `EXPLANATION`). `weeklyResults&W=N` shows an existing adjustment as `adj_score`, so you can check before adding. `mfl_scores_fetcher.js` uses `TYPE=adjustScores`, which is not in MFL's API docs. Relevant for the Week 13 "Postseason Bonus".
* **`import?TYPE=accounting` is the league money ledger, not FAAB.** FAAB changes go through `C=BBIDWAIV` (`ADJUST_FRANCHISE_BBID`, `BBID_ADJUSTMENT<fid>` as a +/− delta).

---

## Reference Material (`reference/`)

* `2026 PBR Bylaws.docx`: authoritative rules (condensed into `RULES.md`).
* `PBR Commish Actions.xlsx`: weekly, quarter-change, postseason, and end-of-year commish checklists. Includes worked examples of the Week 5 W-L-T and VP resets.
* `2026 PBR Results & Standings .xlsx`: the official standings spreadsheet the automation is replacing. Use it to check computed VP, PF, PP, and bonuses.
* `2026 PBR Token Tracker.xlsx`: the official token ledger. Use it to check `tokens_data.json`.
* `PBR Schedule MFL Importer.xlsx`: builds each quarter's MFL schedule text from division slots #1-#12.

---

## Known Issues (found during the 2026-10-25 handoff review)

1. **Bot token name mismatch:**
   * `gemmy_alerts.yml` passes `secrets.SLACK_BOT_TOKEN`, which doesn't exist (the secret is `SLACK_PBR_BOT_TOKEN`).
   * `sync_recaps.js` reads `process.env.PBR_SLACK_BOT_TOKEN`, but the workflows export the token as `SLACK_BOT_TOKEN`.
2. **`pbr_sync.yml` references files that don't exist:** `pbr/commish_watch.js`, `pbr/fetcher.js`, and a root `pbr_data.json`. The steps skip silently. Its default prompt is hardcoded to Q1 events.
3. **`pbr_endweek.yml` also listens for `ultimate-sync-trigger`,** so an Ultimate dispatch would run the PBR pipeline. Remove it unless that's intentional.
4. **League ID and year are repeated** in `mfl_scores_fetcher.js`, `mfl_updater.js`, `mfl_tx_fetcher.js`, `process_waivers.js`, and every PBR workflow. Consolidate them into `pbr/config.js`.
5. **Module system:** PBR scripts use CommonJS while the repo convention (and `ultimate/`) is ES Modules. Migrate before sharing code with `common/`.
6. **Gemini model names differ:** `generate_post.js` uses `gemini-3.8-flash` (SDK) and `gemmy_custom_post.js` uses `gemini-2.5-flash` (REST). Define the model in one place.
7. **Default division map is hardcoded** in `mfl_scores_fetcher.js` (2026 Q1). Later quarters must come from MFL or `data.json`, not this map.
8. **Manual steps not yet automated:**
   * Quarter W-L-T/VP resets (Weeks 5 and 9).
   * `DIVCONF` division moves.
   * Quarterly schedule upload.
   * Postseason Week 13 bonus adjustment.
   * Postseason guillotine tracking.
