const fs = require('fs');
const path = require('path');
const { API, modelCandidates } = require('./gemini_models.js');
const { addMentions, withChannelHeader, teamNamesFrom } = require('./slack_mentions.js');
const { postToOfficialComms } = require('./slack_post.js');

const userPrompt = process.argv[2];

if (!userPrompt) {
  console.log(`\n❌ Missing prompt!\n\nUsage:\n  node gemmy_custom_post.js "<prompt>"\n`);
  process.exit(1);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL = process.env.SLACK_CHANNEL || process.env.PBR_SLACK_CHANNEL_OFFICIALCOMMS || 'C0C6N8RTD5J';

async function generateWithGemini(prompt) {
  if (!GEMINI_API_KEY) {
    console.log("💡 No GEMINI_API_KEY detected in env. Using smart template fallback.");
    return fallbackTemplate(prompt);
  }

  const systemInstruction = `You are Gemmy, the witty, snarky, sarcastic AI assistant commissioner for PBR (Premier Battle Royale fantasy football league). Write a short, punchy 1-2 paragraph Slack post with emojis and Slack bolding based on the user's prompt. Be funny, a little condescending about managers leaving points on the bench or making bad moves, but keep it light and fun. Always end with a coffee or 💅 emoji.`;

  // Same model choice as the weekly recap (gemini_models.js); the first model that answers wins.
  for (const model of await modelCandidates(GEMINI_API_KEY)) {
    try {
      console.log(`✨ Generating post with ${model}...`);
      const res = await fetch(`${API}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: `${systemInstruction}\n\nPrompt: ${prompt}` }] }
          ]
        })
      });

      if (!res.ok) throw new Error(`Gemini API returned HTTP ${res.status}`);
      const data = await res.json();
      const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (aiText) return aiText.trim();
    } catch (err) {
      console.warn(`⚠️ Gemini ${model} failed (${err.message}).`);
    }
  }
  console.warn('⚠️ No Gemini model answered. Using fallback template.');
  return fallbackTemplate(prompt);
}

function fallbackTemplate(prompt) {
  return `📢 *Gemmy Public Service Announcement* 💅\n\n` +
         `Hey managers, friendly reminder from your favorite automated commissioner assistant: **${prompt}** 🏈\n\n` +
         `Set your lineups and make your moves before it's too late. Let's try to pretend this is a competitive league. ⏰💥\n\n` +
         `_Don't blame me when you lose. You've been warned._ ☕`;
}

// Slack copy gets the @channel + dashboard-link header and owner @mentions (slack_mentions.js), like the weekly recap.
async function postToSlack(postContent) {
  const text = withChannelHeader(addMentions(postContent, teamNamesFrom(loadLeagueData())));
  console.log('\n🤖 Gemmy Post Output:\n');
  console.log('--------------------------------------------------');
  console.log(text);
  console.log('--------------------------------------------------\n');

  if (!SLACK_WEBHOOK_URL && !SLACK_BOT_TOKEN) {
    console.log("💡 (Note: Set SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN environment variables to post directly to Slack!)");
    return;
  }
  // Bot first, webhook only as a fallback, so a post never goes out twice (slack_post.js).
  process.env.PBR_SLACK_CHANNEL_OFFICIALCOMMS = SLACK_CHANNEL;
  const via = await postToOfficialComms(text);
  if (!via) throw new Error('Could not post to Slack (no working bot token/channel or webhook)');
  console.log(`✅ Successfully posted to Slack via ${via}!`);
}

// data.json's team names, for @mentions. Missing data.json just means no tags.
function loadLeagueData() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  } catch (e) {
    return {};
  }
}

async function main() {
  const postContent = await generateWithGemini(userPrompt);
  await postToSlack(postContent);
}

main().catch(err => {
  console.error(`❌ Gemmy custom post failed: ${err.message}`);
  process.exit(1);
});
