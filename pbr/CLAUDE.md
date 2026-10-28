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
* **`config.js`**: `LEAGUE_ID`, `YEAR` (env `MFL_YEAR`/`SEASON_YEAR`, default 2026), `MFL_HOST`, division names, and `Q1_SLOTS` (each division's scheduling slots #1-#4 for Q1, from the importer sheet). New code reads these from here.
* **`pbr_rules.js`**: League rules as pure functions, shared by the fetcher and the MFL script:
  * `inDivisionVPs`: top 2 per division; ties across a slot split the VP (a tie for 2nd is 0.5 each).
  * `promotionRelegation`: RULES.md §5 tiebreakers; an exact tie is reported as a coin flip.
  * `nextQuarterSlots`: staying teams keep standings order, a relegated team takes #1 of the lower division, a promoted team #4 of the higher one.
  * `quarterSchedule` / `scheduleLine`: the importer sheet's matrix. In quarter week k, Upper #i plays Middle #(i+k) and Lower #(i+k), and Middle #i plays Lower #(i+k), mod 4. Lines are `WW,FFFF,FFFF`.
  * `postseasonBonus`: §6.
* **`mfl_scores_fetcher.js`**: Reads MFL exports (league, weekly results; no login). Computes per-week H2H VP, in-division VP, PF/PP, quarter and season standings, and P&R after Weeks 4/8/12. Writes `data.json`, including `quarter_slots` and `promotion_relegation`. Starts from `Q1_SLOTS`; later quarters' divisions come from its own P&R. Its old `TYPE=adjustScores` VP push was removed 2026-10-27.
* **`commish_mfl_actions.js`**: The commissioner's MFL steps for week W (RULES.md §10). Reads MFL, compares it with `data.json`, prints a checklist (also to the Actions run summary), writes only what MFL is missing, then re-reads MFL and fails if a written step isn't there. See "MFL commish automation" below. Replaced `mfl_updater.js` (removed 2026-10-27).

### Recaps ("Gemmy") and Slack
* **`generate_post.js`**: Builds the weekly recap (rewritten 2026-10-27; it had been a syntax error since 2026-10-07, so Weeks 5-6 got no recap).
  * Targets the latest played week (or `node generate_post.js <week>`).
  * Sends Gemini a compact week summary plus the last 7 days of Slack banter from the PBR channels.
  * Models: `GEMINI_MODEL` (repo variable `PBR_GEMINI_MODEL`), comma-separated and tried in order with a `GEMINI_TIMEOUT_MS` timeout each (default `gemini-2.5-flash,gemini-2.5-flash-lite`, 90 s). The 2.5-flash timeouts before were most likely the old prompt, which sent the whole `data.json` (and once `tokens_data.json`, 2.4 MB). The prompt is now about 5 KB.
  * `GEMMY_MODE`: `auto` posts to `#officialcomms` (bot token, falling back to the webhook) and saves to `data.json` `weekly_data[week].recap`. `draft` writes `gemmy_drafts/week_<N>.md` only. `publish` posts that file exactly as edited, saves it, and deletes the draft.
  * Skips a week that already has a recap (`GEMMY_FORCE=1` to redo). `GEMMY_SLACK=0` saves without posting. `GEMMY_NOTES` adds an instruction. Exits 1 on any failure.
* **`gemini_check.js`**: Lists the Gemini models the key can call and times each on the real recap prompt (workflow `pbr_gemini_check.yml`). Use it to pick `PBR_GEMINI_MODEL`.
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
| `pbr_endweek.yml` | `workflow_dispatch` (inputs `week`, `mfl_mode` auto/dry-run/apply/inspect/skip, `recap_mode` auto/draft/publish/skip, `recap_notes`, `post_to_slack`, `force_recap`), `repository_dispatch: pbr-endweek-trigger` (`client_payload.recap_mode`, default auto; MFL step runs in auto) | `mfl_scores_fetcher.js` → `commish_mfl_actions.js` → `generate_post.js`, then commits `data.json` and `gemmy_drafts/`. The recap and the commit run even if the MFL step failed; the job still fails. |
| `pbr_gemini_check.yml` | `workflow_dispatch` (inputs `models`, `timeout_seconds`) | `gemini_check.js`: read-only model list and timing |
| `pbr_sync.yml` | `workflow_dispatch`, `repository_dispatch: pbr-sync-trigger` | Scores fetch → (`commish_watch.js`, which doesn't exist yet) → `gemmy_custom_post.js` with a prompt, then commits `pbr/` |
| `gemmy_alerts.yml` | `workflow_dispatch` (prompt input) | `gemmy_custom_post.js "<prompt>"` |

External dispatches come from Google Apps Script (same `GITHUB_PAT` / `OWNER` / `REPO` properties as Ultimate). The code is `apps_script_triggers.gs`: every Tuesday about 6 AM Pacific it sends `pbr-endweek-trigger` with `recap_mode` from `PBR_RECAP_MODE`.

**Reviewing a recap before it posts:** run `pbr_endweek.yml` with `recap_mode = draft`, edit the committed `pbr/gemmy_drafts/week_<N>.md` (or rerun draft with `recap_notes`), then run with `recap_mode = publish`. The second run's MFL step finds nothing missing, so it writes nothing.

**Weekly commish checklist** (from `reference/PBR Commish Actions.xlsx`): a normal week (not 4/5/8/9/12) is just confirm results, add In-Division Top 2 VPs (explanation "In-Division Top 2 Score"), and post the recap. Weeks 4/8 add P&R and the next-quarter schedule upload; weeks 5/9 add the W-L-T and VP resets and `DIVCONF` moves; week 12 adds final P&R, the postseason schedule, and the Week 13 bonus. See RULES.md §10. Nothing should dispatch `pbr-sync-trigger` (see Known Issues).

`pbr_endweek.yml` is rerun-safe: `commish_mfl_actions.js` pushes only the difference between `data.json` and MFL, and `generate_post.js` skips weeks that have a recap.

Secrets used by PBR: `MFL_USERNAME`, `MFL_PASSWORD`, `GEMINI_API_KEY`, `SLACK_PBR_BOT_TOKEN`, `SLACK_WEBHOOK_URL`, and the four `PBR_SLACK_CHANNEL_*` IDs. See the root `CLAUDE.md` for what each one is.

---

## MFL commish automation (`commish_mfl_actions.js`, 2026-10-27)

```bash
node pbr/mfl_scores_fetcher.js                 # data.json (read-only MFL exports)
node pbr/commish_mfl_actions.js [week]         # dry run (latest played week by default)
node pbr/commish_mfl_actions.js [week] --apply # write every automated step
node pbr/commish_mfl_actions.js --inspect      # print the commish forms' fields (emails masked)
```

Without MFL credentials, a dry run still reads the public exports and prints the plan. With credentials it also logs in, loads each form, and logs the exact field changes. It fails if a field it would post is not on the live form.

**Write gates:**
* `--apply` (workflow `mfl_mode = apply`) writes every automated step.
* Repo variable `PBR_MFL_WRITES=1` (workflow `mfl_mode = auto`, used by the Tuesday dispatch) writes only the weekly VP step. Quarter-change steps stay dry runs until someone reads the dry run and runs `apply`.
* Anything else is a dry run.

**Steps by week** (✅ already done on MFL, 🤖 automated, ✋ manual with exact numbers listed, ❌ needs a person):

| Week | Step | How |
| --- | --- | --- |
| 1-12 (latest played) | In-division VP 🤖 | Compares MFL `leagueStandings` with the `data.json` quarter standings. W-L-T must match first. Then it adds `data.json VP − MFL VP` per team on `C=STANDADJ&VICTORY_POINTS=1` (`WEEK<fid>`, `ADJUST_VP<fid>`, `EXP<fid>` = "In-Division Top 2 Score"). In a normal week that difference must equal this week's in-division VP, or the step stops (`--sync-vp` pushes it anyway). A rerun finds no difference. Older weeks are skipped, since MFL only shows the current total. |
| 5, 9 | W-L-T reset 🤖 | Detected when MFL W-L-T is exactly this quarter plus last quarter. Subtracts each team's prior-quarter W-L-T on `C=STANDADJ` (`WEEK<fid>`, `W<fid>`, `L<fid>`, `T<fid>` as negatives, `EXP<fid>` = "Q2 Reset"). With `--apply`, the VP step then runs in a second pass of the same run. |
| 5, 9 | VP reset 🤖 | Part of the VP step once the W-L-T reset is done: the difference then also removes last quarter's in-division VP (explanation "Q2 Reset + In-Division Top 2 Score"). |
| 5, 9 | Division moves 🤖 | Compares MFL divisions with `data.json` `quarter_slots` and sets `FRANCHISE_DIVISION<fid>` (`00`/`01`/`02`) on `C=DIVCONF` for the teams that moved; re-reads the `league` export. |
| 4, 8, 12 | P&R ✅ | From `data.json` `promotion_relegation[q]` and `quarter_slots[q+1]` (`"4"` = postseason). Printed for the announcement. An exact tie is ❌ (coin flip). |
| 4, 8 | Next quarter schedule 🤖 | Builds the quarter's 48 games from the new slots and compares them with MFL's `schedule` export. If they differ, it takes the live `SCHEDULE` textarea on `options?O=168` (the whole season, 192 lines on 2026-10-27, Weeks 13-16 as `BYE,BYE` lines), replaces only that quarter's lines, posts it, and re-reads the export. |
| 12 | Week 13 Postseason Bonus 🤖 | `postseasonBonus` from season standings and postseason divisions. Checks `weeklyResults W=13` `adj_score`, then uses `import?TYPE=franchiseScoreAdjustment` ("Postseason Bonus"). |
| 12 | Postseason schedule, `DIVCONF` ✋ | Not automated. |

**STANDADJ forms have two submit buttons:** `ASUBMIT` (Adjust Standings) and `DSUBMIT` (Delete Selected Standings Adjustments, with `D_<week>_<fid>` checkboxes for existing adjustments). A browser sends only the clicked button, so `common/mfl_csetup_form.js` keeps only the first submit and the PBR script names `ASUBMIT` explicitly.

**Verified (2026-10-27):**
* Offline: Q1 → Q2 P&R and slots reproduce the importer sheet; the generated Q2 schedule matches MFL Weeks 5-8 exactly; the Week 7 dry run gives +1 VP to 0001, 0002, 0004, 0006, 0007 and 0009.
* Live `--inspect`: field names for STANDADJ (VP and W-L-T), DIVCONF and `options?O=168` as listed above.

**Not yet verified live:**
* A STANDADJ VP write (first `apply` run, Week 7).
* Whether STANDADJ accepts fractional VP (a tie for 2nd gives 0.5, a three-way tie 0.6667).
* The W-L-T reset, DIVCONF and schedule writes (first used after Week 8 and in Week 9). Review their dry run first. DIVCONF has file inputs (division logos), so it may be a multipart form; the client posts multipart when the form says so, and the inspect output now shows `enctype`.

### Lessons from Ultimate MFL automation

* **Commissioner mode:** after login, GET `logout?L=…&BECOME=0000` and keep the `MFL_IS_COMMISH` cookie (`common/mfl_commish_client.js`).
* **Post the whole form.** GET it fresh (it has an `input_expires` token), parse every field a browser would send, change only ours, and POST everything back (`common/mfl_csetup_form.js`).
* **Get field names from the live form** (`--inspect`). Never guess them.
* **Check before writing; verify after.** MFL answers 200 even when it ignores a form.
* **Score adjustments:** use `import?TYPE=franchiseScoreAdjustment` (`FRANCHISE`, `WEEK`, `POINTS`, `EXPLANATION`). `weeklyResults&W=N` shows an existing one as `adj_score`. `TYPE=adjustScores` is not in MFL's API docs.
* **`import?TYPE=accounting` is the league money ledger, not FAAB.** FAAB changes go through `C=BBIDWAIV`.

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
3. ~~`pbr_endweek.yml` also listened for `ultimate-sync-trigger`~~ (removed 2026-10-27).
4. **League ID and year are repeated** in `mfl_tx_fetcher.js`, `process_waivers.js`, and every PBR workflow. `config.js` exists (2026-10-27) and `mfl_scores_fetcher.js` and `commish_mfl_actions.js` use it. Move the rest over.
5. **Module system:** PBR scripts use CommonJS while the repo convention (and `ultimate/`, `common/`) is ES Modules. `commish_mfl_actions.js` loads `common/` with a dynamic `import()` until `pbr/` is migrated.
6. **Gemini model is set in two places:** `generate_post.js` (`GEMINI_MODEL`, default `gemini-2.5-flash`) and `gemmy_custom_post.js` (hardcoded `gemini-2.5-flash`). Define it in one place.
7. **Q1 slots are hardcoded** in `config.js` (2026). Later quarters come from the fetcher's P&R. Next season's Q1 slots must be set from the postseason finish.
8. **Manual steps not yet automated** (`commish_mfl_actions.js` lists them with exact numbers):
   * Postseason schedule (after Week 12) and postseason guillotine tracking.
9. ~~`mfl_updater.js` VP push~~ (rebuilt as `commish_mfl_actions.js` 2026-10-27; see "Not yet verified live" above).
