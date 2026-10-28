# CLAUDE.md: Repository Context (Shared)

**Repository:** `c0d3rj03/fantasy-football`

This repo houses automation and GitHub Pages dashboards for more than one fantasy football league on MFL. More leagues may be added. Each league lives in its own folder with its own `CLAUDE.md`, `RULES.md`, and `reference/` folder:

- `ultimate/`: Ultimate Guillotine League 2026, 24 teams, MFL league `25918` (see `ultimate/CLAUDE.md`)
- `pbr/`: Premier Battle Royale, 12-team Superflex dynasty, MFL league `63213` (see `pbr/CLAUDE.md`)

**Always confirm which league a task applies to before changing code.** League rules differ, and a fix for one league must not break the other.

---

## Repository Structure

```text
fantasy-football/ (Repo Root)
├── .github/workflows/
│   ├── ultimate_dailyscore.yml   # Ultimate: live score sync (dispatch, or push to ultimate/**)
│   ├── ultimate_endweek.yml      # Ultimate: Tuesday eliminations & MANDROP
│   ├── pbr_endweek.yml           # PBR: scores → MFL commish actions (VP push, quarter changes) → Gemmy recap
│   ├── pbr_sync.yml              # PBR: Tuesday sync + custom Gemmy announcement
│   └── gemmy_alerts.yml          # PBR: ad-hoc Gemmy Slack announcement
├── common/                       # Shared MFL client + csetup form helper (ES Modules, own package.json)
├── ultimate/                     # Ultimate league (ES Modules, own package.json)
├── pbr/                          # PBR league (currently CommonJS)
├── index.html                    # GitHub Pages landing page
├── notify_slack.js               # Posts a markdown file to SLACK_WEBHOOK_URL (PBR only)
└── package.json                  # Root deps: @google/generative-ai, @slack/web-api
```

`common/` holds logic shared by all leagues (see Shared Code below).

---

## How to Run

### Prerequisites
* Node.js 20 (what the workflows use; 18+ works)
* Git

### Local Setup
```bash
git clone https://github.com/c0d3rj03/fantasy-football.git
cd fantasy-football
npm install
```

### Local Execution
See each league's `CLAUDE.md`. For example:
```bash
node ultimate/mfl_scores_fetcher.js
cd ultimate && node commish_automation.js
node pbr/mfl_scores_fetcher.js
```

---

## Secrets & Configuration (names only, never commit values)

### GitHub repository secrets
| Secret | Used by | Purpose |
| --- | --- | --- |
| `MFL_USERNAME` | both leagues | Commissioner MFL login (one login, owns both leagues) |
| `MFL_PASSWORD` | both leagues | Commissioner MFL password |
| `GEMINI_API_KEY` | PBR | Google Gemini API, generates the creative "Gemmy" league posts and recaps |
| `SLACK_PBR_BOT_TOKEN` | PBR | Slack bot token for the PBR workspace: post messages, read channel history for banter and recaps |
| `SLACK_WEBHOOK_URL` | PBR | Incoming webhook, a fallback way to post to Slack without the bot token |
| `PBR_SLACK_CHANNEL_OFFICIALCOMMS` | PBR | Channel ID for `#officialcomms`, where weekly recaps and official announcements go |
| `PBR_SLACK_CHANNEL_GENERAL` | PBR | Channel ID for `#general`, read for banter context |
| `PBR_SLACK_CHANNEL_RANDOM` | PBR | Channel ID for `#random`, read for banter context |
| `PBR_SLACK_CHANNEL_TRADE_TALK` | PBR | Channel ID for `#trade-talk`, read for banter context |

* **Slack and Gemini are PBR-only.** Ultimate does not use Slack. A GroupMe bot for Ultimate is a possible future enhancement and would get its own secret (for example `ULTIMATE_GROUPME_BOT_ID`).
* New secrets for a single league should carry the league prefix (`PBR_…`, `ULTIMATE_…`).
* `GITHUB_TOKEN` is the built-in Actions token, used to push the automated `data.json` commits.

### Not secrets
* **League IDs:** fixed per league and kept in that league's folder (see below). Never put them in secrets.
* **Season year:** set in workflow `env` (`SEASON_YEAR` / `MFL_YEAR`, currently `'2026'`) with a code default.

### Google Apps Script properties (outside GitHub)
The Apps Script that dispatches the workflows on a schedule reads `GITHUB_PAT`, `OWNER` (`'c0d3rj03'`), and `REPO` (`'fantasy-football'`) from `PropertiesService.getScriptProperties()`.

### Scheduling
* **Don't rely on GitHub `schedule:` cron triggers.** They fired unreliably.
* All timed runs are started externally by a Google Sheets Apps Script time trigger, which calls the GitHub API (`repository_dispatch` / `workflow_dispatch`).
* Every workflow must therefore keep a `workflow_dispatch` and/or `repository_dispatch` trigger. Dispatch event types must be league-prefixed and unique (`pbr-…`, `ultimate-…`) so one league's trigger never starts another league's workflow.
* A Claude scheduled routine may replace the Apps Script later.
* The workflow YAMLs are known to need cleanup; see each league's `CLAUDE.md` Known Issues.

