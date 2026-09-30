const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { WebClient } = require('@slack/web-api');

// ---------------------------------------------------------------------------
// 1. DATA & WEEK RESOLUTION
// ---------------------------------------------------------------------------
const dataPath = path.join(__dirname, 'data.json');
let leagueData = {};
if (fs.existsSync(dataPath)) {
  try {
    leagueData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (err) {
    console.warn("⚠️ Could not parse data.json:", err.message);
  }
}

const rawArg = process.argv[2];
let weekNum = rawArg;

if (!weekNum || weekNum.trim() === '') {
  const playedWeeks = Object.keys(leagueData.weekly_data || {}).filter(w => leagueData.weekly_data[w].played);
  weekNum = playedWeeks.length > 0 ? Math.max(...playedWeeks.map(Number)).toString() : '1';
}

// ---------------------------------------------------------------------------
// 2. SLACK BANTER FETCHER
// ---------------------------------------------------------------------------
async function fetchSlackBanter() {
  const token = process.env.PBR_SLACK_BOT_TOKEN;
  if (!token) {
    console.warn("⚠️ PBR_SLACK_BOT_TOKEN missing; skipping Slack banter.");
    return [];
  }

  const slack = new WebClient(token);
  const channelIds = [
    process.env.PBR_SLACK_CHANNEL_GENERAL,
    process.env.PBR_SLACK_CHANNEL_RANDOM,
    process.env.PBR_SLACK_CHANNEL_TRADE_TALK,
    process.env.PBR_SLACK_CHANNEL_OFFICIALCOMMS
  ].filter(Boolean);

  let banterList = [];

  for (const channelId of channelIds) {
    try {
      const cleanId = channelId.trim();
      const result = await slack.conversations.history({ channel: cleanId, limit: 20 });
      if (result.messages) {
        const textMessages = result.messages
          .filter(m => m.text && !m.subtype)
          .map(m => m.text);
        banterList.push(...textMessages);
      }
    } catch (err) {
      console.warn(`⚠️ Could not fetch Slack history for channel ${cleanId}:`, err.message);
    }
  }

  return banterList;
}

// ---------------------------------------------------------------------------
// 3. GEMINI API RETRY WRAPPER
// ---------------------------------------------------------------------------
async function callGeminiWithRetry(prompt, maxRetries = 5) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ GEMINI_API_KEY missing in environment variables.");
    return null;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_MODEL_NAME || 'gemini-3.6-flash';
  const model = genAI.getGenerativeModel({ model: modelName });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const text = result?.response?.text();
      if (text) return text;
    } catch (err) {
      const is503 = err.status === 503 || (err.message && err.message.includes('503'));
      if (is503 && attempt < maxRetries) {
        const waitMs = Math.pow(2, attempt) * 2500;
        console.warn(`⚠️ Gemini API busy (503). Attempt ${attempt}/${maxRetries}. Retrying in ${waitMs / 1000}s...`);
        await new Promise(res => setTimeout(res, waitMs));
      } else {
        console.error(`❌ Gemini API Error (Attempt ${attempt}/${maxRetries}):`, err.message || err);
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 4. MAIN RECAP GENERATOR
// ---------------------------------------------------------------------------
async function generateAiPost() {
  console.log(`🤖 Gathering Week ${weekNum} scores, full season history, demotion risks, and Slack banter...`);

  if (!leagueData || !leagueData.weekly_data) {
    console.error(`❌ Error: Valid data.json not found or empty!`);
    process.exit(1);
  }

  const slackBanter = await fetchSlackBanter();

  // Determine quarter position and demotion candidate context
  const weekInt = parseInt(weekNum, 10);
  const currentQuarter = Math.ceil(weekInt / 4);
  const quarterWeek = ((weekInt - 1) % 4) + 1; // 1, 2, 3, or 4
  const isPastHalfway = quarterWeek >= 2;

  const systemInstruction = `You are Gemmy, the witty, sharp, sarcastic, yet highly knowledgeable AI commissioner and analyst for Premier Battle Royale (PBR), a 12-team promotion/relegation fantasy football league.

Your goal is to write the weekly recap for Week ${weekNum} (Quarter ${currentQuarter}, Week ${quarterWeek} of 4 in this quarter).

Key Instructions & Persona Directives:
1. Highlighting Performance: Call out huge wins, painful losses, blowout scores, and Victory Point (VP) accruals.
2. Demotion/Relegation Radar: ${isPastHalfway ? `CRITICAL - We are at or past the halfway mark of Quarter ${currentQuarter}! Pay intense attention to demotion candidates sitting in the bottom of the Upper Division and Middle Division standings. Be extra snarky toward owners in danger of getting relegated at the end of Week ${currentQuarter * 4}.` : `Keep an eye on teams stumbling early in Quarter ${currentQuarter} who could face demotion pressure soon.`}
3. Trade Pressure & Snark: Explicitly push struggling or at-risk owners to bust a move and trade to save their season! Tell them to check the MFL Trade Bait page (https://www42.myfantasyleague.com/2026/options?L=63213&O=133) and get active in the #trade-talk Slack channel before promotion/relegation locks at the end of the quarter.
4. Call Out League Banter: Incorporate recent Slack banter creatively with full snark.
5. Formatting: Format in clean Slack Markdown (*bold*, _italics_, > quotes, emojis).
   IMPORTANT FORMATTING RULE: Use Slack Markdown formatting! Use single asterisks for bold (*bold*), NOT double asterisks (**bold**).`;

  const promptContext = {
    week: weekNum,
    quarter: currentQuarter,
    quarterWeek: quarterWeek,
    isPastHalfwayMark: isPastHalfway,
    mflTradeBaitUrl: "https://www42.myfantasyleague.com/2026/options?L=63213&O=133",
    leagueData: leagueData,
    recentSlackBanter: slackBanter.slice(0, 30)
  };

  const GEMINI_MODEL = process.env.GEMINI_MODEL_NAME || 'gemini-3.6-flash';
  console.log(`🧠 Invoking Gemini API (${GEMINI_MODEL}) to compose recap...`);

  const fullPrompt = `${systemInstruction}\n\nHere is this week's league data and history:\n${JSON.stringify(promptContext, null, 2)}`;

  let candidateText = await callGeminiWithRetry(fullPrompt);

  if (candidateText) {
    console.log("\n================ GEMMY'S AI RECAP ================\n");
    console.log(candidateText);
  } else {
    console.warn("⚠️ Gemini API unavailable after retries; generating fallback post.");
    candidateText = `🏈 *PBR Week ${weekNum} Update*\n\nWeek ${weekNum} scores and Victory Points have been updated on the dashboard! 📊 Check out the updated standings: https://c0d3rj03.github.io/fantasy-football/pbr`;
  }

  // Convert any lingering double asterisks to single asterisks for Slack
  candidateText = candidateText.replace(/\*\*(.*?)\*\*/g, '*$1*');

  // Save Markdown file
  const outputPath = path.join(__dirname, `gemmy_week_${weekNum}.md`);
  fs.writeFileSync(outputPath, candidateText);
  console.log(`\n✅ Saved recap to pbr/gemmy_week_${weekNum}.md`);

  // Embed recap directly into data.json so the website dashboard updates automatically
  if (fs.existsSync(dataPath)) {
    try {
      const updatedLeagueData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      if (updatedLeagueData.weekly_data && updatedLeagueData.weekly_data[weekNum]) {
        updatedLeagueData.weekly_data[weekNum].recap = candidateText;
        fs.writeFileSync(dataPath, JSON.stringify(updatedLeagueData, null, 2));
        console.log(`💾 Embedded Week ${weekNum} recap directly into data.json`);
      }
    } catch (e) {
      console.warn("⚠️ Could not embed recap into data.json:", e.message);
    }
  }
}

generateAiPost().catch(err => {
  console.error("❌ Fatal error in generate_post.js:", err);
  process.exit(1);
});
