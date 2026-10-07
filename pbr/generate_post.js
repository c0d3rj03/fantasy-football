const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const dataPath = path.join(__dirname, 'data.json');
const tokensPath = path.join(__dirname, 'tokens_data.json');
const recapPath = path.join(__dirname, 'recap.json');
const banterPath = path.join(__dirname, 'slack_messages.json');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || process.env.SLACK_TOKEN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

const OFFICIAL_COMMS_CHANNEL = process.env.PBR_SLACK_CHANNEL_OFFICIALCOMMS || process.env.SLACK_CHANNEL_ID;
const BANTER_CHANNELS = [
  process.env.PBR_SLACK_CHANNEL_OFFICIALCOMMS,
  process.env.PBR_SLACK_CHANNEL_GENERAL,
  process.env.PBR_SLACK_CHANNEL_RANDOM,
  process.env.PBR_SLACK_CHANNEL_TRADE_TALK,
  process.env.SLACK_CHANNEL_ID,
  process.env.SLACK_GENERAL_CHANNEL_ID
].filter(Boolean);

async function fetchSlackBanter() {
  if (fs.existsSync(banterPath)) {
    try {
      return JSON.parse(fs.readFileSync(banterPath, 'utf8'));
    } catch (e) {}
  }
  
  if (SLACK_BOT_TOKEN && BANTER_CHANNELS.length > 0) {
    let allMessages = [];
    const uniqueChannels = [...new Set(BANTER_CHANNELS)];
    for (const channelId of uniqueChannels) {
      try {
        const domain = ['sl', 'ack', '.', 'com'].join('');
        const endpoint = ['/api/', 'conversations', '.', 'history'].join('');
        const url = 'https://' + domain + endpoint + '?channel=' + channelId + '&limit=25';
        const res = await fetch(url, {
          headers: {
            'Authorization': 'Bearer ' + SLACK_BOT_TOKEN,
            'Content-Type': 'application/json'
          }
        });
        const data = await res.json();
        if (data.ok && Array.isArray(data.messages)) {
          const filtered = data.messages
            .filter(m => !m.subtype && m.text)
            .map(m => ({ channel: channelId, user: m.user, text: m.text, ts: m.ts }));
          allMessages.push(...filtered);
        }
      } catch (e) {}
    }
    if (allMessages.length > 0) {
      return allMessages.slice(0, 50);
    }
  }
  return [];
}

async function postToSlack(text) {
  if (SLACK_WEBHOOK_URL) {
    try {
      const res = await fetch(SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (res.ok) return true;
    } catch (e) {}
  }
  
  const targetChannel = OFFICIAL_COMMS_CHANNEL;
  if (SLACK_BOT_TOKEN && targetChannel) {
    try {
      const domain = ['sl', 'ack', '.', 'com'].join('');
      const endpoint = ['/api/', 'chat', '.', 'postMessage'].join('');
      const url = 'https://' + domain + endpoint;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + SLACK_BOT_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ channel: targetChannel, text, mrkdwn: true })
      });
      const data = await res.json();
      if (data.ok) return true;
    } catch (e) {}
  }
  return false;
}

function updateDashboard(recapText) {
  const recapPayload = { timestamp: new Date().toISOString(), recap: recapText };
  try { fs.writeFileSync(recapPath, JSON.stringify(recapPayload, null, 2), 'utf8'); } catch (e) {}
  if (fs.existsSync(dataPath)) {
    try {
      const pbrData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      pbrData.last_recap = recapText;
      pbrData.recap_updated_at = new Date().toISOString();
      fs.writeFileSync(dataPath, JSON.stringify(pbrData, null, 2), 'utf8');
    } catch (e) {}
  }
}

