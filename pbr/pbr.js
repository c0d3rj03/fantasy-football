// ===========================================================================
// PREMIER BATTLE ROYALE (PBR) DASHBOARD CONTROLLER (pbr.js)
// ===========================================================================

console.log("=== PBR.JS CONTROLLER INITIALIZING ===");

const SLACK_EMOJI_MAP = {
  ':toilet:': '🚽', ':trophy:': '🏆', ':fire:': '🔥', ':football:': '🏈', ':crown:': '👑',
  ':poop:': '💩', ':shit:': '💩', ':robot_face:': '🤖', ':robot:': '🤖', ':skull:': '💀',
  ':eyes:': '👀', ':gem:': '💎', ':100:': '💯', ':clown_face:': '🤡', ':clown:': '🤡',
  ':chart_with_upwards_trend:': '📈', ':chart_with_downwards_trend:': '📉', ':clap:': '👏',
  ':boom:': '💥', ':star:': '⭐', ':sunglasses:': '😎', ':muscle:': '💪', ':moneybag:': '💰',
  ':beer:': '🍺', ':beers:': '🍻', ':shrug:': '🤷', ':facepalm:': '🤦', ':warning:': '⚠️',
  ':zap:': '⚡', ':ghost:': '👻', ':dart:': '🎯', ':rocket:': '🚀', ':loudspeaker:': '📢',
  ':microphone:': '🎙️', ':check:': '✅', ':x:': '❌', ':white_check_mark:': '✅',
  ':heavy_check_mark:': '✔️', ':thinking_face:': '🤔', ':thinking:': '🤔', ':laughing:': '😆',
  ':joy:': '😂', ':rofl:': '🤣', ':sob:': '😭', ':grimacing:': '😬', ':saluting_face:': '🫡',
  ':raised_hands:': '🙌', ':folded_hands:': '🙏', ':pray:': '🙏', ':wave:': '👋',
  ':thumbsup:': '👍', ':thumbsdown:': '👎', ':+1:': '👍', ':-1:': '👎'
};

function parseSlackMarkdown(text) {
  if (!text) return '<p class="italic text-slate-400">No recap recorded for this week yet.</p>';
  let cleanText = text.replace(/:[a-zA-Z0-9_\+\-]+:/g, (match) => SLACK_EMOJI_MAP[match] || match);
  return cleanText
    .replace(/^###\s?(.*)$/gm, '<h3 class="text-sm font-extrabold text-amber-400 mt-3 mb-1">$1</h3>')
    .replace(/^##\s?(.*)$/gm, '<h2 class="text-base font-black text-amber-300 mt-4 mb-2 border-b border-slate-800 pb-1">$1</h2>')
    .replace(/\*(.*?)\*/g, '<strong class="text-white font-bold">$1</strong>')
    .replace(/_(.*?)_/g, '<em class="text-slate-300 italic">$1</em>')
    .replace(/^>\s?(.*)$/gm, '<blockquote class="border-l-4 border-amber-500/70 bg-slate-800/40 px-3 py-1.5 rounded-r italic text-slate-300 my-2">$1</blockquote>')
    .replace(/^[•\-]\s?(.*)$/gm, '<div class="flex items-start gap-2 ml-1 my-1"><span class="text-amber-400">•</span><span>$1</span></div>')
    .replace(/\n/g, '<br>');
}

function updateRecapButtonText() {
  const currentW = (typeof selectedWeek !== 'undefined') ? selectedWeek : (typeof currentWeek !== 'undefined' ? currentWeek : "1");
  const btnText = document.getElementById('recap-btn-text');
  if (btnText) {
    btnText.textContent = `View Gemmy's Week ${currentW} Recap`;
  }
}

function openRecapModal() {
  const currentW = (typeof selectedWeek !== 'undefined') ? selectedWeek : (typeof currentWeek !== 'undefined' ? currentWeek : "1");
  const modal = document.getElementById('recap-modal');
  const title = document.getElementById('recap-modal-title');
  const body = document.getElementById('recap-modal-body');
  const wObj = leagueData?.weekly_data?.[currentW];
  const rawRecap = wObj?.recap || '';

  if (title) title.textContent = `Gemmy's Week ${currentW} Breakdown`;
  if (body) body.innerHTML = parseSlackMarkdown(rawRecap);
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
}

function closeRecapModal() {
  const modal = document.getElementById('recap-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

function setupModalListeners() {
  document.getElementById('recap-btn')?.addEventListener('click', openRecapModal);
  document.getElementById('close-recap-modal')?.addEventListener('click', closeRecapModal);
  document.getElementById('close-recap-modal-btn')?.addEventListener('click', closeRecapModal);
  document.getElementById('close-recap-x')?.addEventListener('click', closeRecapModal);
  document.getElementById('recap-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('recap-modal')) closeRecapModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeRecapModal();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupModalListeners);
} else {
  setupModalListeners();
}
