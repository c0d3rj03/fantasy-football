const fs = require('fs');
const path = require('path');
const { WebClient } = require('@slack/web-api');

// ---------------------------------------------------------------------------
// FETCH RECAPS FROM SLACK #officialcomms AND UPDATE LOCAL DATA/MARKDOWN
// ---------------------------------------------------------------------------
async function syncRecapsFromSlack() {
  console.log("🎙️ Syncing Gemmy's Recaps from Slack #officialcomms...\n");

  const token = process.env.PBR_SLACK_BOT_TOKEN;
  const channelId = process.env.PBR_SLACK_CHANNEL_OFFICIALCOMMS;

  if (!token || !channelId) {
    console.error("❌ Missing PBR_SLACK_BOT_TOKEN or PBR_SLACK_CHANNEL_OFFICIALCOMMS environment variables.");
    process.exit(1);
  }

  const slack = new WebClient(token);

  try {
    // 1. Fetch channel message history
    const result = await slack.conversations.history({
      channel: channelId.trim(),
      limit: 50
    });

    if (!result.ok || !result.messages) {
      console.error("❌ Failed to fetch messages from Slack:", result.error);
      return;
    }

    // 2. Filter for Gemmy's weekly recap posts
    const messages = result.messages;
    console.log(`Found ${messages.length} recent messages in #officialcomms.`);

    const recapsFound = {};

    messages.forEach(msg => {
      const text = msg.text || '';
      // Look for Week indicators in Gemmy's posts
      const weekMatch = text.match(/Week\s+([1-9]|1[0-7])/i) || text.match(/PBR\s+Week\s+([1-9]|1[0-7])/i);
      
      if (weekMatch && (text.includes("Gemmy") || text.includes("PBR") || text.includes("Battle Royale") || text.includes("Victory Points"))) {
        const weekNum = weekMatch[1];
        if (!recapsFound[weekNum]) {
          // Clean up formatting: fix double asterisks (**bold** -> *bold* or HTML style)
          let cleanedText = text
            // Replace double asterisks with single asterisks for Slack standard bold
            .replace(/\*\*(.*?)\*\*/g, '*$1*')
            // Fix double space/newlines
            .replace(/\n{3,}/g, '\n\n');

          recapsFound[weekNum] = cleanedText;
          console.log(`✅ Identified Week ${weekNum} recap post!`);
        }
      }
    });

    // 3. Save Markdown files & update data.json
    const dataPath = path.join(__dirname, 'data.json');
    let leagueData = {};
    if (fs.existsSync(dataPath)) {
      leagueData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    }

    Object.entries(recapsFound).forEach(([weekNum, content]) => {
      // Save individual markdown file
      const mdPath = path.join(__dirname, `gemmy_week_${weekNum}.md`);
      fs.writeFileSync(mdPath, content);
      console.log(`📄 Saved clean recap to pbr/gemmy_week_${weekNum}.md`);

      // Store in data.json under weekly_data
      if (leagueData.weekly_data && leagueData.weekly_data[weekNum]) {
        leagueData.weekly_data[weekNum].recap = content;
      }
    });

    if (fs.existsSync(dataPath)) {
      fs.writeFileSync(dataPath, JSON.stringify(leagueData, null, 2));
      console.log(`\n💾 Updated data.json with embedded recaps for weeks: ${Object.keys(recapsFound).join(', ')}`);
    }

    console.log("\n🎉 Sync complete! You can now display these recaps on the dashboard.");

  } catch (err) {
    console.error("❌ Error fetching from Slack:", err.message);
  }
}

syncRecapsFromSlack();
