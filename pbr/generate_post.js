// Gemmy weekly recap: builds a recap of the latest played week with Gemini,
// saves it to data.json (weekly_data[week].recap, shown on the dashboard) and posts it to Slack #officialcomms.
//
// Usage: node generate_post.js [week] ["extra directive"]
// Env:
//   GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-2.5-flash)
//   SLACK_BOT_TOKEN + PBR_SLACK_CHANNEL_OFFICIALCOMMS, falling back to SLACK_WEBHOOK_URL
//   PBR_SLACK_CHANNEL_GENERAL / _RANDOM / _TRADE_TALK  read for banter
//   GEMMY_SLACK=0   generate and save, but don't post to Slack
//   GEMMY_FORCE=1   regenerate even if this week already has a recap
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const dataPath = path.join(__dirname, 'data.json');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_OFFICIALCOMMS = process.env.PBR_SLACK_CHANNEL_OFFICIALCOMMS;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const POST_TO_SLACK = process.env.GEMMY_SLACK !== '0';
const FORCE = process.env.GEMMY_FORCE === '1';
const BANTER_CHANNELS = [
  process.env.PBR_SLACK_CHANNEL_OFFICIALCOMMS,
  process.env.PBR_SLACK_CHANNEL_GENERAL,
  process.env.PBR_SLACK_CHANNEL_RANDOM,
  process.env.PBR_SLACK_CHANNEL_TRADE_TALK
].filter(Boolean);
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
  if (!SLACK_BOT_TOKEN || BANTER_CHANNELS.length === 0) return [];
  const oldest = String(Math.floor(Date.now() / 1000) - BANTER_DAYS * 86400);
  const messages = [];
  for (const channel of new Set(BANTER_CHANNELS)) {
    try {
      const data = await slackApi('conversations.history', { channel, oldest, limit: 40 });
      if (!data.ok) {
        console.warn(`⚠️ Slack history for ${channel} failed: ${data.error}`);
        continue;
      }
      data.messages
        .filter(m => !m.subtype && !m.bot_id && m.text)
        .forEach(m => messages.push({ user: m.user, text: m.text.slice(0, 300), ts: Number(m.ts) }));
    } catch (e) {
      console.warn(`⚠️ Slack history for ${channel} failed: ${e.message}`);
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

async function postToSlack(text) {
  if (SLACK_BOT_TOKEN && SLACK_CHANNEL_OFFICIALCOMMS) {
    try {
      const data = await slackApi('chat.postMessage', { channel: SLACK_CHANNEL_OFFICIALCOMMS, text, mrkdwn: true });
      if (data.ok) return 'bot';
      console.warn(`⚠️ Slack chat.postMessage failed: ${data.error}`);
    } catch (e) {
      console.warn(`⚠️ Slack chat.postMessage failed: ${e.message}`);
    }
  }
  if (SLACK_WEBHOOK_URL) {
    const res = await fetch(SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (res.ok) return 'webhook';
    console.warn(`⚠️ Slack webhook failed: HTTP ${res.status}`);
  }
  return null;
}

function latestPlayedWeek(pbrData) {
  const played = Object.values(pbrData.weekly_data || {}).filter(w => w.played).map(w => Number(w.week));
  return played.length ? Math.max(...played) : null;
}

// A compact summary of the week, so the prompt stays well inside free-tier token limits.
function buildWeekSummary(pbrData, weekNum) {
  const w = pbrData.weekly_data[String(weekNum)];
  const next = pbrData.weekly_data[String(weekNum + 1)];
  const round = n => (n == null ? null : Math.round(n * 100) / 100);

  const allScores = Object.values(w.battle_royale).flat();
  const high = allScores.reduce((a, b) => (b.score > a.score ? b : a));
  const low = allScores.reduce((a, b) => (b.score < a.score ? b : a));

  const summary = {
    week: weekNum,
    quarter: w.quarter,
    week_of_quarter: ((weekNum - 1) % 4) + 1,
    weekly_high_score: { team: high.name, score: high.score, prize: '$10' },
    weekly_low_score: { team: low.name, score: low.score },
    head_to_head: w.matchups.map(m => `${m.team1.name} ${m.team1.score} vs ${m.team2.name} ${m.team2.score}`),
    division_battle_royale: Object.fromEntries(Object.entries(w.battle_royale).map(([div, teams]) => [
      div,
      teams.map(t => ({ team: t.name, score: t.score, potential: round(t.pp), bench_points_left: round(t.pp - t.score), top2_vp: t.battle_vp }))
    ])),
    quarter_standings: Object.fromEntries(Object.entries(w.quarter_standings).map(([div, teams]) => [
      div,
      teams.map(t => ({ team: t.name, vp: t.vp, record: `${t.wins}-${t.losses}-${t.ties}`, pf: round(t.pf), potential_points: round(t.pp) }))
    ]))
  };

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

function buildPrompt(summary, banter, extraDirective) {
  const { week, quarter, week_of_quarter } = summary;
  const isQuarterEnd = week_of_quarter === 4;

  const focus = isQuarterEnd
    ? `This is Week ${week}, the END of Quarter ${quarter}. Promotion & Relegation is the headline: celebrate the promoted division winners and roast the relegated teams (relegation is decided by lowest Potential Points, i.e. bad lineup-setting).`
    : week_of_quarter >= 2
      ? `Week ${week} is past the halfway mark of Quarter ${quarter}. Turn up the heat on relegation candidates: the lowest Potential Points in the Upper and Middle divisions, and who is chasing promotion in Middle and Lower.`
      : `Week ${week} opens Quarter ${quarter}. Everyone's VP was reset to 0, so set the tone for the new quarter's race.`;

  return [
    'You are Gemmy, the official snarky AI mascot of the PBR (Premier Battle Royale) dynasty fantasy football league.',
    '',
    'LEAGUE RULES:',
    '- 12 teams in 3 divisions of 4 (Upper, Middle, Lower). Superflex, 10 starters.',
    '- Each week a team earns up to 3 Victory Points (VP): 1 per win in its two head-to-head games against teams from the other divisions, plus 1 VP if it has a top-2 score in its own division (the "Battle Royale").',
    '- Quarters are Weeks 1-4, 5-8, 9-12. VP, PF, PP and W-L-T reset each quarter.',
    '- After Weeks 4, 8 and 12: the 1st-place (most VP) team in Middle and Lower is promoted; the lowest Potential Points team in Upper and Middle is relegated.',
    '- Weekly high score wins $10.',
    '',
    'WRITE a hilarious, ruthless weekly recap for Slack:',
    `- ${focus}`,
    '- Cover only the noteworthy stuff: blowouts, nail-biters, the high and low scores, big points left on the bench, the standings race. Skip filler.',
    '- Weave in the Slack banter below and roast managers by name for their trash talk and excuses.',
    '- Use only the numbers given. Do not invent scores, players or trades.',
    '- Slack formatting: *bold* with single asterisks, _italics_, emojis, short paragraphs and bullet lines starting with •. No # headings, no tables. Keep it under 2,500 characters.',
    extraDirective ? `- Extra instruction from the commissioner: ${extraDirective}` : null,
    '',
    `WEEK ${week} DATA: ${JSON.stringify(summary)}`,
    '',
    `SLACK BANTER (last ${BANTER_DAYS} days, newest first):`,
    banter.length ? banter.join('\n') : '(quiet week, nobody said anything)'
  ].filter(line => line !== null).join('\n');
}

async function generatePost() {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY environment variable missing');

  const pbrData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const [weekArg, ...rest] = process.argv.slice(2);
  const weekNum = weekArg ? Number(weekArg) : latestPlayedWeek(pbrData);
  const weekObj = pbrData.weekly_data?.[String(weekNum)];
  if (!weekObj || !weekObj.played) throw new Error(`Week ${weekNum} has not been played (or is missing from data.json)`);

  if (weekObj.recap && !FORCE) {
    console.log(`Week ${weekNum} already has a recap. Skipping (set GEMMY_FORCE=1 to regenerate and repost).`);
    return;
  }

  const banter = await fetchSlackBanter();
  console.log(`Week ${weekNum}: ${banter.length} Slack banter messages, model ${GEMINI_MODEL}.`);
  const prompt = buildPrompt(buildWeekSummary(pbrData, weekNum), banter, rest.join(' '));

  const model = new GoogleGenerativeAI(GEMINI_API_KEY).getGenerativeModel({ model: GEMINI_MODEL });
  const result = await model.generateContent(prompt);
  const recap = toSlackMrkdwn(result.response.text());
  if (!recap) throw new Error('Gemini returned an empty recap');
  console.log(`\n${recap}\n`);

  // Post first, save second: a failed post leaves no recap, so a rerun tries again.
  if (POST_TO_SLACK) {
    const via = await postToSlack(recap);
    if (!via) throw new Error('Could not post to Slack (no working bot token/channel or webhook)');
    console.log(`Posted to Slack via ${via}.`);
  } else {
    console.log('GEMMY_SLACK=0: not posting to Slack.');
  }

  weekObj.recap = recap;
  fs.writeFileSync(dataPath, JSON.stringify(pbrData, null, 2));
  console.log(`Saved recap to data.json weekly_data["${weekNum}"].recap.`);
}

generatePost().catch(err => {
  console.error('❌ Gemmy recap failed:', err.message);
  process.exit(1);
});
