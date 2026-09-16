const fs = require('fs');
const https = require('https');

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.log("No GEMINI_API_KEY environment variable set. Skipping AI post generation.");
  process.exit(0);
}

if (!fs.existsSync('data.json')) {
  console.log("data.json not found. Skipping post generation.");
  process.exit(1);
}

const leagueData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const playedWeeks = Object.keys(leagueData.weekly_data || {}).filter(w => leagueData.weekly_data[w].played);

if (playedWeeks.length === 0) {
  console.log("No played weeks found in data.json.");
  process.exit(0);
}

const latestWeekKey = playedWeeks[playedWeeks.length - 1];
const weekObj = leagueData.weekly_data[latestWeekKey];

const systemPrompt = `
You are Gemmy, the official, undisputed queen and announcer of the Premier Battle Royale (PBR) fantasy football league.
You are female, sharp, factual, highly knowledgeable about fantasy football, and have a playful, snarky personality roasting 12 male managers (ages 30s-60s).
Clarify when needed that you are "Gemmy" and NOT "Jimmy" (owner of BattleBots, no relation).

Key Rules of PBR:
- Weekly High Score wins a $10 Cash Bounty (see bylaws). Always crown the Weekly Cash King first.
- Battle Royale: Top 2 scores in each division get +1 Victory Point (VP).
- Promotion & Relegation happens every 4 weeks (End of Q1, Q2, Q3).
- Lower Division is the basement/dungeon — teams can't get demoted from Lower, they fight for 1 promotion spot to Middle based on VPs.
- Upper & Middle Division teams get demoted after Week 4 based on having the lowest Potential Points (PP).
- A "Blue Pill Alert" or "Limp Lineup" joke is used when someone leaves massive PP (bench points) behind or falls behind in PP in Middle/Upper.

Given the weekly JSON data below, write a fun, formatted Slack message (using Slack markdown formatting like *bold*, _italics_, and emojis).
Return ONLY the raw Slack text message — no extra commentary, no code block backticks.
`;

const userPrompt = `Generate Gemmy's Slack recap for Week ${weekObj.week} (Quarter ${weekObj.quarter}) based on this data:\n${JSON.stringify(weekObj, null, 2)}`;

const postData = JSON.stringify({
  contents: [
    {
      role: 'user',
      parts: [{ text: systemPrompt + '\n\n' + userPrompt }]
    }
  ]
});

const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`);

const req = https.request({
  hostname: url.hostname,
  path: url.pathname + url.search,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
}, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    try {
      const response = JSON.parse(body);
      if (response.candidates && response.candidates && response.candidates.content) {
        const generatedText = response.candidates.content.parts.text;
        fs.writeFileSync('gemmy_post.txt', generatedText.trim());
        console.log("Successfully generated gemmy_post.txt via Gemini API!");
      } else {
        console.error("Unexpected response structure from Gemini API:", JSON.stringify(response));
        process.exit(1);
      }
    } catch (e) {
      console.error("Error parsing Gemini API response:", e, body);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error("HTTP Request Error:", err);
  process.exit(1);
});

req.write(postData);
req.end();
