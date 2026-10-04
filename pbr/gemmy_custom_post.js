/**
 * Gemmy Custom League Announcer (gemmy_custom_post.js)
 * 
 * Generates dynamic, AI-powered snarky announcements using the Gemini API!
 * 
 * Usage:
 *   node gemmy_custom_post.js "remind the league about Sunday's early Europe game to get their lineups started"
 * 
 * Env Variables:
 *   GEMINI_API_KEY    - Google Gemini API Key (for dynamic AI generation)
 *   SLACK_WEBHOOK_URL - Slack Incoming Webhook URL
 *   SLACK_BOT_TOKEN   - Slack Bot Token (xoxb-...)
 *   SLACK_CHANNEL     - Slack Channel ID (defaults to #commish-actions)
 */

const fs = require('fs');
const path = require('path');

const userPrompt = process.argv[2];

if (!userPrompt) {
  console.log(`
❌ Missing message topic!

Usage:
  node gemmy_custom_post.js "<topic or reminder prompt>"

Example:
  node gemmy_custom_post.js "remind the league about Sunday's early Europe game to get their lineups started"
`);
  process.exit(1);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL = process.env.SLACK_CHANNEL || 'C0C6N8RTD5J'; // #commish-actions or main

/**
 * Generate a dynamic snarky message using Google's Gemini API
 */
async function generateAiGemmyMessage(prompt) {
  console.log("✨ Calling Gemini API for dynamic, AI-generated snark...");
  
  const systemInstruction = 
    "You are Gemmy, the witty, snarky, sarcastic, yet helpful AI assistant commissioner for the Premier Battle Royale (PBR) dynasty fantasy football league.\n" +
    "Your persona: Confident, passive-aggressive, humorous, and entertaining. You speak directly to fantasy football managers.\n" +
    "Formatting rules for Slack:\n" +
    "- Use Slack markdown formatting (*bold* for strong text, _italics_ for emphasis, > for quotes).\n" +
    "- Start with a catchy headline with emojis (e.g., 📢 *Gemmy Public Service Announcement* 💅).\n" +
    "- Keep the message punchy and engaging (2 short paragraphs max).\n" +
    "- End with a witty, snarky sign-off warning managers or teasing their fantasy skills.\n" +
    "- Do NOT output markdown code fences (```) around the final text.";

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemInstruction}\n\nTask: Write a custom league announcement based on this topic: "${prompt}"` }]
          }
        ],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 500
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API returned HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (candidateText) {
      return candidateText.trim();
    } else {
      throw new Error("No text content returned from Gemini API.");
    }
  } catch (err) {
    console.warn(`⚠️ AI Generation failed (${err.message}). Falling back to template mode.`);
    return generateFallbackMessage(prompt);
  }
}

/**
 * Fallback message generator if no GEMINI_API_KEY is provided or API is unreachable
 */
function generateFallbackMessage(prompt) {
  const p = prompt.toLowerCase();
  let intro = "📢 *Gemmy Public Service Announcement* 💅\n\n";
  let body = "";
  let outro = "\n\n_Don't blame me when you lose points from the bench. You've been warned._ ☕";

  if (p.includes('europe') || p.includes('early') || p.includes('london') || p.includes('germany') || p.includes('sunday')) {
    body = `Hey managers, friendly reminder from your favorite automated commissioner assistant: **There is an EARLY EUROPE GAME tomorrow morning!** 🏈🇪🇺\n\n` +
           `Set your lineups **NOW** before you wake up at noon with a starting QB on your bench and zero points in your matchup. I know some of you love leaving free points on the table, but let's at least try to pretend this is a competitive league. ⏰💥`;
  } else {
    body = `Hey managers: **${prompt}** 🏈✨\n\n` +
           `Just making sure everyone stays on top of their business so I don't have to clean up any messes later. Let's keep it moving! 🚀`;
  }

  return `${intro}${body}${outro}`;
}

async function run() {
  let messageText = "";

  if (GEMINI_API_KEY) {
    messageText = await generateAiGemmyMessage(userPrompt);
  } else {
    console.log("💡 No GEMINI_API_KEY detected in env. Using smart template fallback.");
    console.log("   (Add GEMINI_API_KEY to your GitHub Secrets / .env for 100% dynamic AI generation!)\n");
    messageText = generateFallbackMessage(userPrompt);
  }

  console.log("🤖 Gemmy Post Output:\n");
  console.log("--------------------------------------------------");
  console.log(messageText);
  console.log("--------------------------------------------------\n");

  if (SLACK_WEBHOOK_URL) {
    try {
      const res = await fetch(SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: messageText })
      });
      if (res.ok) {
        console.log("✅ Successfully posted to Slack via Webhook!");
        return;
      } else {
        console.warn(`⚠️ Webhook returned HTTP ${res.status}`);
      }
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
        body: JSON.stringify({
          channel: SLACK_CHANNEL,
          text: messageText
        })
      });
      const data = await res.json();
      if (data.ok) {
        console.log(`✅ Successfully posted to Slack channel (${SLACK_CHANNEL}) via Bot API!`);
        return;
      } else {
        console.warn(`⚠️ Slack API Error: ${data.error}`);
      }
    } catch (err) {
      console.error(`❌ Slack Bot API post failed: ${err.message}`);
    }
  }

  if (!SLACK_WEBHOOK_URL && !SLACK_BOT_TOKEN) {
    console.log("💡 (Note: Set SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN environment variables to post directly to Slack!)");
  }
}

run();
