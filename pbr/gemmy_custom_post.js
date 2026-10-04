const fs = require('fs');
const path = require('path');

const userPrompt = process.argv[2];

if (!userPrompt) {
  console.log(`\n❌ Missing prompt!\n\nUsage:\n  node gemmy_custom_post.js "<prompt>"\n`);
  process.exit(1);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL = process.env.SLACK_CHANNEL || 'C0C6N8RTD5J';

async function generateWithGemini(prompt) {
  if (!GEMINI_API_KEY) {
    console.log("💡 No GEMINI_API_KEY detected in env. Using smart template fallback.");
    return fallbackTemplate(prompt);
  }

  console.log("✨ Generating post with Gemini 2.5 Flash...");
  const systemInstruction = `You are Gemmy, the witty, snarky, sarcastic AI assistant commissioner for PBR (Premier Battle Royale fantasy football league). Write a short, punchy 1-2 paragraph Slack post with emojis and Slack bolding based on the user's prompt. Be funny, a little condescending about managers leaving points on the bench or making bad moves, but keep it light and fun. Always end with a coffee or 💅 emoji.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    return fallbackTemplate(prompt);
  } catch (err) {
    console.warn(`⚠️ Gemini API call failed (${err.message}). Using fallback template.`);
    return fallbackTemplate(prompt);
  }
}

function fallbackTemplate(prompt) {
  return `📢 *Gemmy Public Service Announcement* 💅\n\n` +
         `Hey managers, friendly reminder from your favorite automated commissioner assistant: **${prompt}** 🏈\n\n` +
         `Set your lineups and make your moves before it's too late. Let's try to pretend this is a competitive league. ⏰💥\n\n` +
         `_Don't blame me when you lose. You've been warned._ ☕`;
}

async function postToSlack(text) {
  console.log("\n🤖 Gemmy Post Output:\n");
  console.log("--------------------------------------------------");
  console.log(text);
  console.log("--------------------------------------------------\n");

  if (SLACK_WEBHOOK_URL) {
    try {
      const res = await fetch(SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (res.ok) console.log("✅ Successfully posted to Slack via Webhook!");
    } catch (err) {
      console.error(`❌ Webhook post failed: ${err.message}`);
    }
  }

  if (SLACK_BOT_TOKEN) {
    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
        },
        body: JSON.stringify({ channel: SLACK_CHANNEL, text })
      });
      const data = await res.json();
      if (data.ok) console.log(`✅ Successfully posted to Slack channel (${SLACK_CHANNEL}) via Bot API!`);
    } catch (err) {
      console.error(`❌ Slack Bot API post failed: ${err.message}`);
    }
  }

  if (!SLACK_WEBHOOK_URL && !SLACK_BOT_TOKEN) {
    console.log("💡 (Note: Set SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN environment variables to post directly to Slack!)");
  }
}

async function main() {
  const postContent = await generateWithGemini(userPrompt);
  await postToSlack(postContent);
}

main();