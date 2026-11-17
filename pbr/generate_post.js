// Gemmy weekly recap: builds a recap of the latest played week with Gemini,
// saves it to data.json (weekly_data[week].recap, shown on the dashboard) and posts it to Slack #officialcomms.
//
// Usage: node generate_post.js [week] ["extra directive"]
// GEMMY_MODE:
//   auto     (default) generate, post to Slack, save to data.json
//   draft    generate into gemmy_drafts/week_<N>.md only. Edit that file, then publish.
//   publish  post gemmy_drafts/week_<N>.md exactly as written, save to data.json, delete the draft
// Env:
//   GEMINI_API_KEY (required to generate)
//   GEMINI_MODEL   comma-separated models to try first; then the newest flash models the key lists
//                  (gemini_models.js). GEMINI_TIMEOUT_MS per try
//   SLACK_BOT_TOKEN + PBR_SLACK_CHANNEL_OFFICIALCOMMS, falling back to SLACK_WEBHOOK_URL
//   PBR_SLACK_CHANNEL_GENERAL / _RANDOM / _TRADE_TALK  read for banter
//   GEMMY_SLACK=0   auto/publish save to data.json without posting to Slack
//   GEMMY_FORCE=1   auto/publish even if this week already has a recap
//   GEMMY_NOTES     extra instruction for Gemmy (same as the second argument)
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { modelCandidates } = require('./gemini_models.js');
const { recentTransactions, nextYearFirstRoundOwners } = require('./recent_transactions.js');
const { addMentions, withChannelHeader, teamNamesFrom } = require('./slack_mentions.js');
const { postToOfficialComms } = require('./slack_post.js');

const dataPath = path.join(__dirname, 'data.json');
const draftsDir = path.join(__dirname, 'gemmy_drafts');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 90000);
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const MODE = process.env.GEMMY_MODE || 'auto';
const POST_TO_SLACK = process.env.GEMMY_SLACK !== '0';
const FORCE = process.env.GEMMY_FORCE === '1';
// Channel ID → the secret it came from, so a log names the channel without printing its ID.
const BANTER_CHANNELS = new Map(
  ['PBR_SLACK_CHANNEL_OFFICIALCOMMS', 'PBR_SLACK_CHANNEL_GENERAL', 'PBR_SLACK_CHANNEL_RANDOM', 'PBR_SLACK_CHANNEL_TRADE_TALK']
    .filter(name => process.env[name])
    .map(name => [process.env[name], name])
);
const BANTER_DAYS = 7;

const DIVISION_NAMES = { '00': 'Upper Division', '01': 'Middle Division', '02': 'Lower Division' };

// Gemini writes Markdown; Slack (and the dashboard's parser) use single-asterisk bold and no headings.
function toSlackMrkdwn(text) {
  return (text || '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^#{1,6}\s*(.+)$/gm, '*$1*')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function slackApi(method, params) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(params)
  });
  return res.json();
}

async function fetchSlackBanter() {
  if (!SLACK_BOT_TOKEN || BANTER_CHANNELS.size === 0) return [];
  const oldest = String(Math.floor(Date.now() / 1000) - BANTER_DAYS * 86400);
  const messages = [];
  for (const [channel, secret] of BANTER_CHANNELS) {
    try {
      const data = await slackApi('conversations.history', { channel, oldest, limit: 40 });
      if (!data.ok) {
        // channel_not_found / not_in_channel: wrong ID in the secret, or the bot isn't in that channel.
        console.warn(`⚠️ Slack history for ${secret} failed: ${data.error}`);
        continue;
      }
      data.messages
        .filter(m => !m.subtype && !m.bot_id && m.text)
        .forEach(m => messages.push({ user: m.user, text: m.text.slice(0, 300), ts: Number(m.ts) }));
    } catch (e) {
      console.warn(`⚠️ Slack history for ${secret} failed: ${e.message}`);
    }
  }
  // Swap user IDs for display names so Gemmy can roast people by name.
  const names = {};
  for (const id of new Set(messages.map(m => m.user).filter(Boolean))) {
    try {
      const info = await slackApi('users.info', { user: id });
      if (info.ok) names[id] = info.user.profile?.display_name || info.user.real_name || id;
    } catch (e) { /* keep the ID */ }
  }
  return messages
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 40)
    .map(m => `${names[m.user] || m.user || 'someone'}: ${m.text}`);
}

function latestPlayedWeek(pbrData) {
  const played = Object.values(pbrData.weekly_data || {}).filter(w => w.played).map(w => Number(w.week));
  return played.length ? Math.max(...played) : null;
}

