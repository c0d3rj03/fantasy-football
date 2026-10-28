// Which Gemini model should Gemmy use? Lists the models this API key can call and times each
// candidate on the real recap prompt for the latest played week. Prints timings only, never the key.
//
// Usage: node gemini_check.js [model,model,...]
//   No argument: tries every "flash" model the key lists that supports generateContent.
// Env: GEMINI_API_KEY (required), GEMINI_TIMEOUT_MS (default 90000)
const fs = require('fs');
const path = require('path');
const { buildWeekSummary, buildPrompt, latestPlayedWeek } = require('./generate_post.js');
const { API, listGenerateModels, newestFlashModels } = require('./gemini_models.js');

const KEY = process.env.GEMINI_API_KEY;
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 90000);

async function timeModel(model, prompt) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
      signal: controller.signal
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { model, seconds, result: `HTTP ${res.status} ${body?.error?.status || ''} ${(body?.error?.message || '').slice(0, 80)}` };
    const text = body?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    const usage = body?.usageMetadata || {};
    return { model, seconds, result: `OK ${text.length} chars, ${usage.promptTokenCount || '?'} in / ${usage.candidatesTokenCount || '?'} out tokens`, text };
  } catch (err) {
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    return { model, seconds, result: err.name === 'AbortError' ? `TIMEOUT after ${TIMEOUT_MS / 1000}s` : err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (!KEY) throw new Error('GEMINI_API_KEY environment variable missing');

  const available = await listGenerateModels(KEY);
  console.log(`Models this key can call (generateContent): ${available.length}`);
  available.forEach(m => console.log(`  ${m}`));
  console.log(`Gemmy's automatic fallback order (gemini_models.js): ${newestFlashModels(available).join(', ') || '(none)'}`);

  const requested = (process.argv[2] || '').split(',').map(s => s.trim()).filter(Boolean);
  const candidates = requested.length ? requested : available.filter(m => /flash/.test(m) && !/(tts|image|audio|live|embedding)/.test(m));

  const pbrData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const week = latestPlayedWeek(pbrData);
  const prompt = buildPrompt(buildWeekSummary(pbrData, week), ['(banter omitted for this test)'], '');
  console.log(`\nTiming ${candidates.length} model(s) on the Week ${week} recap prompt (${prompt.length} chars), ${TIMEOUT_MS / 1000}s timeout each:\n`);

  const results = [];
  for (const model of candidates) {
    const r = await timeModel(model, prompt);
    console.log(`${r.model.padEnd(36)} ${String(r.seconds).padStart(6)}s  ${r.result}`);
    results.push(r);
  }

  const best = results.filter(r => r.text).sort((a, b) => a.seconds - b.seconds)[0];
  if (best) {
    console.log(`\nFastest working model: ${best.model}. Sample of its recap:\n\n${best.text.slice(0, 1200)}\n`);
    console.log('To use it, set GEMINI_MODEL (comma-separated fallbacks allowed), e.g. a repo variable PBR_GEMINI_MODEL.');
  } else {
    console.log('\nNo model returned a recap.');
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('❌', err.message);
  process.exitCode = 1;
});
