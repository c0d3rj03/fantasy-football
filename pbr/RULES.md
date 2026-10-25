# RULES.md: Premier Battle Royale (PBR) Dynasty League

Condensed from `reference/2026 PBR Bylaws.docx` (last updated 10/11/2026) for use by automation and the dashboard. The bylaws document is authoritative; if it and this file disagree, the bylaws win. If the bylaws and MFL site settings disagree, **MFL settings prevail** until corrected.

Sections marked **[Automation]** describe behavior the code must implement. Owner conduct, sanctions, orphan teams, and governance are summarized at the end for context only.

---

## 1. League at a Glance

| Item | Value |
| --- | --- |
| Format | 12-team dynasty, Superflex, PPR (position-specific) + points per carry |
| Host | MFL, league `63213` (`https://www42.myfantasyleague.com/2026/home/63213`) |
| Divisions | 3 divisions of 4: Upper (`00`), Middle (`01`), Lower (`02`) |
| Regular season | NFL Weeks 1-12, split into three 4-week quarters |
| Postseason | NFL Weeks 13-17, total-points guillotine within each division |
| Communication | Slack (`premierebattleroyale.slack.com`) |
| Money | LeagueSafe; dues $100/season + MFL hosting share ($110 total) |

Franchise IDs are 4-digit zero-padded strings (`"0001"` to `"0012"`).

---

## 2. Rosters

* **Active roster:** max 25 players, min 20, during the season (Roster Cutdown through the last postseason game). No limits in the offseason (MFL roster limit set to 99).
* **Position rules (active roster only):** at least 1 QB, 2 RB, 2 WR, 1 TE. Max 6 QBs.
* **Injured Reserve:** 3 slots, open from Roster Cutdown through end of postseason. Eligibility is whatever MFL flags (`(I)` or `(C)`). An ineligible player left on IR blocks that team's lineup/transactions on MFL.
* **Taxi Squad:** 4 slots. Eligible: rookie or 2nd-year player drafted in Rounds 4-6 this year or last year, or (effective 2026) drafted at 3.13 or 3.14.
  * Filled at Roster Cutdown. Players may be activated in-season but cannot return that season.
  * All players are activated off the Taxi Squad at season end.
  * A traded Taxi player may be demoted immediately by the receiving team (announce it; commish confirms).
* **Roster Cutdown:** week of the NFL's first game. Teams over 25 are cut by the commish, lowest KeepTradeCut dynasty value first.

## 3. Starting Lineup (10 starters)

1 QB, 1 RB, 1 WR, 1 TE, 1 Superflex (QB/RB/WR/TE), 5 Flex (RB/WR/TE). Positions as defined by MFL. Players lock at their NFL kickoff.

## 4. Scoring [Automation: read from MFL; do not recompute]

MFL computes all player scores (rounded to 2 decimals). For reference:

| Event | Scoring |
| --- | --- |
| Passing yards (all) | 1 pt per 25 yds |
| Rushing yards, QB | 1 pt per 15 yds |
| Rushing yards, RB/WR/TE | 1 pt per 10 yds |
| Receiving yards (all) | 1 pt per 10 yds |
| Passing TD | 0-39 yds: 2 · 40-59 yds: 4 · 60+ yds: 6 |
| Rushing TD | 0-14 yds: 4 · 15-39 yds: 5 · 40+ yds: 6 (bylaws table typo reads "60+"; MFL `options?L=63213&O=09` confirms 40+) |
| Receiving TD | 0-39 yds: 4 · 40-59 yds: 5 · 60+ yds: 6 |
| Receptions | RB 0.75 · WR/QB 1.0 · TE 1.5 for receptions 1-4, then 1.0 |
| Rushing attempt (all) | 0.10 |
| 2-pt conversion | 1.0 |
| Interception thrown / fumble lost | -2.0 each |

Official NFL stat corrections are applied by MFL on Thursday mornings and can change past results. Automation that caches weekly results should allow for a Thursday re-sync.

---

## 5. Regular Season (Weeks 1-12) [Automation]

