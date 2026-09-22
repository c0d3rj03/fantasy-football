const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { WebClient } = require('@slack/web-api');

// Extract week argument (e.g., process.argv[2] -&gt; '2')
const weekNum = process.argv[2] || '2';

// ---------------------------------------------------------------------------
// 1. SLACK BANTER FETCHER
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
      const result = await slack.conversations.history({
        channel: cleanId,
        limit: 20
      });

      if (result.messages) {
        const textMessages = result.messages
          .filter(m => m.text && !m.subtype)
          .map(m => m.text);
        banterList.push(...textMessages);
      }
    } catch (err) {
      console.warn(`⚠️ Could not fetch Slack history for channel ${channelId}:`, err.message);
    }
  }

  return banterList;
}

// ---------------------------------------------------------------------------
// 2. GEMINI API RETRY WRAPPER
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
// 3. MAIN RECAP GENERATOR
// ---------------------------------------------------------------------------
async function generateAiPost() {
  console.log(`🤖 Gathering Week ${weekNum} scores, full season history, ESPN news, and Slack banter...`);

  const dataPath = path.join(__dirname, 'data.json');
  if (!fs.existsSync(dataPath)) {
    console.error(`❌ Error: ${dataPath} not found!`);
    process.exit(1);
  }

  const leagueData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const slackBanter = await fetchSlackBanter();

  const systemInstruction = `You are Gemmy, the witty, sharp, sarcastic, yet knowledgeable AI commissioner and analyst for Premier Battle Royale (PBR), a 12-team promotion/relegation fantasy football league.
Your goal is to write the weekly recap for Week ${weekNum}. Highlight huge wins, painful losses, victory points, and call out league banter. Format in clean Slack Markdown (*bold*, _italics_, &gt; quotes, emojis).`;

  const promptContext = {
    week: weekNum,
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
    candidateText = `🏈 *PBR Week ${weekNum} Update*

Week ${weekNum} scores and Victory Points have been updated on the dashboard!

📊 Check out the updated standings: https://c0d3rj03.github.io/fantasy-football/pbr`;
  }

  const outputPath = path.join(__dirname, `gemmy_week_${weekNum}.md`);
  fs.writeFileSync(outputPath, candidateText);
  console.log(`\n✅ Saved recap to pbr/gemmy_week_${weekNum}.md`);
}

generateAiPost().catch(err => {
  console.error("❌ Fatal error in generate_post.js:", err);
  process.exit(1);
});
