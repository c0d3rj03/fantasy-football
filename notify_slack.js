const fs = require('fs');
const https = require('https');

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

if (!WEBHOOK_URL) {
  console.log("No SLACK_WEBHOOK_URL set. Skipping Slack notification.");
  process.exit(0);
}

// Grab file path from command line arg: node notify_slack.js pbr/gemmy_week_1.md
const targetFile = process.argv[2] || 'gemmy_post.txt';

if (!fs.existsSync(targetFile)) {
  console.error(`Error: File '${targetFile}' not found.`);
  process.exit(1);
}

const messageText = fs.readFileSync(targetFile, 'utf8');
const payload = JSON.stringify({ text: messageText });
const url = new URL(WEBHOOK_URL);

const req = https.request({
  hostname: url.hostname,
  path: url.pathname + url.search,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, res => {
  console.log(`Slack post delivered successfully! Status Code: ${res.statusCode}`);
});

req.on('error', console.error);
req.write(payload);
req.end();