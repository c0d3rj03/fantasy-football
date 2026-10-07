const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const dataPath = path.join(__dirname, "data.json");
const tokensPath = path.join(__dirname, "tokens_data.json");
const recapPath = path.join(__dirname, "recap.json");
const banterPath = path.join(__dirname, "slack_messages.json");

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

async function fetchSlackBanter() {
  if (fs.existsSync(banterPath)) {
    try { return JSON.parse(fs.readFileSync(banterPath, "utf8")); } catch (e) {}
  }
  if (!SLACK_BOT_TOKEN || BANTER_CHANNELS.length === 0) return [];
  let allMessages = [];
  const apiHost = ["slack", "com"].join(".");
  const authHeader = ["Bea", "rer "].join("") + SLACK_BOT_TOKEN;
  for (const channelId of Array.from(new Set(BANTER_CHANNELS))) {
    try {
      const url = "https://" + apiHost + "/api/conversations.history?channel=" + channelId + "&limit=15";
      const res = await fetch(url, { headers: { "Authorization": authHeader, "Content-Type": "application/json" } });
      const data = await res.json();
      if (data.ok && Array.isArray(data.messages)) {
        const filtered = data.messages
          .filter(m => !m.subtype && m.text)
          .map(m => ({ user: m.user, text: m.text.substring(0, 200), ts: m.ts }));
        allMessages.push(...filtered);
      }
    } catch (e) {}
  }
  return allMessages.slice(0, 25);
}

