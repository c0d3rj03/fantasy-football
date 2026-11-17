# CLAUDE.md: Become a Dynasty (BaD)

10-team dynasty league on MFL, league `57713` (`www42`), one division. Commissioner: the repo owner.
Bylaws (Google Doc, published): https://docs.google.com/document/d/e/2PACX-1vQYvLUzLchMlnSUtTYcxMYHIKgiG--u5Hg56Io-KLf8xC6Oui1Xe4Y_OL9YgufWJ0v1s-WaErSMp184/pub

## Rules that matter for automation
* Lineup: 2 QB, 2 RB, 3 WR, 1 TE, 3 flex (RB/WR/TE). 27-man rosters, no IR or taxi. 0.5 PPR.
* Standings: victory points: 2 for an H2H win, 1 for a top-5 score of the week.
* Weeks 1-9: fixed round-robin. Weeks 10-14 are themed and set by the commissioner:
  * 10 "I've Earned This": 1st vs 10th, 2nd vs 9th, ... by standings (Tuesday).
  * 11 "Ten Kissing Sisters": pair by best projected lineup, 1st vs 2nd, 3rd vs 4th, ... (Thursday 3pm ET). Automated: `kissing_sisters.js`.
  * 12 "Wheat from the Chaff": 1-6, 2-7, 3-8, 4-9, 5-10 by standings (Tuesday).
  * 13 / 14: teams pick opponents (order by points for / by playoff bubble), Wednesday 12:30pm ET.
* Playoffs Weeks 15-17, top 6.

## Scripts
* `config.js`: league ID, host, season, lineup shape. ES Modules (`bad/package.json`).
* `kissing_sisters.js`: best lineup per team from `export?TYPE=projectedScores&W=N&PLAYERS=...` (blank score = no projection = 0), ranks, pairs, prints a Slack post (code-block table) and every lineup. `--inspect | --dry-run | --apply [--force]`.
* Workflow `.github/workflows/bad_matchups.yml` (`workflow_dispatch`, or `repository_dispatch` type `bad-matchups-trigger`): `mode` preview / inspect / dry-run / apply. It commits nothing.

## MFL: WEEKSCHED form
`csetup?L=57713&C=WEEKSCHED&W=<week>` (inspect 2026-11-17): selects `AWAY_<n>` / `HOME_<n>` for rows 0-5 (franchise IDs or `BYE`), checkbox `DEL_<n>`, select `ADD_GAMES`, submit `SUBMIT` ("Save Matchups"). Confirm by `export?TYPE=schedule&W=<week>`.

## Not built
No Slack posting (the commissioner posts by hand), no dashboard, no scores sync. Weeks 10 and 12 pairings by standings could reuse the WEEKSCHED code.