// Weeks 9-11: the last quarter before the postseason, where each division's stakes differ (see buildPrompt).
const isFinalQuarterStretch = (quarter, weekOfQuarter) => quarter === 3 && weekOfQuarter < 4;

// 1 = best in the division.
const rankIn = (values, v) => values.filter(x => x > v).length + 1;

// What the team's full Potential Points would have won that its actual score didn't:
// H2H losses where PP beat the opponent's score, and a missed top-2 where PP beat the division's 2nd-best other score.
function winsLeftOnBench(team, divisionTeams, matchups) {
  const missed = [];
  for (const m of matchups) {
    const [me, opp] = m.team1.id === team.id ? [m.team1, m.team2] : m.team2.id === team.id ? [m.team2, m.team1] : [];
    if (me && me.score < opp.score && team.pp > opp.score) missed.push(`H2H win vs ${opp.name}`);
  }
  const others = divisionTeams.filter(t => t.id !== team.id).map(t => t.score).sort((a, b) => b - a);
  if (!team.battle_vp && others.length >= 2 && team.pp > others[1]) missed.push('in-division top-2 VP');
  return missed;
}

// A compact summary of the week, so the prompt stays well inside free-tier token limits.
// firstRoundOwners (optional): { originalFid: ownerFid } for next year's 1st-round picks.
function buildWeekSummary(pbrData, weekNum, firstRoundOwners = null) {
  const w = pbrData.weekly_data[String(weekNum)];
  const next = pbrData.weekly_data[String(weekNum + 1)];
  const round = n => (n == null ? null : Math.round(n * 100) / 100);

  const allScores = Object.values(w.battle_royale).flat();
  const high = allScores.reduce((a, b) => (b.score > a.score ? b : a));
  const low = allScores.reduce((a, b) => (b.score < a.score ? b : a));
  const nameOf = id => allScores.find(t => t.id === id)?.name || id;
  const weekOfQuarter = ((weekNum - 1) % 4) + 1;

  const summary = {
    week: weekNum,
    quarter: w.quarter,
    week_of_quarter: weekOfQuarter,
    weekly_high_score: { team: high.name, score: high.score, prize: '$10' },
    weekly_low_score: { team: low.name, score: low.score },
    head_to_head: w.matchups.map(m => `${m.team1.name} ${m.team1.score} vs ${m.team2.name} ${m.team2.score}`),
    division_battle_royale: Object.fromEntries(Object.entries(w.battle_royale).map(([div, teams]) => {
      const scores = teams.map(t => t.score);
      const pps = teams.map(t => t.pp);
      return [div, teams.map(t => {
        const missed = winsLeftOnBench(t, teams, w.matchups);
        return {
          team: t.name,
          score: t.score,
          score_rank_in_division: rankIn(scores, t.score),
          potential: round(t.pp),
          potential_rank_in_division: rankIn(pps, t.pp),
          bench_points_left: round(t.pp - t.score),
          top2_vp: t.battle_vp,
          ...(missed.length ? { wins_left_on_bench: missed } : {})
        };
      })];
    })),
    quarter_standings: Object.fromEntries(Object.entries(w.quarter_standings).map(([div, teams]) => [
      div,
      teams.map(t => ({ team: t.name, vp: t.vp, record: `${t.wins}-${t.losses}-${t.ties}`, pf: round(t.pf), potential_points: round(t.pp) }))
    ]))
  };

  if (isFinalQuarterStretch(w.quarter, weekOfQuarter)) {
    const byDiv = code => Object.values(w.quarter_standings).find(teams => teams[0]?.division === code) || [];
    // Relegation after Week 12 = lowest quarter PP in Upper and Middle (the Middle leader is being promoted, so is exempt).
    const relegationWatch = code => {
      const teams = byDiv(code);
      const leaderId = code === '01' ? [...teams].sort((a, b) => b.vp - a.vp || b.pf - a.pf)[0]?.id : null;
      const sorted = teams.filter(t => t.id !== leaderId).sort((a, b) => a.pp - b.pp);
      return sorted.map((t, i) => ({
        team: t.name,
        quarter_pp: round(t.pp),
        ...(i === 0 ? { status: 'IN THE RELEGATION SPOT', pp_short_of_safety: round(sorted[1] ? sorted[1].pp - t.pp : 0) } : { pp_cushion_over_relegation_spot: round(t.pp - sorted[0].pp) })
      }));
    };
    const promotionRace = code => {
      const teams = [...byDiv(code)].sort((a, b) => b.vp - a.vp || b.pf - a.pf);
      return teams.map(t => ({ team: t.name, vp: t.vp, vp_behind_leader: teams[0].vp - t.vp }));
    };
    summary.final_quarter_stakes = {
      weeks_left_before_postseason_divisions_lock: 12 - weekNum,
      upper_relegation_watch: relegationWatch('00'),
      middle_promotion_race: promotionRace('01'),
      middle_relegation_watch: relegationWatch('01'),
      lower_promotion_race: promotionRace('02')
    };
    if (firstRoundOwners) {
      summary.final_quarter_stakes.lower_division_next_year_first = byDiv('02').map(t => {
        const owner = firstRoundOwners[t.id];
        return { team: t.name, owns_own_next_year_1st: owner === t.id, ...(owner && owner !== t.id ? { owned_by: nameOf(owner) } : {}) };
      });
    }
  }

  // Weeks 4/8/12: the fetcher has already applied P&R to next week's divisions.
  if (weekNum % 4 === 0 && next) {
    const moves = [];
    Object.entries(next.active_divisions).forEach(([id, div]) => {
      const before = w.active_divisions[id];
      if (before !== div) {
        const name = allScores.find(t => t.id === id)?.name || id;
        moves.push(`${name}: ${DIVISION_NAMES[before]} -> ${DIVISION_NAMES[div]} (${div < before ? 'PROMOTED' : 'RELEGATED'})`);
      }
    });
    summary.promotion_relegation = moves;
  }
  return summary;
}