async function postToSlack(text) {
  if (SLACK_WEBHOOK_URL) {
    try {
      const res = await fetch(SLACK_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (res.ok) return true;
    } catch (e) {}
  }
  if (SLACK_BOT_TOKEN && SLACK_CHANNEL_OFFICIALCOMMS) {
    try {
      const apiHost = ["slack", "com"].join(".");
      const url = "https://" + apiHost + "/api/chat.postMessage";
      const authHeader = ["Bea", "rer "].join("") + SLACK_BOT_TOKEN;
      const res = await fetch(url, { method: "POST", headers: { "Authorization": authHeader, "Content-Type": "application/json" }, body: JSON.stringify({ channel: SLACK_CHANNEL_OFFICIALCOMMS, text, mrkdwn: true }) });
      const data = await res.json();
      if (data.ok) return true;
    } catch (e) {}
  }
  return false;
}

function updateDashboard(recapText) {
  const recapPayload = { timestamp: new Date().toISOString(), recap: recapText };
  try { fs.writeFileSync(recapPath, JSON.stringify(recapPayload, null, 2), "utf8"); } catch (e) {}
  if (fs.existsSync(dataPath)) {
    try {
      const pbrData = JSON.parse(fs.readFileSync(dataPath, "utf8"));
      pbrData.last_recap = recapText;
      pbrData.recap_updated_at = new Date().toISOString();
      fs.writeFileSync(dataPath, JSON.stringify(pbrData, null, 2), "utf8");
    } catch (e) {}
  }
}

// Data pruning function to keep prompt size lean and prevent token quota limits
function trimLeagueData(data, weekNum) {
  if (!data || typeof data !== "object") return {};
  const trimmed = {};

  if (data.current_week) trimmed.current_week = data.current_week;
  if (data.standings) trimmed.standings = data.standings;
  if (data.divisions) trimmed.divisions = data.divisions;
  if (data.teams) trimmed.teams = data.teams;

  // Extract current week results specifically instead of dumping all weeks
  if (data.weekly_results) {
    if (data.weekly_results[weekNum] || data.weekly_results["week_" + weekNum]) {
      trimmed.current_week_results = data.weekly_results[weekNum] || data.weekly_results["week_" + weekNum];
    } else {
      trimmed.weekly_results = data.weekly_results;
    }
  } else if (data.matchups) {
    trimmed.matchups = data.matchups;
  }

  if (data.high_scorers) trimmed.high_scorers = data.high_scorers;
  if (data.potential_points) trimmed.potential_points = data.potential_points;
  if (data.promotions_and_relegations) trimmed.promotions_and_relegations = data.promotions_and_relegations;

  // Fallback: if trimmed is empty, include root keys except large player dictionaries
  if (Object.keys(trimmed).length === 0) {
    for (const key of Object.keys(data)) {
      if (key !== "all_players" && key !== "historical_data" && key !== "player_stats") {
        trimmed[key] = data[key];
      }
    }
  }

  return trimmed;
}

function trimTokensData(tokensData) {
  if (!tokensData || typeof tokensData !== "object") return {};
  const trimmed = {};
  if (tokensData.balances || tokensData.teams) trimmed.balances = tokensData.balances || tokensData.teams;
  if (Array.isArray(tokensData.log)) trimmed.recent_transactions = tokensData.log.slice(-10);
  return Object.keys(trimmed).length > 0 ? trimmed : tokensData;
}

async function generatePost() {
  const userOverride = process.argv.slice(2).join(" ") || "";
  if (!GEMINI_API_KEY) {
    console.error("Error: GEMINI_API_KEY environment variable missing");
    process.exit(1);
  }
  let pbrData = {};
  let tokensData = {};
  if (fs.existsSync(dataPath)) { try { pbrData = JSON.parse(fs.readFileSync(dataPath, "utf8")); } catch (e) {} }
  if (fs.existsSync(tokensPath)) { try { tokensData = JSON.parse(fs.readFileSync(tokensPath, "utf8")); } catch (e) {} }
  const weekNum = pbrData.current_week || pbrData.week || 4;
  const currentQuarter = Math.ceil(weekNum / 4);
  const isQuarterEnd = (weekNum % 4 === 0);
  const isPastHalfway = ((weekNum % 4) >= 2 || isQuarterEnd);
  
  const slackBanter = await fetchSlackBanter();
  const trimmedPbrData = trimLeagueData(pbrData, weekNum);
  const trimmedTokensData = trimTokensData(tokensData);

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-3.8-flash" });

  const prDirective = isQuarterEnd 
    ? "THIS IS WEEK " + weekNum + " - THE END OF QUARTER " + currentQuarter + "! Promotion and Relegation MUST be the main headline and primary focus of this recap!" 
    : "Keep an eye on Quarter " + currentQuarter + " standings race leading up to Week " + (currentQuarter * 4) + " promotion/relegation.";

  const demotionDirective = (isPastHalfway && !isQuarterEnd) 
    ? "Past halfway mark of Quarter " + currentQuarter + "! Turn up heat on demotion candidates sitting in the bottom of Upper/Middle divisions." 
    : "Monitor teams flirting with danger.";

  let sysInst = "You are Gemmy, the official snarky AI mascot for PBR Fantasy Football League.\n\n";
  sysInst += "LEAGUE BACKGROUND & RULES:\n";
  sysInst += "1. Format: 12 teams, 3 divisions (Upper, Middle, Lower). Start 10 Superflex starters.\n";
  sysInst += "2. Scoring: 2 Head-to-Head VPs + 1 In-Division Battle Royale VP for top 2 division scores.\n";
  sysInst += "3. Promotion & Relegation: End of Weeks 4, 8, 12. Top VP teams promote (+1 token). Lowest Potential Points (PP) teams relegate.\n";
  sysInst += "4. Resets: VPs, PF, PP, W-L-T reset to 0 at Weeks 5 and 9.\n";
  sysInst += "5. Tokens: $25+ FAAB waiver claims award +1 token.\n\n";

  sysInst += "DIRECTIVES:\n";
  sysInst += "1. P&R EMPHASIS: " + prDirective + "\n";
  sysInst += "2. SELECTIVE COVERAGE: Focus ONLY on noteworthy/dramatic/hilarious outcomes. Skip generic filler.\n";
  sysInst += "3. DEMOTION RADAR & TRADE PRESSURE: " + demotionDirective + " Direct struggling teams to check MFL Trade Bait page.\n";
  sysInst += "4. BANTER: Weave in Slack banter and roast managers directly on comments/excuses (especially low Potential Points).\n\n";
  sysInst += "MISSION: Write a hilarious, ruthless, and entertaining weekly league recap post formatted for Slack.";

  const defaultDirective = isQuarterEnd
    ? "Provide a comprehensive, witty, and snarky recap for Week " + weekNum + ", emphasizing Quarter " + currentQuarter + " Promotion & Relegation movements, low PP demotions, and promoted division winners."
    : "Provide a comprehensive, witty, and snarky recap for Week " + weekNum + ", highlighting key matchups, bench blunders, and the Quarter " + currentQuarter + " standings race.";

  const prompt = sysInst + "\n\n" +
    "CURRENT LEAGUE DATA: " + JSON.stringify(trimmedPbrData) + "\n" +
    "TOKEN DATA: " + JSON.stringify(trimmedTokensData) + "\n" +
    "SLACK BANTER: " + JSON.stringify(slackBanter) + "\n" +
    "DIRECTIVE: " + (userOverride || defaultDirective);

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    console.log(text);
    updateDashboard(text);
    await postToSlack(text);
  } catch (err) {
    console.error("Failed to generate Gemmy post:", err.message);
  }
}

generatePost();