### League IDs
League IDs never change, and each league has its own code, so the ID lives in that league's folder:
* Ultimate: `25918`. PBR: `63213`.
* Define the ID in ONE place per league (a small `config.js` in the league folder that the league's scripts import), not repeated across files. If an ID is currently hardcoded in several files, consolidate it.
* Workflows should not need to pass the league ID. If they must, it has to match the league's `config.js`.

---

## Shared Code (`common/`)

Logic that every MFL league needs belongs in one shared module so the leagues can't drift apart:
* MFL login and session-cookie handling.
* `export` API GETs, `import` API POSTs, and `csetup` form POSTs (`STANDADJ`, `MANDROP`, `adjustScores`, `DIVCONF`).
* Weekly results and live scoring fetches.
* Retry and rate-limit logic.

Built so far (moved from `ultimate/` 2026-10-27; verified live on Ultimate):
* `common/mfl_commish_client.js`: `new MflCommishClient(year, leagueId, host, { userAgent })`. Login with the `BECOME=0000` commissioner switch, `apiRequest` (export/import), `fetchPage` / `fetchCommishPage`, `submitCsetupForm(c, changes, { dryRun, params, requireExisting })`, and `submitPageForm` for non-csetup pages (e.g. `options?O=168`).
* `common/mfl_csetup_form.js`: parse a form into what a browser would send, change named fields, POST the full form back; `describeForms()` for masked `--inspect` dumps.
* `ultimate/mfl_commish_client.js` and `ultimate/mfl_csetup_form.js` are thin wrappers (Ultimate's host and User-Agent). PBR (CommonJS) loads `common/` with a dynamic `import()`.
* Still duplicated: unauthenticated export fetches and `normalizeArray` in each league's scripts; no retry/rate-limit wrapper yet.

The pattern and its pitfalls are in `pbr/CLAUDE.md`, "MFL commish automation".

Rules for shared code:
* Shared modules take the league ID (and year) as a **parameter**. They never define, default, or read a league ID themselves.
* Each league's `config.js` passes its own ID in, so one league's scripts can never pick up another league's ID.
* League-specific rules (VP, eliminations, tokens, P&R) stay in the league folder.
* Changing `common/` affects every league, so check each league's callers before changing a shared function's behavior or signature.

---

## Conventions

* **Module system:** ES Modules (`"type": "module"`). All local relative imports MUST include the `.js` extension (e.g., `import MflCommishClient from './mfl_commish_client.js';`).
  * `ultimate/` and `common/` follow this. `pbr/` is still CommonJS; its new scripts load `common/` with `await import(...)` until it is migrated.
  * The root `package.json` has no `"type"` yet.
* **Filenames:** Use underscores in JavaScript filenames (`commish_automation.js`, `mfl_scores_fetcher.js`), NEVER hyphens.
* **MFL identifiers:** Franchise IDs MUST always be zero-padded 4-digit strings (e.g., `"0001"`, `"0009"`). Week numbers are integers `1` to `18`.
* **Git workflow:** Commit directly to `main` (no PR flow). Mark meaningful releases with **tags**. Suggested format: `<league>-<season>-w<week>` (for example `pbr-2026-w8`), or `vYYYY.MM.DD` for repo-wide changes.
* **Git staging scope:** Stage only the target directory (e.g., `git add ultimate/`) to avoid picking up uncommitted files in sibling league folders like `pbr/`.

---

## Known Git Issue

GitHub Actions commits updated `data.json` automatically, so local pushes can be rejected (`[rejected] main -> main (fetch first)`). Fix: `git pull --rebase origin main`, or stash local edits before pulling.

---

## Decisions & History

* **Single repo, multiple leagues:** Reused `c0d3rj03/fantasy-football` with subdirectories (`ultimate/`, `pbr/`) instead of separate repos. This enables unified GitHub Pages hosting and shared code.
* **Shared `common/` code (decided 2026-10-25):** Common MFL logic will be consolidated so leagues can't drift apart. League IDs stay per-league, either hardcoded in `config.js` or otherwise local, never secrets.
* **Dual-path MFL automation:** Use standard MFL JSON API endpoints for reads and imports where supported. Use fallback form-submission POSTs (`C=MANDROP`, `C=STANDADJ`) with session cookies for admin actions that lack official REST APIs.
* **ES Module standardization:** Node scripts use ES Module syntax (`"type": "module"`, explicit `.js` import extensions) to support Node 18+.
* **Abandoned approach:** Manual Google Sheet updating (`CommishDuties` tab / `Weekly Scoring Sheet`) was replaced by headless Node.js automation triggered via GitHub Actions.
