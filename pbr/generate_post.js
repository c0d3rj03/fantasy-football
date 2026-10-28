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

const dataPath = path.join(__dirname, 'data.json');
const draftsDir = path.join(__dirname, 'gemmy_drafts');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 90000);
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_OFFICIALCOMMS = process.env.PBR_SLACK_CHANNEL_OFFICIALCOMMS;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
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
  console.log(`Week ${weekNum}: ${banter.length} Slack banter messages.`);
  const prompt = buildPrompt(buildWeekSummary(pbrData, weekNum), banter, rest.join(' ') || process.env.GEMMY_NOTES || '');
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
