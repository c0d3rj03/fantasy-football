/**
 * Read-only Slack bot check (workflow pbr_slack_check.yml): shows the bot token's
 * scopes and whether the bot is in each PBR channel. Posts nothing; never logs
 * the token or channel IDs.
 */
const TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNELS = {
  officialcomms: process.env.PBR_SLACK_CHANNEL_OFFICIALCOMMS,
  general: process.env.PBR_SLACK_CHANNEL_GENERAL,
  random: process.env.PBR_SLACK_CHANNEL_RANDOM,
  'trade-talk': process.env.PBR_SLACK_CHANNEL_TRADE_TALK
};
// Posting recaps needs chat:write; reading banter needs the history scopes.
const NEEDED = ['chat:write', 'channels:history'];

async function slack(method, params = {}) {
  const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
  return { data: await res.json(), scopes: res.headers.get('x-oauth-scopes') || '' };
}

async function main() {
  if (!TOKEN) throw new Error('SLACK_BOT_TOKEN is not set.');
  const { data: auth, scopes } = await slack('auth.test');
  if (!auth.ok) throw new Error(`auth.test failed: ${auth.error}`);
  console.log(`Bot: ${auth.user} in workspace ${auth.team}`);
  console.log(`Scopes: ${scopes || '(none reported)'}`);
  const have = new Set(scopes.split(',').map(s => s.trim()));
  let problems = 0;
  for (const s of NEEDED) {
    const ok = have.has(s);
    if (!ok) problems++;
    console.log(`${ok ? '✅' : '❌'} scope ${s}`);
  }
  for (const [name, id] of Object.entries(CHANNELS)) {
    if (!id) { console.log(`⚠️ #${name}: channel secret not set`); continue; }
    const { data } = await slack('conversations.info', { channel: id });
    if (!data.ok) { problems++; console.log(`❌ #${name}: ${data.error}`); continue; }
    const member = data.channel.is_member;
    // Only #officialcomms is posted to, so only it must have the bot as a member.
    if (!member && name === 'officialcomms') problems++;
    console.log(`${member ? '✅' : (name === 'officialcomms' ? '❌' : '⚠️')} #${data.channel.name}: bot ${member ? 'is' : 'is NOT'} a member`);
  }
  if (problems > 0) throw new Error(`${problems} problem(s) found.`);
  console.log('Slack bot can post to #officialcomms.');
}

main().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
