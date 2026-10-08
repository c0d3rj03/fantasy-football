const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const dataPath = path.join(__dirname, 'data.json');
const tokensPath = path.join(__dirname, 'tokens_data.json');
const recapPath = path.join(__dirname, 'recap.json');
const banterPath = path.join(__dirname, 'slack_messages.json');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || process.env.SLACK_TOKEN;
const SLACK_CHANNEL_OFFICIALCOMMS = process.env.PBR_SLACK_CHANNEL_OFFICIALCOMMS || process.env.SLACK_CHANNEL_ID || process.env.SLACK_GENERAL_CHANNEL_ID;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const BANTER_CHANNELS = [
  process.env.PBR_SLACK_CHANNEL_OFFICIALCOMMS,
  process.env.PBR_SLACK_CHANNEL_GENERAL,
  process.env.PBR_SLACK_CHANNEL_RANDOM,
  process.env.PBR_SLACK_CHANNEL_TRADE_TALK,
  process.env.SLACK_CHANNEL_ID
].filter(Boolean);

function sanitizeSlackMrkdwn(text) {
  if (!text) return '';
  let clean = text;
  clean = clean.replace(/\*\*(.*?)\*\*/g, '**');
  clean = clean.replace(/^#{1,6}\s*(.*)$/gm, '');
  clean = clean.replace(/^[\s	]*[-*_]{3,}[\s	]*$/gm, '');
  clean = clean.replace(/
{3,}/g, '

');
  return clean.trim();
}

async function fetchSlackBanter() {
  if (fs.existsSync(banterPath)) {
    try { return JSON.parse(fs.readFileSync(banterPath, 'utf8')); } catch (e) {}
  }
  if (!SLACK_BOT_TOKEN || BANTER_CHANNELS.length === 0) return [];
  let allMessages = [];
  const apiHost = ['slack', 'com'].join('.');
  const authHeader = ['Bea', 'rer '].join('') + SLACK_BOT_TOKEN;
  for (const channelId of Array.from(new Set(BANTER_CHANNELS))) {
    try {
      const url = 'https://' + apiHost + '/api/conversations.history?channel=' + channelId + '&limit=20';
      const res = await fetch(url, { headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (data.ok && Array.isArray(data.messages)) {
        const filtered = data.messages.filter(m => !m.subtype && m.text).map(m => ({ user: m.user, text: m.text, ts: m.ts, channel: channelId }));
        allMessages.push(...filtered);
      }
    } catch (e) {}
  }
  return allMessages.slice(0, 30);
}

async function postToSlack(text) {
  if (SLACK_WEBHOOK_URL) {
    try {
      const res = await fetch(SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      if (res.ok) return true;
    } catch (e) {}
  }
  if (SLACK_BOT_TOKEN && SLACK_CHANNEL_OFFICIALCOMMS) {
    try {
      const apiHost = ['slack', 'com'].join('.');
      const url = 'https://' + apiHost + '/api/chat.postMessage';
      const authHeader = ['Bea', 'rer '].join('') + SLACK_BOT_TOKEN;
      const res = await fetch(url, { method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: SLACK_CHANNEL_OFFICIALCOMMS, text, mrkdwn: true }) });
      const data = await res.json();
      if (data.ok) return true;
    } catch (e) {}
  }
  return false;
}

function updateDataJsonRecap(pbrData, weekNum, cleanRecap) {
  const weekStr = String(weekNum);
  const weekIdx = Number(weekNum) - 1;
  const currentQuarter = Math.ceil(weekNum / 4);
  const quarterStr = String(currentQuarter);
  const quarterIdx = currentQuarter - 1;

  pbrData.last_recap = cleanRecap;
  pbrData.recap_updated_at = new Date().toISOString();

  if (pbrData.weekly_recaps) {
    if (Array.isArray(pbrData.weekly_recaps)) {
      pbrData.weekly_recaps[weekIdx] = cleanRecap;
    } else if (typeof pbrData.weekly_recaps === 'object') {
      pbrData.weekly_recaps[weekStr] = cleanRecap;
    }
  } else {
    pbrData.weekly_recaps = {};
    pbrData.weekly_recaps[weekStr] = cleanRecap;
  }

  if (pbrData.recaps) {
    if (Array.isArray(pbrData.recaps)) {
      pbrData.recaps[weekIdx] = cleanRecap;
    } else if (typeof pbrData.recaps === 'object') {
      pbrData.recaps[weekStr] = cleanRecap;
    }
  }

  if (pbrData.weekly_data) {
    if (Array.isArray(pbrData.weekly_data)) {
      pbrData.weekly_data.forEach(item => {
        if (item && (item.week == weekNum || item.week_num == weekNum)) item.recap = cleanRecap;
      });
      if (pbrData.weekly_data[weekIdx]) pbrData.weekly_data[weekIdx].recap = cleanRecap;
    } else if (typeof pbrData.weekly_data === 'object') {
      if (pbrData.weekly_data[weekStr]) pbrData.weekly_data[weekStr].recap = cleanRecap;
    }
  }

  if (pbrData.weeks) {
    if (Array.isArray(pbrData.weeks)) {
      pbrData.weeks.forEach(item => {
        if (item && (item.week == weekNum || item.week_num == weekNum)) item.recap = cleanRecap;
      });
      if (pbrData.weeks[weekIdx]) pbrData.weeks[weekIdx].recap = cleanRecap;
    } else if (typeof pbrData.weeks === 'object') {
      if (pbrData.weeks[weekStr]) pbrData.weeks[weekStr].recap = cleanRecap;
    }
  }

  if (pbrData.quarters) {
    let qObj = pbrData.quarters[quarterStr] || pbrData.quarters[quarterIdx] || pbrData.quarters[currentQuarter];
    if (!qObj && Array.isArray(pbrData.quarters)) qObj = pbrData.quarters[quarterIdx];
    if (qObj) {
      if (qObj.weekly_data) {
        if (Array.isArray(qObj.weekly_data)) {
          qObj.weekly_data.forEach(item => {
            if (item && (item.week == weekNum || item.week_num == weekNum)) item.recap = cleanRecap;
          });
          if (qObj.weekly_data[weekIdx]) qObj.weekly_data[weekIdx].recap = cleanRecap;
        } else if (typeof qObj.weekly_data === 'object') {
          if (qObj.weekly_data[weekStr]) qObj.weekly_data[weekStr].recap = cleanRecap;
        }
      }
      if (qObj.weeks) {
        if (Array.isArray(qObj.weeks)) {
          qObj.weeks.forEach(item => {
            if (item && (item.week == weekNum || item.week_num == weekNum)) item.recap = cleanRecap;
          });
        } else if (typeof qObj.weeks === 'object') {
          if (qObj.weeks[weekStr]) qObj.weeks[weekStr].recap = cleanRecap;
        }
      }
    }
  }
}

function updateDashboard(recapText, weekNum) {
  const clean = sanitizeSlackMrkdwn(recapText);
  const recapPayload = { timestamp: new Date().toISOString(), recap: clean };
  try { fs.writeFileSync(recapPath, JSON.stringify(recapPayload, null, 2), 'utf8'); } catch (e) {}
  if (fs.existsSync(dataPath)) {
    try {
      const pbrData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      const targetWeek = weekNum || pbrData.current_week || pbrData.week || 4;
      updateDataJsonRecap(pbrData, targetWeek, clean);
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
  const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' });

  const prDirective = isQuarterEnd ?  : ;
  const demotionDirective = (isPastHalfway && !isQuarterEnd) ?  : ;

  let sysInst = ;
  sysInst += ;
  sysInst += ;
  sysInst += ;
  sysInst += ;
  sysInst += ;
  sysInst += ;
  sysInst += ;
  sysInst += ;
  sysInst += ;
  sysInst += ;
  sysInst += ;
  sysInst += ;
  sysInst += ;

  const defaultDirective = isQuarterEnd
    ? 
    : ;

  const prompt = sysInst + '

' +
    'CURRENT LEAGUE DATA: ' + JSON.stringify(pbrData) + '
' +
    'TOKEN DATA: ' + JSON.stringify(tokensData) + '
' +
    'SLACK BANTER: ' + JSON.stringify(slackBanter) + '
' +
    'DIRECTIVE: ' + (userOverride || defaultDirective);

  try {
    const result = await model.generateContent(prompt);
    const rawText = result.response.text();
    const cleanText = sanitizeSlackMrkdwn(rawText);
    console.log(cleanText);
    updateDashboard(cleanText, weekNum);
    await postToSlack(cleanText);
  } catch (err) {
    console.error('Failed to generate Gemmy post:', err.message);
  }
}

generatePost();
