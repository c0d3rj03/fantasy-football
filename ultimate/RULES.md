# Ultimate Guillotine League: Rules & Domain Logic

*Every rule below must be precisely maintained by automated code. Applies to the `ultimate/` league only.*

### League Setup & Finances
* **Teams & Entry Fee:** 24 teams, $50 entry fee ($1,200 total pot).
* **Fees & Net Prize Pool:** $85 MFL software fee is refunded to the Commissioner, leaving a net prize pool of **$1,115**.

### Draft Format
* **Draft Date/Time:** Tuesday, September 1st, 9:00 AM ET on MFL.
* **Timer & Picks:** Slow draft with a 30-minute timer (timer turned off overnight 11:00 PM – 9:00 AM ET); 8 rounds (192 total picks).
* **Sliding Snake Grid:** Snake draft where order "slides" every odd round:
  * *Rounds 1 & 5:* Standard 1 to 24
  * *Rounds 2 & 6:* Reverse 24 to 1
  * *Rounds 3 & 7:* Shifted 13..24, then 1..12
  * *Rounds 4 & 8:* Shifted 12..1, then 24..13

### Roster & Lineup Progression
* **Starting Roster Size:** 8 players (0 Bench; 1 QB, 2 RB, 2 WR, 1 TE, 2 FLX).
* **Injured Reserve:** 1 IR slot enabled after the draft.
* **Weekly Roster & Starter Progression Schedule**:
  * **Week 1:** 24 teams alive | Roster 8 (1 QB, 2 RB, 2 WR, 1 TE, 2 FLX, 0 Bench)
  * **Week 2:** 24 teams alive | Roster 9 (1 QB, 2 RB, 2 WR, 1 TE, 2 FLX, 1 Bench)
  * **Week 3:** 22 teams alive | Roster 9 (1 QB, 2 RB, 2 WR, 1 TE, 2 FLX, 1 Bench)
  * **Week 4:** 20 teams alive | Roster 10 (1 QB, 2 RB, 2 WR, 1 TE, 2 FLX, 2 Bench)
  * **Week 5:** 18 teams alive | Roster 10 (1 QB, 2 RB, 2 WR, 1 TE, 2 FLX, 2 Bench)
  * **Week 6:** 16 teams alive | Roster 11 (1 QB, 2 RB, 2 WR, 1 TE, 3 FLX, 2 Bench)
  * **Week 7:** 14 teams alive | Roster 11 (1 QB, 2 RB, 2 WR, 1 TE, 3 FLX, 2 Bench)
  * **Week 8:** 13 teams alive | Roster 12 (1 QB, 2 RB, 3 WR, 1 TE, 3 FLX, 2 Bench)
  * **Week 9:** 12 teams alive | Roster 12 (1 QB, 2 RB, 3 WR, 1 TE, 3 FLX, 2 Bench)
  * **Week 10:** 11 teams alive | Roster 13 (2 QB, 2 RB, 3 WR, 1 TE, 3 FLX, 2 Bench)
  * **Week 11:** 10 teams alive | Roster 13 (2 QB, 2 RB, 3 WR, 1 TE, 3 FLX, 2 Bench)
  * **Week 12:** 9 teams alive | Roster 14 (2 QB, 3 RB, 3 WR, 1 TE, 3 FLX, 2 Bench)
  * **Week 13:** 8 teams alive | Roster 14 (2 QB, 3 RB, 3 WR, 1 TE, 3 FLX, 2 Bench)
  * **Week 14:** 7 teams alive | Roster 15 (2 QB, 3 RB, 3 WR, 2 TE, 3 FLX, 2 Bench)
  * **Week 15:** 6 teams alive | Roster 15 (2 QB, 3 RB, 3 WR, 2 TE, 3 FLX, 2 Bench)
  * **Week 16:** 5 teams alive | Roster 16 (2 QB, 3 RB, 3 WR, 2 TE, 4 FLX, 2 Bench)
  * **Week 17:** 4 teams alive | Roster 16 (2 QB, 3 RB, 3 WR, 2 TE, 4 FLX, 2 Bench) — Final Week!

### Rolling Two-Week Scoring & Eliminations
* **Elimination Metric:** Every team's elimination score is their **rolling two-week cumulative sum** (e.g., Week 2 Score = W1 + W2; Week 3 = W2 + W3; Week 4 = W3 + W4).
* **Elimination Schedule (Chop Counts):**
  * **Weeks 2–6:** Bottom **2 teams** eliminated each week (10 teams cut across W2–W6).
  * **Weeks 7–16:** Bottom **1 team** eliminated each week (10 teams cut across W7–W16).
  * **Week 17:** Final 4 teams compete. No cuts; final rolling scores determine 1st, 2nd, and 3rd place cash finishers.
* **Roster Drops:** When a team is eliminated, all rostered players are cleared to free agency (`C=MANDROP` on MFL) for Wednesday waivers. An eliminated team therefore has **0 players** on its MFL roster; use that (MFL `rosters` export) to confirm who is eliminated.

### FAAB & Waiver Rules
* **Budget:** $200 starting FAAB.
* **Schedule:** Daily blind bidding Wed–Sun at 11:00 AM ET; 1-day lock on dropped players.
* **FCFS:** $0 minimum bid; First-Come First-Served pickups cost $0 FAAB after waivers run.
* **Blind Bid Tiebreaker Criteria:**
  1. *Tiebreaker #1:* Last Week's Point Total
  2. *Tiebreaker #2:* Total Points Scored (sorted worst to best)
* **Trades:** No trades permitted.

### Scoring Rules
* **Passing:** 4 pts per TD, 0.03 pts/yd, -2 per INT, 1 pt per 2-pt conversion.
* **Rushing:** 6 pts per TD, 0.1 pts/yd, 0.25 pts per rush attempt, 2 pts per 2-pt conversion.
* **Receiving & PPR Breakdown:**
  * *RB & QB:* 1.0 PPR (0.1 pts/yd, 1.0 pt/rec).
  * *WR:* 1.5 PPR (0.1 pts/yd, 1.5 pts/rec) + **3-pt bonus** for 100+ receiving yards.
  * *TE:* 2.0 PPR (2.0 pts/rec; 0.4 pts/yd for yds 1–20, 0.1 pts/yd for yds 21+).
* **Fumbles:** -2 pts per fumble lost.

### Prize Distribution
* **Weekly High-Score Prizes (Single-Week Output Only):**
  * *Weeks 1–4:* $10 FAAB bonus
  * *Weeks 5–8:* $15 cash
  * *Weeks 9–12:* $30 cash
  * *Weeks 13–16:* $50 cash
* **End-of-Season Cash Finishes (Week 17 Totals):**
  * *1st Place:* $450
  * *2nd Place:* $200
  * *3rd Place:* $85
