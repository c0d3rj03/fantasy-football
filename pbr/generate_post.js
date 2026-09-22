const fs = require('fs');
const path = require('path');

const LEAGUE_ID = "63213";
const YEAR = "2026";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL_NAME || 'gemini-3.6-flash';
const SLACK_BOT_TOKEN = process.env.PBR_SLACK_BOT_TOKEN;

// Slack channel environment variables
const SLACK_CHANNELS = {
  general: process.env.PBR_SLACK_CHANNEL_GENERAL,
  random: process.env.PBR_SLACK_CHANNEL_RANDOM,
  trade_talk: process.env.PBR_SLACK_CHANNEL_TRADE_TALK,
  officialcomms: process.env.PBR_SLACK_CHANNEL_OFFICIALCOMMS
};

// ============================================================================
// 1. FETCH ESPN NFL HEADLINES
// ============================================================================
async function fetchNflNews() {
  try {
    const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/news");
    const data = await res.json();
    return (data.articles || []).slice(0, 5).map(a => `${a.headline}: ${a.description || ''}`);
  } catch (err) {
    console.warn("⚠️ Could not fetch ESPN NFL news:", err.message);
    return [];
  }
}

// ============================================================================
// 2. FETCH SLACK CHANNEL CHATTER
// ============================================================================
async function fetchSlackChannelHistory(channelId) {
  if (!SLACK_BOT_TOKEN || !channelId) return [];
  try {
    const url = `https://slack.com/api/conversations.history?channel=${channelId}&amp;limit=25`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` }
    });
    // Clean Slack history fetch
    try {
      const history = await slack.conversations.history({
        channel: channelId.trim(), // Strip any hidden whitespace
        limit: 20                  // Use 'limit', NOT 'count' or 'channel_id'
      });
    } catch (err) {
      console.warn(`⚠️ Could not fetch Slack history for channel ${channelId}:`, err.message);
    }
    const data = await res.json();
    if (!data.ok) {
      console.warn(`⚠️ Slack history warning for channel ${channelId}:`, data.error);
      return [];
    }
    return (data.messages || [])
      .filter(m => !m.subtype && m.text)
      .map(m => m.text.substring(0, 300));
  } catch (err) {
    console.warn(`⚠️ Failed to read Slack channel ${channelId}:`, err.message);
    return [];
  }
}

async function gatherSlackChatter() {
  const chatter = {};
  for (const [name, id] of Object.entries(SLACK_CHANNELS)) {
    if (id) {
      const messages = await fetchSlackChannelHistory(id);
      if (messages.length > 0) chatter[name] = messages;
    }
  }
  return chatter;
}

// ============================================================================
// 3. GEMINI API CALL WITH RETRY LOGIC (HANDLES 503 CAPACITY SPIKES)
// ============================================================================
// Retries Gemini up to 5 times with exponential backoff on 503 errors
async function generateGeminiPost(model, prompt, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      if (err.status === 503 || err.message?.includes('503')) {
        const waitMs = Math.pow(2, attempt) * 2500; // 5s, 10s, 20s, 40s
        console.warn(`⚠️ Gemini API busy (503). Attempt ${attempt}/${maxRetries}. Retrying in ${waitMs / 1000}s...`);
        await new Promise(res => setTimeout(res, waitMs));
      } else {
        console.error("❌ Gemini API Error:", err.message);
        break;
      }
    }
  }
  return null;
}

// ============================================================================
// 4. MAIN GENERATION PIPELINE
// ============================================================================
async function generateAiPost(weekNum) {
  const dataPath = path.join(__dirname, 'data.json');
  if (!fs.existsSync(dataPath)) {
    console.error("❌ Error: pbr/data.json not found!");
    return;
  }

  const leagueData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  console.log(`\n🤖 Gathering Week ${weekNum} scores, full season history, ESPN news, and Slack banter...`);
  const [nflNews, slackChatter] = await Promise.all([
    fetchNflNews(),
    gatherSlackChatter()
  ]);

  const promptContext = {
    current_week: weekNum,
    weekly_history: leagueData.weekly_data, // Gives Gemini full multi-week context!
    nfl_headlines: nflNews,
    slack_league_chatter: slackChatter
  };

  const systemInstruction = `
  You are "Gemmy", the AI Commissioner and resident expert of the PBR Fantasy Football League.
  Write a witty, entertaining, and sharp weekly recap post for Slack following these STRICT rules:
  
  1. **START WITH THE DASHBOARD LINK**: The very first line of the post MUST be:
     👉 **PBR Dashboard &amp; Live Standings:** https://c0d3rj03.github.io/fantasy-football/pbr/
  
  2. **NO STANDINGS DUMPS OR BATTLE ROYALE TABLES**: Do NOT list full standings or raw Battle Royale point tables. The web dashboard handles all of that.
  
  3. **SPORTS TERMINOLOGY &amp; CONTEXTUAL AWARDS**:
     - **Bad Beat 💔**: If a manager drops a massive point total (e.g. top 2-3 in the league) but STILL loses their Head-to-Head matchup because their opponent went nuclear, call it out as a brutal **Bad Beat**!
     - **Smarty-Pants Starter Award 🤓**: Reserve this for high-IQ lineup calls—starting a sleeper or low-projected player who exploded.
     - **Bust / Disastrous Call 🤮**: Highlight someone who started a player who laid a donut/dud, or a team that posted an agonizingly low total PF.
     - **Handcuff Watch 👀**: If a superstar suffers a long-term injury, note if an opponent or manager holds their backup on their bench.
  
  4. **MULTI-WEEK TRENDS &amp; QUARTERLY STAKES**:
     - **Relegation Alert 🚨**: REMEMBER: quarterly relegation is determined strictly by **lowest PP (Possible Points / Potential Points)**, NOT PF! Highlight teams sitting in danger of lowest PP.
     - **Promotion Dogfight 🏆**: Highlight teams surging for promotion to higher tiers.
     - **Quarterly Reminder 🎗️**: If approaching Week 3 or Week 4, remind the league that the quarter is wrapping up soon with tier shifts and payout allocations on the line!
  
  5. **SLACK BANTER &amp; ENTERTAINMENT**: Interweave recent Slack chatter from the channel history for inside jokes, trash talk, and snark.
  
  6. **BREVITY &amp; FORMAT**: Keep it punchy and readable (~15-20 lines total) with bold headers, sports jargon, and energetic emojis.
  `;

  if (!GEMINI_API_KEY) {
    console.warn("⚠️ GEMINI_API_KEY environment variable missing.");
    return;
  }

  console.log(`🧠 Invoking Gemini API (${GEMINI_MODEL}) to compose recap...`);

  const fullPrompt = `${systemInstruction}\n\nHere is this week's league data and history:\n${JSON.stringify(promptContext, null, 2)}`;
  const aiData = await callGeminiWithRetry(fullPrompt);

  // 1. Extract text from response (if successful)
  let candidateText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;

  // 2. Handle success vs. fallback
  if (candidateText) {
    console.log("\n================ GEMMY'S AI RECAP ================\n");
    console.log(candidateText);
  } else {
    console.warn("⚠️ Gemini API unavailable after retries; using basic fallback post.");
    candidateText = `🏈 **PBR Week ${weekNum} Update**\n\nWeek ${weekNum} scores and Victory Points have been updated on the dashboard!`;
  }

  // 3. Always save recap file so downstream steps (Slack notification &amp; Git commit) never fail
  fs.writeFileSync(path.join(__dirname, `gemmy_week_${weekNum}.md`), candidateText);
  console.log(`\n✅ Saved recap to pbr/gemmy_week_${weekNum}.md`);
}

const targetWeek = process.argv[2] || "1";
generateAiPost(targetWeek);