### Quarters
* Q1 = Weeks 1-4, Q2 = Weeks 5-8, Q3 = Weeks 9-12.
* **Victory Points (VP), PF, PP, and W-L-T reset to 0 at the start of each quarter.** The same 4-week schedule template repeats each quarter with the new division assignments.

### Weekly Victory Points (3 available per team per week)
1. **Two head-to-head games.** Each team plays one team from each of the other two divisions. Win = 1 VP, tie = 0.5 VP. Over a quarter, each team plays all 8 out-of-division teams once.
2. **In-Division "Battle Royale."** The **top 2 scores in each division** earn 1 VP each (2 VP per division per week). Ties for a slot split the VP.

Standings = VP for the current quarter. MFL tracks W-L-T from H2H games; the in-division VPs are added by the commish through `csetup?C=STANDADJ&VICTORY_POINTS=1` with an explanation.

### Promotion & Relegation (P&R) — end of Weeks 4, 8, 12
* **Promotion:** the **1st-place team (most VP)** in the Middle and Lower divisions moves up one division.
  * Tiebreakers (highest wins): current-quarter PF → current-quarter win % → season PF → season win % → coin flip.
* **Relegation:** the team with the **lowest Potential Points (PP) for the quarter** in the Upper and Middle divisions moves down one division.
  * A team being promoted can't also be relegated; take the next-lowest PP instead.
  * Tiebreakers (lowest loses): current-quarter VP → current-quarter PF → current-quarter win % → season PF → season win % → coin flip.