// Last BANTER_DAYS of MFL transactions (recent_transactions.js). A failed fetch only costs the section.
async function fetchTransactions() {
  try {
    return await recentTransactions(BANTER_DAYS);
  } catch (e) {
    console.warn(`⚠️ MFL transactions fetch failed: ${e.message}`);
    return [];
  }
}

// Weeks 9-11 only: who owns each team's next-year 1st (for the Lower Division's 1.01 race). A failed fetch only drops that field.
async function fetchFirstRoundOwners() {
  try {
    return await nextYearFirstRoundOwners();
  } catch (e) {
    console.warn(`⚠️ MFL futureDraftPicks fetch failed: ${e.message}`);
    return null;
  }
}

function buildPrompt(summary, banter, extraDirective, transactions = []) {
  const { week, quarter, week_of_quarter } = summary;
  const isQuarterEnd = week_of_quarter === 4;
  const finalStretch = isFinalQuarterStretch(quarter, week_of_quarter);

  const focus = isQuarterEnd
    ? `This is Week ${week}, the END of Quarter ${quarter}. Promotion & Relegation is the headline: celebrate the promoted division winners and roast the relegated teams (relegation is decided by lowest Potential Points, i.e. the shallowest, thinnest roster).`
    : finalStretch
      ? `Week ${week} is in Quarter 3, the LAST quarter before the postseason${week_of_quarter === 1 ? ' (VP reset to 0 this week)' : ''}. The divisions teams finish in after Week 12 are the divisions they play the postseason in, so each division has different stakes. Write each division's section around ITS stakes (see FINAL-QUARTER STAKES below), using final_quarter_stakes in the data.`
      : week_of_quarter >= 2
        ? `Week ${week} is past the halfway mark of Quarter ${quarter}. Turn up the heat on relegation candidates: the lowest Potential Points in the Upper and Middle divisions, and who is chasing promotion in Middle and Lower.`
        : `Week ${week} opens Quarter ${quarter}. Everyone's VP was reset to 0, so set the tone for the new quarter's race.`;

  // Weeks 9-11: what each division is actually playing for, and what matters most in each.
  const finalStakes = finalStretch ? [
    '',
    'FINAL-QUARTER STAKES (Weeks 9-11; lead each division section with its stakes, in this priority order):',
    '- UPPER DIVISION: the only division that plays for the Season Champion title ($200) in the postseason, so staying up is everything. Headline: relegation. The team in the relegation spot (lowest quarter PP, see upper_relegation_watch) is about to get kicked out of the title race and forfeit next year\'s 3rd-round pick; name how far short of safety it is and who is barely hanging on. Next: this week\'s single-game showings against the division (score_rank_in_division, potential_rank_in_division), praising whoever topped the division and roasting whoever finished last, especially a bottom PP that drags them toward relegation. Points left on the bench rank BELOW all of that: mention them briefly at most, never as an Upper team\'s main story.',
    '- MIDDLE DIVISION: the last chance to climb into the Upper Division (and the title race) before the postseason. Only the VP leader goes up, so wins and VP are the story: the promotion race (middle_promotion_race, vp_behind_leader) and who gained or lost ground this week. Here bench points DO hurt when they cost a win: call out every wins_left_on_bench entry for a Middle team (an H2H loss or a missed top-2 VP the bench would have won) as VP thrown away in a promotion race. The relegation spot (middle_relegation_watch) is a secondary threat: it drops a team to the Lower Division and costs next year\'s 3rd-round pick.',
    '- LOWER DIVISION: these teams can\'t reach the title, so their trophy is the Lower Division postseason, whose winner gets next season\'s 1.01 pick (only worth it if they own their own 1st; see lower_division_next_year_first, and roast anyone fighting for a 1.01 another team owns). The smart play is to get better for the future (trading veterans for future picks and young talent) while staying strong enough to win the Lower postseason. Judge their trades and waiver moves on that: a smart sell-off for picks, or gutting the roster so far they can\'t compete for 1.01. Note that winning the Lower quarter promotes a team to the Middle Division (+5 tokens) but takes it out of the 1.01 race (Middle postseason picks are x.05-x.08). Bench points matter little here.',
    '- Week 12 decides it all, so frame this week as building toward that.'
  ] : [];

  return [
    'You are Gemmy, the official snarky AI mascot of the PBR (Premier Battle Royale) dynasty fantasy football league.',
    '',
    'LEAGUE RULES:',
    '- 12 teams in 3 divisions of 4 (Upper, Middle, Lower). Superflex, 10 starters.',
    '- Each week a team earns up to 3 Victory Points (VP): 1 per win in its two head-to-head games against teams from the other divisions, plus 1 VP if it has a top-2 score in its own division (the "Battle Royale").',
    '- Quarters are Weeks 1-4, 5-8, 9-12. VP, PF, PP and W-L-T reset each quarter.',
    '- After Weeks 4, 8 and 12: the 1st-place (most VP) team in Middle and Lower is promoted; the lowest Potential Points team in Upper and Middle is relegated.',
    '- Potential Points (PP) is what the best possible lineup from the whole roster would have scored. Low PP means a shallow roster with no depth (injuries and bye weeks drag it down too). It has NOTHING to do with how well a manager set the lineup, so never blame low PP or relegation on bad lineup decisions. Lineup blunders are bench_points_left (potential minus actual score), a separate thing.',
    '- Weekly high score wins $10.',
    '',
    'WRITE a hilarious, ruthless weekly recap for Slack:',
    `- ${focus}`,
    finalStretch
      ? '- Cover only the noteworthy stuff: blowouts, nail-biters, the high and low scores, the relegation and promotion races. Skip filler.'
      : '- Cover only the noteworthy stuff: blowouts, nail-biters, the high and low scores, big points left on the bench, the standings race. Skip filler.',
    '- Weave in the Slack banter below and roast managers by name for their trash talk and excuses.',
    '- Use the recent transactions below for observations: who won or got fleeced in a trade, desperate or overpriced waiver bids, panic drops, a team hoarding QBs, a roster turning into an injury ward. Tie moves to this week\'s results or the standings race where they fit (a contender buying, a relegation candidate selling, a player cut right before he went off). Pick the 2-4 juiciest moves; skip routine ones.',
    '- Use only the numbers, players and moves given. Do not invent scores, players or trades.',
    '- Slack formatting: *bold* with single asterisks, _italics_, short paragraphs and bullet lines starting with •. No # headings, no tables. Keep it under 2,500 characters.',
    `- Layout: open with a title line like "🎙️ *GEMMY'S WEEKLY DISPATCH: WEEK ${week} RECAP* 🎙️". Each section header is a bold line with a fitting emoji at each end (e.g. "👑 *UPPER DIVISION: ...* 🔪"). Drop a funny emoji on most punchlines (🤑 🗑️ 🪦 🍿 👻 🍼), not just at the end.`,
    '- Write emojis as Unicode characters, not :shortcodes:.',
    extraDirective ? `- Extra instruction from the commissioner: ${extraDirective}` : null,
    ...finalStakes,
    '',
    `WEEK ${week} DATA: ${JSON.stringify(summary)}`,
    '',
    `RECENT TRANSACTIONS (MFL, last ${BANTER_DAYS} days; trades first, then waiver claims with FAAB bids, free-agent moves, IR moves; newest first in each):`,
    transactions.length ? transactions.join('\n') : '(no transactions this week)',
    '',
    `SLACK BANTER (last ${BANTER_DAYS} days, newest first):`,
    banter.length ? banter.join('\n') : '(quiet week, nobody said anything)'
  ].filter(line => line !== null).join('\n');
}

