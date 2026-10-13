# CLAUDE.md: Repository Context (Shared)

**Repository:** `c0d3rj03/fantasy-football`

This repo houses automation for more than one fantasy football league. Each league lives in its own folder with its own `CLAUDE.md`:

- `ultimate/`: Ultimate Guillotine League 2026 (see `ultimate/CLAUDE.md`)
- `pbr/`: separate PBR league (see `pbr/CLAUDE.md`)

**Always confirm which league a task applies to before changing code.** League rules differ, and a fix for one league must not break the other.

---

## Repository Structure

```text
fantasy-football/ (Repo Root)
├── .github/
│   └── workflows/
│       ├── ultimate.yml        # Daily/live score fetcher workflow
│       └── commish.yml         # Tuesday 5 AM ET end-of-week commissioner workflow
├── ultimate/
│   ├── commish_automation.js   # Weekly elimination & roster drop script
│   ├── mfl_scores_fetcher.js   # Live & final score synchronization script
│   ├── mfl_commish_client.js   # MFL HTTP API & web form submission client
│   └── data.json               # Central league state file
├── pbr/                        # Separate PBR league directory
└── package.json                # Standard ES Modules ("type": "module")
```

---

## How to Run

### Prerequisites
* Node.js 18+ or 20+
* Git

### Local Setup
```bash
git clone https://github.com/c0d3rj03/fantasy-football.git
cd fantasy-football
npm install
```

### Local Execution (ultimate league)
```bash
# 1. Fetch live/final scores and update ultimate/data.json
node ultimate/mfl_scores_fetcher.js

# 2. Run end-of-week commissioner elimination & roster drops
cd ultimate
node commish_automation.js
```

### Required Environment Variables & GitHub Secrets (names only, never commit values)

All of these are shared by every league (one MFL login, owned by the commissioner):
* `SEASON_YEAR` (default: `'2026'`)
* `MFL_USERNAME`
* `MFL_PASSWORD`
* `GITHUB_PAT` (Google Apps Script property)
* `OWNER` (Google Apps Script property: `'c0d3rj03'`)
* `REPO` (Google Apps Script property: `'fantasy-football'`)

### League IDs

League IDs are NOT environment variables or secrets. Each league has its own ID that never changes, and each league has its own code, so the ID lives in that league's folder:
* Ultimate: `25918`, defined once in the `ultimate/` code.
* Define the ID in ONE place per league (a small `config.js` in the league folder that the league's scripts import), not repeated across files. If an ID is currently hardcoded in several files, consolidate it.
* Never share code between league folders in a way that lets one league's scripts pick up another league's ID.

---

## Conventions

* **Module system:** ES Modules (`"type": "module"`). All local relative imports MUST include the `.js` extension (e.g., `import MflCommishClient from './mfl_commish_client.js';`).
* **Filenames:** Use underscores in JavaScript filenames (`commish_automation.js`, `mfl_scores_fetcher.js`), NEVER hyphens.
* **MFL identifiers:** Franchise IDs MUST always be zero-padded 4-digit strings (e.g., `"0001"`, `"0009"`). Week numbers are integers `1` to `18`.
* **Git staging scope:** Stage only the target directory (e.g., `git add ultimate/`) to avoid picking up uncommitted files in sibling league folders like `pbr/`.

---

## Known Git Issue

GitHub Actions commits updated `data.json` automatically, so local pushes can be rejected (`[rejected] main -> main (fetch first)`). Fix: `git pull --rebase origin main`, or stash local edits before pulling.

---

## Decisions & History

* **Single repo, multiple leagues:** Reused `c0d3rj03/fantasy-football` with subdirectories (`ultimate/`, `pbr/`) instead of separate repos, enabling unified GitHub Pages hosting.
* **Dual-path MFL automation:** Use standard MFL JSON API endpoints for reads/imports where supported. Use fallback form-submission POSTs (`C=MANDROP`, `C=STANDADJ`) with session cookies for admin actions that lack official REST APIs.
* **ES Module standardization:** Node scripts use ES Module syntax (`"type": "module"`, explicit `.js` import extensions) to support Node 18+.
* **Abandoned approach:** Manual Google Sheet updating (`CommishDuties` tab / `Weekly Scoring Sheet`) was replaced by headless Node.js automation triggered via GitHub Actions.