* **Re-ranking for scheduling (slots #1-#12):** promoted teams take the bottom slot of their new, higher division (#4 or #8). Relegated teams take the top slot of their new, lower division (#5 or #9).

### Relegation Penalties (draft pick forfeits)
| After | Relegated from Upper | Relegated from Middle |
| --- | --- | --- |
| Q1 | none | none |
| Q2 | next year's 4th | next year's 4th |
| Q3 | next year's 3rd | next year's 3rd |

* Forfeited picks are the ones the team actually owns on the day of the token draw. Teams can acquire a pick up to the day before.
* **No pick in that round next year:** forfeit the following year's pick in that round (within tradeable years). If that's missing too, forfeit the next earlier round, then repeat the check. If nothing is eligible in the next two years, go to year 3 of the original round.
* **Several picks in that round:** forfeit the most recently acquired one.
* There is **no** extra double-relegation penalty. It was removed in 2023 and is struck out in the bylaws.
* Forfeited picks become token-draw prizes (see §9).

---

## 6. Postseason (Weeks 13-17) [Automation]

Every team plays, within its post-Q3 division. There are no H2H games. Each team's weekly scores **accumulate**, and the guillotine removes the lowest cumulative total.

| After Week | Action | Teams remaining |
| --- | --- | --- |
| 13 | No elimination | 4 |
| 14 | Lowest cumulative eliminated → 4th place | 3 |
| 15 | Lowest cumulative eliminated → 3rd place | 2 |
| 16 | No elimination | 2 |
| 17 | Lower of the final two → 2nd; the other → 1st | 1 |

### Regular-Season Bonus (head start applied to Week 13 score)
Applied once as an MFL score adjustment to Week 13 with explanation "Postseason Bonus". Uses full 12-week regular-season totals (all three quarters combined).

* **Upper Division (rewards better teams, based on PF):**
  * `avg = PF / 12` per team. `midpoint = mean(avg)` across the 4 teams.
  * `bonus = avg > midpoint ? 5 × (avg − midpoint) : 0`
* **Middle and Lower Divisions (rewards weaker teams, based on PP):**
  * `avg = PP / 12` per team. `ref = max(avg)` in the division.
  * `bonus = 5 × (ref − avg)` (0 for the top team).
* The bylaws round to 2 decimals (e.g. `5 × (140.91 − 137.50) = 17.03`).

### Outcomes
* **Season Champion** = Upper Division postseason winner.
* **Next season's draft order** (every round, non-snake):

| Division | 1st | 2nd | 3rd | 4th (first out) |
| --- | --- | --- | --- | --- |
| Lower | x.01 | x.02 | x.03 | x.04 |
| Middle | x.05 | x.06 | x.07 | x.08 |
| Upper | x.12 | x.11 | x.10 | x.09 |

* Final postseason divisions and placements also set **next season's Q1 divisions and schedule slots**.

---

## 7. Transactions

* **Waivers (FAAB):** processed daily at 11 AM ET, Wednesday-Sunday. One-day waiver period on dropped players. Ties go to the weaker team (MFL tiebreaker). $0 bids allowed.
* **FCFS:** players unclaimed after the first Wednesday waiver run are free to pick up ($0).
* **FAAB budget:** carryover is capped at $100, plus $400 added each new season (max $500). FAAB is tradeable.
* **Trades:** open all year. Players, draft picks (current year + next two), FAAB, and Tokens can be traded. No review period or vetoes, except a unanimous Executive Council veto, which 8 of 12 owners can override.
  * Tokens in a trade must be spelled out in the trade comments.
  * Trading picks beyond paid seasons requires paying those dues within 3 days or the trade is voided.
  * Not allowed: conditional, delayed, or two-part trades, or post-trade conditions.
* **Draft:** two-part rookie/FA draft. Rounds 1-2 about 3 weeks after the NFL Draft; Rounds 3-6 a few weeks before the season. Non-snake, 6-hour pick clock (paused overnight). Bonus picks 1.13, 2.13, 2.14, 3.13, 3.14 come from token awards.

---

## 8. Participation Tokens [Automation: `tokens_data.json`]

Tokens are distributed at the end of each quarter, including after the postseason. Offseason trades count toward the next distribution, up to Roster Cutdown.

| Activity | Tokens |
| --- | --- |
| Successful waiver claim of **$25 or more** | 1 per claim, **max 5 per quarter** |
| Trade, total KTC value 0-7,500 | 2 to each team |
| Trade, 7,500-15,000 | 4 to each team |
| Trade, 15,000-22,500 | 6 to each team |
| Trade, 22,500-30,000 | 8 to each team |
| Trade, 30,000-37,500 | 10 to each team (+2 per further 7,500) |
| Promoted Middle → Upper | after Q1: 1 · Q2: 2 · Q3: 3 |
| Promoted Lower → Middle | after Q1: 1 · Q2: 3 · Q3: 5 |

Trade value uses KeepTradeCut (KTC) dynasty values at the time of the trade.

**No tokens are awarded for gaming the system:**
* Reverse trades (the same or nearly the same trade undone).
* Reverse waivers (drop A for B, later drop B to re-add A).
* Chained waivers (A→B→C counts as one transaction).
* FAAB-for-FAAB trades (only the net difference counts).

The commish and Executive Council can deny other abuse.

**Token draw (after the season):** each team commits at least 50% of its tokens (minimum 1; teams with 0 tokens get no award). Committed tokens are tickets on a spinning wheel that sets the pick order. Teams then choose from 12 gifts:
* Bonus picks 1.13, 2.13, 2.14, 3.13, 3.14.
* The four forfeited relegation picks (Q2 Upper 4th, Q2 Middle 4th, Q3 Upper 3rd, Q3 Middle 3rd).
* $50 toward next year's fees.
* A refund of committed tokens.
* 10 tokens.

---

## 9. Prizes (paid via LeagueSafe; 7 of 12 owners approve payouts)

**Single-season prizes**

| Prize | Amount |
| --- | --- |
| Division winner, each division, each quarter (9 total) | $20 each ($180) |
| Highest total points in the league for the quarter (3 total) | $20 each ($60) |
| Weekly high score, Weeks 1-12 | $10 each ($120) |
| Season-high cumulative points | $50 |
| Season Champion | $200 |
| Runner-up (Upper Division postseason 2nd) | $50 |
| Making the Upper Division postseason (4 teams) | $20 each ($80) |
| Token draw "free fees" gift | $50 |

**Dynasty prizes** (remaining pool carried forward, about $410 per year)
* **Consecutive UD Postseason:** $20 × the number of consecutive years the team has made the Upper Division postseason, including this one. The base $20 is the single-season prize above.
* **Empire Pot:** the whole Dynasty pool goes to a champion who has won 2 titles in the last 3 seasons. Paid after all other prizes. A team can win it more than once.

---

## 10. Commissioner Calendar [Automation targets]

From `reference/PBR Commish Actions.xlsx`:

**Every week (Tuesday, after MNF)**
1. Confirm the week's results in Results & Standings.
2. Add in-division top-2 VPs on MFL (`csetup?L=63213&C=STANDADJ&VICTORY_POINTS=1`) with an explanation.

**After Weeks 4 and 8 (end of quarter)**
1. Run P&R and record the upcoming quarter's divisions and slots.
2. Generate the next quarter's schedule (PBR Schedule MFL Importer sheet).
3. Paste it into MFL at `options?L=63213&O=168` in commissioner mode: clear the box, paste column D, and drop the "MFL Coded" header row.

**After Weeks 5 and 9 (first week of the new quarter)**
1. Reset W-L-T on MFL (`C=STANDADJ`): subtract each team's prior-quarter W-L-T (explanation "Q2 Reset" or "Q3 Reset"). Removing wins also removes the H2H VPs that came with them.
2. Reset in-division VPs (`C=STANDADJ&VICTORY_POINTS=1`): subtract last quarter's remaining in-division VPs, net of this week's new in-division VP (explanation "Q2 Reset + In-Division Top 2 Score"). Standings must match Results & Standings for this week.
3. Move promoted and relegated teams to their new divisions (`csetup?L=63213&C=DIVCONF`).

**After Week 12**
1. Add VPs as usual.
2. Apply final P&R and reassign divisions (`C=DIVCONF`).
3. Set up the postseason schedule.
4. Add the postseason bonus to Week 13 scores (MFL score adjustment, explanation "Postseason Bonus").

**Postseason (Weeks 13-17)**
* Capture final results each week and apply guillotine eliminations as in §6.

**End of year / new MFL season (around Feb 15)**
* Activate the new MFL year.
* Transfer rosters and activate all players off IR and Taxi.
* Set draft order from the postseason finish, then import future traded picks, then add the .13/.14 bonus picks.
* Process token-draw pick "trades".
* Set roster limit to 99.
* FAAB: cap at $100 + $400 = max $500.
* Update divisions and upload the Q1 schedule.
* Roll the Token Tracker and Results & Standings sheets to the new year and update year references in code.

---

## 11. Conduct & Governance (context only)

* **Owner duties:** keep contact info current, respond to trades and messages promptly, set lineups weekly, and tell the commish about absences.
* **Prohibited:** tanking, illegal rosters (not enough active NFL players for a full lineup), anti-competitive trades, collusion, dumping players, and indifference (missing lineups).
* **Sanctions** (Executive Council approval):
  * 1st per season: forfeit the earliest available 4th, or a warning.
  * 2nd: forfeit the earliest available 3rd.
  * 3rd: suspension and ownership review.
* **Rule changes:**
  * Proposals are gathered in January and voted on in February.
  * Passing takes 7 of 12, or 9 of 12 for competitive-balance (scoring/roster) rules.
  * Changes take effect the following year.
  * Disbanding takes 12 of 12.
* **Council:**
  * Commissioner: Joe Sosa.
  * Deputy Commissioner: Jim Carsello.
  * Council members: Kushan Jayatilleke, Josh Ufland.
  * Alternate: Steven Quinn.

---

## Bylaws Notes

**Reading the bylaws .docx:** struck-through text has been removed from the rules. Plain-text extraction drops the strike formatting, so check run formatting (`w:strike`) before treating a passage as current.

**Resolved (2026-10-25):**
* Rushing TD tiers are 0-14 / 15-39 / **40+**. The bylaws table's "60+" is a typo.
* The double-relegation penalty was removed (struck out).
* The 2025-era tables (Divisions, Draft Order, Gift Table, League Calendar) are historical reference only. The bylaws need a refresh. Live divisions and draft order come from MFL and `data.json`.

**Still open (bylaws cleanup):**
1. **Prize pool split:** the Summary says $700 current / $500 dynasty. The Prize Payouts section says 70/30 of $1,200 but itemizes about $790 + $410.
2. **"(3)" footnote** on the Middle Division relegation penalty has no matching note.
3. **Bylaws typo:** the rushing TD table needs "60+" changed to "40+".
