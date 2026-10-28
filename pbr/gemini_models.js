// Which Gemini models Gemmy calls (the one place every PBR Gemini script gets them from).
//
// Google retires model names for new keys (gemini-2.5-flash answered 404 on 2026-10-28), so
// besides GEMINI_MODEL (repo variable PBR_GEMINI_MODEL, comma-separated, tried first) the
// scripts ask the API which models this key can call and fall back to the newest stable
// "flash" ones. Pin GEMINI_MODEL only to keep a model the check (gemini_check.js) liked.
const API = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_COUNT = 3;

// Every model name the key can call with generateContent.
async function listGenerateModels(key) {
  const models = [];
  let pageToken = '';
  do {
    const res = await fetch(`${API}/models?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw new Error(`models.list HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    models.push(...(data.models || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return models
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''));
}

// Stable flash models (no preview/exp/dated suffix), newest version first, flash before flash-lite.
function newestFlashModels(names) {
  return names
    .map(name => ({ name, m: name.match(/^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/) }))
    .filter(x => x.m)
    .sort((a, b) => Number(b.m[1]) - Number(a.m[1]) || (a.m[2] ? 1 : 0) - (b.m[2] ? 1 : 0))
    .map(x => x.name);
}

function configuredModels() {
  return (process.env.GEMINI_MODEL || '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Models to try in order: GEMINI_MODEL first, then the newest stable flash models the key
 * lists. If listing fails, just GEMINI_MODEL.
 */
async function modelCandidates(key) {
  const configured = configuredModels();
  let discovered = [];
  try {
    discovered = newestFlashModels(await listGenerateModels(key)).filter(m => !configured.includes(m)).slice(0, FALLBACK_COUNT);
  } catch (err) {
    console.warn(`⚠️ Could not list Gemini models (${err.message}); using GEMINI_MODEL only.`);
  }
  const candidates = [...configured, ...discovered];
  if (candidates.length === 0) throw new Error('No Gemini model to try: set GEMINI_MODEL (repo variable PBR_GEMINI_MODEL) or check GEMINI_API_KEY.');
  return candidates;
}

module.exports = { API, listGenerateModels, newestFlashModels, modelCandidates };