// Tries each model in order, with a timeout per try, so one slow, overloaded or retired model doesn't sink the run.
async function generateWithGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY environment variable missing');
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const models = await modelCandidates(GEMINI_API_KEY);
  console.log(`Gemini models to try: ${models.join(', ')}.`);
  for (const name of models) {
    const started = Date.now();
    try {
      const model = genAI.getGenerativeModel({ model: name }, { timeout: GEMINI_TIMEOUT_MS });
      const result = await model.generateContent(prompt);
      const text = toSlackMrkdwn(result.response.text());
      if (!text) throw new Error('empty response');
      console.log(`Gemini ${name} answered in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
      return text;
    } catch (err) {
      console.warn(`⚠️ Gemini ${name} failed after ${((Date.now() - started) / 1000).toFixed(1)}s: ${err.message}`);
    }
  }
  throw new Error(`No Gemini model produced a recap (tried ${models.join(', ')})`);
}

async function publish(pbrData, weekObj, weekNum, recap) {
  // Post first, save second: a failed post leaves no recap, so a rerun tries again.
  if (POST_TO_SLACK) {
    // @channel, the dashboard link and owner @mentions go only into the Slack copy; data.json (the dashboard) keeps the plain recap.
    const via = await postToOfficialComms(withChannelHeader(addMentions(recap, teamNamesFrom(pbrData)), `Week ${weekNum} results & standings on the PBR dashboard`));
    if (!via) throw new Error('Could not post to Slack (no working bot token/channel or webhook)');
    console.log(`Posted to Slack via ${via}.`);
  } else {
    console.log('GEMMY_SLACK=0: not posting to Slack.');
  }
  weekObj.recap = recap;
  fs.writeFileSync(dataPath, JSON.stringify(pbrData, null, 2));
  console.log(`Saved recap to data.json weekly_data["${weekNum}"].recap.`);
}

async function generatePost() {
  if (!['auto', 'draft', 'publish'].includes(MODE)) throw new Error(`Unknown GEMMY_MODE "${MODE}" (auto, draft, publish)`);

  const pbrData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const [weekArg, ...rest] = process.argv.slice(2).filter(a => a.trim() !== '');
  const weekNum = weekArg ? Number(weekArg) : latestPlayedWeek(pbrData);
  const weekObj = pbrData.weekly_data?.[String(weekNum)];
  if (!weekObj || !weekObj.played) throw new Error(`Week ${weekNum} has not been played (or is missing from data.json)`);
  const draftPath = path.join(draftsDir, `week_${weekNum}.md`);

  if (MODE !== 'draft' && weekObj.recap && !FORCE) {
    console.log(`Week ${weekNum} already has a recap. Skipping (set GEMMY_FORCE=1 to post it again).`);
    return;
  }

  if (MODE === 'publish') {
    if (!fs.existsSync(draftPath)) throw new Error(`No draft at gemmy_drafts/week_${weekNum}.md. Run with GEMMY_MODE=draft first.`);
    const recap = fs.readFileSync(draftPath, 'utf8').trim();
    if (!recap) throw new Error(`gemmy_drafts/week_${weekNum}.md is empty`);
    console.log(`Publishing gemmy_drafts/week_${weekNum}.md:\n\n${recap}\n`);
    await publish(pbrData, weekObj, weekNum, recap);
    fs.unlinkSync(draftPath);
    return;
  }

  const banter = await fetchSlackBanter();
  const transactions = await fetchTransactions();
  const firstRoundOwners = isFinalQuarterStretch(weekObj.quarter, ((weekNum - 1) % 4) + 1) ? await fetchFirstRoundOwners() : null;
  console.log(`Week ${weekNum}: ${banter.length} Slack banter messages, ${transactions.length} MFL transactions.`);
  const prompt = buildPrompt(buildWeekSummary(pbrData, weekNum, firstRoundOwners), banter, rest.join(' ') || process.env.GEMMY_NOTES || '', transactions);
  const recap = await generateWithGemini(prompt);
  console.log(`\n${recap}\n`);

  if (MODE === 'draft') {
    fs.mkdirSync(draftsDir, { recursive: true });
    fs.writeFileSync(draftPath, recap + '\n');
    console.log(`Draft saved to gemmy_drafts/week_${weekNum}.md. Edit it, then run with GEMMY_MODE=publish.`);
    return;
  }
  await publish(pbrData, weekObj, weekNum, recap);
}

if (require.main === module) {
  generatePost().catch(err => {
    console.error('❌ Gemmy recap failed:', err.message);
    process.exit(1);
  });
}

module.exports = { buildWeekSummary, buildPrompt, latestPlayedWeek };
