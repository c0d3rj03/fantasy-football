const fs = require('fs');
const https = require('https');

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

if (!WEBHOOK_URL) {
  console.log("No SLACK_WEBHOOK_URL set. Skipping Slack notification.");
  process.exit(0);
}

const POST_FILE = 'gemmy_post.txt';

if (!fs.existsSync(POST_FILE)) {
  console.log(`Error: ${POST_FILE} not found. Please create the post file first.`);
  process.exit(1);
}

const messageText = fs.readFileSync(POST_FILE, 'utf8');
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