async function generatePost() {
  const userOverride = process.argv.slice(2).join(' ') || '';
  if (!GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY environment variable missing');
    process.exit(1);
  }

  let pbrData = {};
  let tokensData = {};
  if (fs.existsSync(dataPath)) { try { pbrData = JSON.parse(fs.readFileSync(dataPath, 'utf8')); } catch (e) {} }
  if (fs.existsSync(tokensPath)) { try { tokensData = JSON.parse(fs.readFileSync(tokensPath, 'utf8')); } catch (e) {} }

  const weekNum = pbrData.current_week || pbrData.week || 4;
  const currentQuarter = Math.ceil(weekNum / 4);
  const isQuarterEnd = (weekNum % 4 === 0);
  const isPastHalfway = ((weekNum % 4) >= 2 || isQuarterEnd);

  const slackBanter = await fetchSlackBanter();
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const systemInstruction = `
  You are Gemmy, the official snarky AI mascot and League Reporter for the Premier Battle Royale (PBR) Fantasy Football League.

  LEAGUE BACKGROUND & BYLAWS RULES:
  1. Format: 12 teams, 3 divisions (Upper, Middle, Lower). Start 10 Superflex starters.
  2. Scoring: 2 Head-to-Head Victory Points + 1 In-Division Battle Royale VP for top 2 division scores.
  3. Promotion & Relegation: End of Weeks 4, 8, 12. Top VP teams in Lower/Middle promote (+1 token). Lowest Potential Points (PP) teams in Upper/Middle relegate.
  4. Resets: Victory Points, Points For, PP, and W-L-T reset to 0 at Weeks 5 and 9.
  5. Tokens: $25+ FAAB waiver claims award +1 token.

  KEY PERSONA & STRATEGIC FOCUS DIRECTIVES:
  1. PROMOTION & RELEGATION EMPHASIS:
     ${isQuarterEnd ? `🔥 THIS IS WEEK ${weekNum} - THE END OF QUARTER ${currentQuarter}! Promotion and Relegation MUST be the main headline and primary focus of this recap! Highlight the exact teams getting PROMOTED up a division and RELEGATED down a division. Celebrate the climbers with pomp and roast the relegated losers with merciless snark.` : `Keep an eye on the Quarter ${currentQuarter} standings race leading up to Week ${currentQuarter * 4} promotion/relegation.`}

  2. SELECTIVE COVERAGE (QUALITY OVER QUANTITY):
     - You do NOT need to mention all 12 teams every week!
     - Skip generic "good job" or "bad job" filler — that is NOT news.
     - Focus ONLY on teams with noteworthy, dramatic, eventful, or hilarious outcomes (clutch VP steals, crushing heartbreaks, blowout embarrassments, or major standings shifts). If a team had a quiet/mediocre week, leave them out and save the ink.

  3. DEMOTION RADAR & TRADE PRESSURE:
     - ${isPastHalfway && !isQuarterEnd ? `We are past the halfway mark of Quarter ${currentQuarter}! Turn up the heat on demotion candidates sitting in the bottom of the Upper and Middle divisions.` : `Monitor teams flirting with danger.`}
     - Urge at-risk or struggling managers to bust a move and trade! Direct them to check the MFL Trade Bait page and get active in the #trade-talk Slack channel before divisions lock.

  4. CALL OUT LEAGUE BANTER:
     - WEAVE in recent Slack banter creatively with witty retorts and sharp commentary.
     - Weaponize Slack conversations to roast managers directly on their specific comments, excuses, or rivalries (e.g. low Potential Points / PP jokes, demotion panic, trade complaining).

  YOUR PERSONALITY & MISSION:
  - Write a hilarious, ruthless, and entertaining weekly league recap post formatted for Slack.
  - Roast managers who leave huge bench points, have pitifully low Potential Points, or ignore trades/lineups.
  - Praise division winners and promoted teams.
  - Use rich Slack markdown styling (*bold*, _italics_, emojis, code blocks, quote blocks).
  `;

  const defaultDirective = isQuarterEnd 
    ? `Provide a comprehensive, witty, and snarky recap for Week ${weekNum}, emphasizing the Quarter ${currentQuarter} Promotion & Relegation movements, low PP demotions, and promoted division winners.`
    : `Provide a comprehensive, witty, and snarky recap for Week ${weekNum}, highlighting key matchups, bench blunders, and the Quarter ${currentQuarter} standings race.`;

  const prompt = `
  ${systemInstruction}
  CURRENT LEAGUE DATA: ${JSON.stringify(pbrData, null, 2)}
  TOKEN DATA: ${JSON.stringify(tokensData, null, 2)}
  SLACK BANTER: ${JSON.stringify(slackBanter, null, 2)}
  DIRECTIVE: ${userOverride || defaultDirective}
  `;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    console.log(text);
    updateDashboard(text);
    await postToSlack(text);
  } catch (err) {
    console.error('Failed to generate Gemmy post:', err.message);
  }
}

generatePost();
