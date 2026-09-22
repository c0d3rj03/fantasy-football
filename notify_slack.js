const fs = require('fs');
const path = require('path');
const https = require('https');

// Extract argument (e.g., process.argv[2] -> 'pbr/gemmy_week_2.md')
const targetArg = process.argv[2] || 'pbr/gemmy_week_2.md';
const filePath = path.isAbsolute(targetArg) 
  ? targetArg 
  : path.join(process.cwd(), targetArg);

if (!fs.existsSync(filePath)) {
  console.error(`❌ Error: File '${filePath}' not found at ${filePath}`);
  process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');
const webhookUrl = process.env.SLACK_WEBHOOK_URL;

if (!webhookUrl) {
  console.error("❌ Error: SLACK_WEBHOOK_URL environment variable is missing.");
  process.exit(1);
}

const payload = JSON.stringify({ text: content });
const url = new URL(webhookUrl);

const options = {
  hostname: url.hostname,
  path: url.pathname + url.search,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = https.request(options, (res) => {
  console.log(`✅ Slack Webhook Response Status: ${res.statusCode}`);
});

req.on('error', (e) => {
  console.error(`❌ Error posting to Slack: ${e.message}`);
});

req.write(payload);
req.end();
