# CLAUDE.md: Become a Dynasty (BaD)

10-team dynasty league on MFL, league `57713` (`www42`), one division. Commissioner: the repo owner.
Bylaws (Google Doc, published): https://docs.google.com/document/d/e/2PACX-1vQYvLUzLchMlnSUtTYcxMYHIKgiG--u5Hg56Io-KLf8xC6Oui1Xe4Y_OL9YgufWJ0v1s-WaErSMp184/pub

## Rules that matter for automation
* Lineup: 2 QB, 2 RB, 3 WR, 1 TE, 3 flex (RB/WR/TE). 27-man rosters, no IR or taxi. 0.5 PPR.
* Standings: victory points: 2 for an H2H win, 1 for a top-5 score of the week. Tiebreakers: win %, head-to-head (2 teams: their record; 3+: only a sweep), points for, points against.
* Weeks 1-9: fixed round-robin. Weeks 10-14 are themed and set by the commissioner:
  * 10 "I've Earned This": 1st vs 10th, 2nd vs 9th, ... by standings (Tuesday).
  * 11 "Ten Kissing Sisters": pair by best projected lineup, 1st vs 2nd, 3rd vs 4th, ... (Thursday 3pm ET).
  * 12 "Separate the Wheat from the Chaff": 1-6, 2-7, 3-8, 4-9, 5-10 by standings (Tuesday).
  * Weeks 10-12 are automated in `themed_matchups.js`. The higher-ranked team is home.
  * 13 / 14: teams pick opponents (order by points for / by playoff bubble), Wednesday 12:30pm ET.
* Playoffs Weeks 15-17, top 6.

## Scripts
* `config.js`: league ID, host, season, lineup shape. ES Modules (`bad/package.json`).
* `themed_matchups.js --week N`: prints a Slack post (code-block table) and the detail behind it. `--inspect | --dry-run | --apply [--force] [--post-slack]`; apply refuses to replace existing matchups unless forced. `--post-slack` posts the Slack text only when this run saved and MFL confirmed (never on a dry run or an "already set" rerun). `--slack-test` posts a one-line test.
  * Week 11: best lineup per team from `export?TYPE=projectedScores&W=N&PLAYERS=...` (blank score = no projection = 0).
  * Weeks 10/12: standings computed from the `schedule` export (scores and W/L appear only once a week is final; until then score 0, result T). Refuses until the previous week is final and MFL's `leagueStandings` include it, and fails if computed VP differs from MFL's (standings adjustments). Checked 2026-11-23: replaying Week 10 gave MFL's actual Week 10 games, and VP/PF after Week 10 matched MFL for all 10 teams.
* `standings_post.js --after N [--post-slack]` (Weeks 11-14): standings with `y` (clinched bye, top 2), `x` (clinched top 6), `e` (eliminated), next week's scenarios ("clinches with a win", "eliminated with a loss"), the Week 13 pick order (by PF) after Week 12, the Week 14 pick order (7,6,8,5,4,3,9,2,1,10) after Week 13, and after Week 14 the playoff field and Week 15 games. Clinch math is sound but conservative: 15 VP a week, at most 3 per team, a VP tie counts as being caught; next week's real matchups are enumerated (1,632 outcomes) when MFL has them, later weeks use only the totals. Checked 2026-11-24 against Weeks 9 and 10 by hand.
* Workflow `.github/workflows/bad_matchups.yml` "BaD Themed Matchups" (`workflow_dispatch`, or `repository_dispatch` type `bad-matchups-trigger` with `client_payload.week`/`mode`): `week` 10/11/12, `mode` preview / inspect / dry-run / apply / standings / slack-test, `post_to_slack` (apply, standings); run names read "BaD <mode> week <N>[ + Slack]". It commits nothing.

## MFL: WEEKSCHED form
`csetup?L=57713&C=WEEKSCHED&W=<week>` (inspect 2026-11-17): selects `AWAY_<n>` / `HOME_<n>` for rows 0-5 (franchise IDs or `BYE`), checkbox `DEL_<n>`, select `ADD_GAMES`, submit `SUBMIT` ("Save Matchups"). Confirm by `export?TYPE=schedule&W=<week>`.

## Slack
Posts go to the league workspace's #general through an incoming webhook (repo secret `BAD_SLACK_WEBHOOK_URL`, added 2026-11-24; no bot token, no channel ID). The URL is a secret: never log it.

## Not built
No dashboard, no scores sync. Weeks 13/14 (owners pick opponents) are manual.
