// Posts to PBR Slack #officialcomms: bot token first, the webhook only as a fallback (so a post never goes out twice).
// Shared by generate_post.js (Gemmy's recap) and this script's CLI, which posts a file exactly as written.
//
// CLI: node slack_post.js <file> [--as <name>] [--icon <:emoji:>] [--link-label <text>] [--dry-run]
//   Adds the @channel + dashboard-link header and owner @mentions (slack_mentions.js), then posts.
//   --as / --icon set the poster's display name and icon; Slack applies them only if the bot has
//   chat:write.customize, otherwise the post goes out under the bot's own name.
//   --dry-run prints the final Slack text without posting.
// Env: SLACK_BOT_TOKEN + PBR_SLACK_CHANNEL_OFFICIALCOMMS, falling back to SLACK_WEBHOOK_URL; PBR_SLACK_OWNERS.
const fs = require('fs');
const path = require('path');
const { addMentions, withChannelHeader, teamNamesFrom } = require('./slack_mentions.js');

async function postMessage(token, params) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(params)
  });
  return res.json();
}

/** Returns 'bot' or 'webhook' for the route that worked, or null. */
async function postToOfficialComms(text, { username, iconEmoji } = {}) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.PBR_SLACK_CHANNEL_OFFICIALCOMMS;
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (token && channel) {
    try {
      const custom = { ...(username ? { username } : {}), ...(iconEmoji ? { icon_emoji: iconEmoji } : {}) };
      let data = await postMessage(token, { channel, text, mrkdwn: true, ...custom });
      if (!data.ok && Object.keys(custom).length && data.error === 'missing_scope') {
        console.warn(`⚠️ Bot can't post under a custom name (needs ${data.needed}); posting under its own name.`);
        data = await postMessage(token, { channel, text, mrkdwn: true });
      }
      if (data.ok) return 'bot';
      // missing_scope names the scope the Slack app needs (chat:write to post).
      const scopes = data.needed ? ` (needs scope ${data.needed}; token has ${data.provided || 'none'})` : '';
      console.warn(`⚠️ Slack chat.postMessage failed: ${data.error}${scopes}`);
    } catch (e) {
      console.warn(`⚠️ Slack chat.postMessage failed: ${e.message}`);
    }
  }
  if (webhook) {
    const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (res.ok) return 'webhook';
    console.warn(`⚠️ Slack webhook failed: HTTP ${res.status}`);
  }
  return null;
}

module.exports = { postToOfficialComms };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const opt = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
    const dryRun = args.includes('--dry-run');
    const username = opt('--as');
    const iconEmoji = opt('--icon');
    const linkLabel = opt('--link-label');
    const file = args.filter(a => a !== '--dry-run')[0];
    if (!file) throw new Error('Usage: node slack_post.js <file> [--as <name>] [--icon <:emoji:>] [--link-label <text>] [--dry-run]');

    const body = fs.readFileSync(path.resolve(file), 'utf8').trim();
    if (!body) throw new Error(`${file} is empty`);
    const pbrData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
    const text = withChannelHeader(addMentions(body, teamNamesFrom(pbrData)), linkLabel);
    console.log(`${text}\n`);
    if (dryRun) return console.log('Dry run: not posted.');
    const via = await postToOfficialComms(text, { username, iconEmoji });
    if (!via) throw new Error('Could not post to Slack (no working bot token/channel or webhook)');
    console.log(`Posted to #officialcomms via ${via}.`);
  })().catch(err => { console.error(`❌ ${err.message}`); process.exit(1); });
}
