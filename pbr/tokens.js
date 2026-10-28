// ===========================================================================
// PREMIER BATTLE ROYALE (PBR) - TOKEN TRACKER CONTROLLER (tokens.js)
// Reads tokens_data.json (written daily by token_tracker.js) and, for the
// values tab, ktc-values/KTC-YYYY-MM.json.
// ===========================================================================

let tokensData = null;
let currentTab = 'summary';
let selectedMonth = null;
let playerSearchQuery = '';
const snapshotCache = {};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => (n || 0).toLocaleString();
const PERIOD_IDS = ['Offseason', 'Q1', 'Q2', 'Q3', 'Post'];
const periodLabel = id => tokensData?.periods?.find(p => p.id === id)?.label || id;
const card = 'bg-slate-900/90 border border-slate-800 rounded-2xl shadow-2xl';
const emptyBox = text => `<div class="p-8 ${card} text-center text-slate-400 italic">${text}</div>`;

// ---------------------------------------------------------------------------
// 1. DATA LOADING
// ---------------------------------------------------------------------------
async function initTokensPage() {
  try {
    const response = await fetch('tokens_data.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    tokensData = await response.json();
    selectedMonth = (tokensData.ktc_months || []).slice(-1)[0] || null;
    renderTokenPage();
  } catch (err) {
    console.error('Failed to load tokens data:', err);
    document.getElementById('tokens-content').innerHTML = `
      <div class="p-6 bg-red-950/40 border border-red-800/60 rounded-2xl text-red-300 text-center">
        ⚠️ Failed to load <code>tokens_data.json</code>.
      </div>`;
  }
}

// ---------------------------------------------------------------------------
// 2. TAB SWITCHER
// ---------------------------------------------------------------------------
function switchTab(tabName) {
  currentTab = tabName;
  ['tab-summary', 'tab-trades', 'tab-waivers', 'tab-values'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const isActive = id === `tab-${tabName}`;
    btn.className = `px-4 py-2 text-xs font-black rounded-xl transition-all shadow-md cursor-pointer ${
      isActive
        ? 'bg-amber-500 text-slate-950 border border-amber-400 scale-105'
        : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
    }`;
  });
  renderTokenPage();
}

function renderTokenPage() {
  const container = document.getElementById('tokens-content');
  if (!container || !tokensData) return;
  if (currentTab === 'summary') renderSummary(container);
  else if (currentTab === 'trades') renderTrades(container);
  else if (currentTab === 'waivers') renderWaivers(container);
  else if (currentTab === 'values') renderValues(container);
}

// ---------------------------------------------------------------------------
// 3. SUMMARY: balances, by-quarter breakdown, promotions, adjustments
// ---------------------------------------------------------------------------
function renderSummary(container) {
  const rules = tokensData.rules || {};
  const teams = Object.values(tokensData.teams || {}).sort((a, b) => b.total - a.total);
  const circulating = teams.reduce((s, t) => s + t.total, 0);

  const rows = teams.map((t, i) => {
    const odds = circulating ? ((t.total / circulating) * 100).toFixed(1) : '0.0';
    return `
      <tr class="border-t border-slate-800/80 hover:bg-slate-800/30 transition">
        <td class="py-2.5 px-3 text-xs font-bold text-slate-200"><span class="font-mono text-slate-500 text-[10px] mr-1.5">${i + 1}.</span>${esc(t.name)}</td>
        <td class="py-2.5 px-3 text-xs text-right font-mono text-slate-400">${t.start}</td>
        <td class="py-2.5 px-3 text-xs text-right font-mono text-emerald-400">+${t.trades}</td>
        <td class="py-2.5 px-3 text-xs text-right font-mono text-cyan-400">+${t.waivers}</td>
        <td class="py-2.5 px-3 text-xs text-right font-mono text-amber-300">+${t.promotions}</td>
        <td class="py-2.5 px-3 text-xs text-right font-mono text-slate-300">${t.adjustments >= 0 ? '+' : ''}${t.adjustments}</td>
        <td class="py-2.5 px-3 text-sm text-right font-black text-amber-400 font-mono">${t.total}</td>
        <td class="py-2.5 px-3 text-xs text-right font-bold text-emerald-300 font-mono">${odds}%</td>
      </tr>`;
  }).join('');

  // Tokens earned per period (trades + waivers + promotions + adjustments).
  const periodRows = teams.map(t => `
    <tr class="border-t border-slate-800/80">
      <td class="py-2 px-3 text-xs font-bold text-slate-200">${esc(t.name)}</td>
      ${PERIOD_IDS.map(p => {
        const b = t.by_period?.[p] || {};
        const n = (b.trades || 0) + (b.waivers || 0) + (b.promotions || 0) + (b.adjustments || 0);
        const detail = `Trades ${b.trades || 0} · Waivers ${b.waivers || 0} · Promotion ${b.promotions || 0} · Adj. ${b.adjustments || 0}`;
        return `<td class="py-2 px-3 text-xs text-right font-mono ${n ? 'text-amber-300 font-bold' : 'text-slate-600'}" title="${esc(detail)}">${n || '–'}</td>`;
      }).join('')}
    </tr>`).join('');

  const promos = tokensData.promotions || [];
  const adjustments = tokensData.adjustments || [];
  const extraList = [
    ...promos.map(p => `<li>📈 Q${p.quarter}: <b>${esc(p.name)}</b> promoted ${esc(p.from)} → ${esc(p.to)} <span class="text-amber-300 font-mono">+${p.tokens}</span></li>`),
    ...adjustments.map(a => `<li>✍️ ${esc(a.date)}: <b>${esc(a.name)}</b> <span class="text-amber-300 font-mono">${a.tokens >= 0 ? '+' : ''}${a.tokens}</span> — ${esc(a.reason)}</li>`)
  ];

  container.innerHTML = `
    <div class="space-y-6">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <div class="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Tokens</div>
          <div class="text-2xl font-black text-amber-400 mt-1 font-mono">${circulating} 🎟️</div>
          <div class="text-[11px] text-slate-500 mt-1">Updated ${new Date(tokensData.last_updated).toLocaleString()}</div>
        </div>
        <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <div class="text-xs font-bold text-slate-400 uppercase tracking-wider">How Tokens Are Earned</div>
          <div class="text-[11px] text-slate-300 mt-1 leading-relaxed">
            Waiver claims of $${rules.waiver_min_bid ?? 25}+: 1 each (max ${rules.waiver_quarter_cap ?? 5} per quarter)<br>
            Trades: 2 each per ${num(rules.trade_tier_size ?? 7500)} combined KTC value (2, 4, 6…)<br>
            Promotions: Middle→Upper 1/2/3, Lower→Middle 1/3/5 (Q1/Q2/Q3)
          </div>
        </div>
        <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <div class="text-xs font-bold text-slate-400 uppercase tracking-wider">Token Draw</div>
          <div class="text-[11px] text-slate-300 mt-1 leading-relaxed">After the postseason. Commit at least 50% of your tokens (minimum 1). Odds below assume every team commits the same share.</div>
        </div>
      </div>

      <div class="${card} overflow-hidden">
        <div class="px-5 py-3.5 border-b border-slate-800">
          <h2 class="text-sm font-black text-amber-400 uppercase tracking-wide">🎟️ ${esc(tokensData.season)} Franchise Token Ledger</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead>
              <tr class="text-[10px] font-extrabold text-slate-400 uppercase bg-slate-950 border-b border-slate-800">
                <th class="py-2 px-3">Franchise</th><th class="py-2 px-3 text-right">Start</th><th class="py-2 px-3 text-right">Trades</th>
                <th class="py-2 px-3 text-right">Waivers</th><th class="py-2 px-3 text-right">Promotions</th><th class="py-2 px-3 text-right">Adj.</th>
                <th class="py-2 px-3 text-right">Tokens</th><th class="py-2 px-3 text-right">Draw Odds</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>

      <div class="${card} overflow-hidden">
        <div class="px-5 py-3.5 border-b border-slate-800">
          <h2 class="text-sm font-black text-amber-400 uppercase tracking-wide">🗓️ Tokens Earned by Period</h2>
          <div class="text-[11px] text-slate-500 mt-0.5">Hover a number for the breakdown. Offseason trades are paid with Q1.</div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead>
              <tr class="text-[10px] font-extrabold text-slate-400 uppercase bg-slate-950 border-b border-slate-800">
                <th class="py-2 px-3">Franchise</th>${PERIOD_IDS.map(p => `<th class="py-2 px-3 text-right">${esc(periodLabel(p))}</th>`).join('')}
              </tr>
            </thead>
            <tbody>${periodRows}</tbody>
          </table>
        </div>
      </div>

      ${extraList.length ? `
      <div class="${card} p-5">
        <h2 class="text-sm font-black text-amber-400 uppercase tracking-wide mb-2">🏅 Promotions & Adjustments</h2>
        <ul class="text-xs text-slate-300 space-y-1">${extraList.join('')}</ul>
      </div>` : ''}
    </div>`;
}

// ---------------------------------------------------------------------------
// 4. TRADES
// ---------------------------------------------------------------------------
function renderTrades(container) {
  const trades = tokensData.trades || [];
  if (!trades.length) {
    container.innerHTML = emptyBox(`No trades recorded for the ${esc(tokensData.season)} season yet.`);
    return;
  }

  const side = s => `
    <div class="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
      <div class="flex justify-between text-xs font-black mb-1.5">
        <span class="text-amber-300">${esc(s.name)} sent</span>
        <span class="font-mono text-slate-300">${num(s.value)}</span>
      </div>
      <ul class="text-xs text-slate-300 space-y-0.5">
        ${s.assets.map(a => `
          <li class="flex justify-between gap-3">
            <span>${esc(a.name)}${a.note ? ` <span class="text-[10px] text-rose-300">(${esc(a.note)})</span>` : ''}</span>
            <span class="font-mono text-slate-400">${num(a.value)}</span>
          </li>`).join('')}
      </ul>
    </div>`;

  const cards = trades.map(t => {
    const badge = t.voided
      ? `<span class="text-xs px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-black" title="${esc(t.void_reason)}">Voided: no tokens</span>`
      : `<span class="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-black">+${t.tokens_awarded} Tokens Each</span>`;
    return `
      <div class="${card} p-4 space-y-3 ${t.voided ? 'opacity-70' : ''}">
        <div class="flex flex-wrap justify-between items-center gap-2 border-b border-slate-800 pb-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-slate-400 font-mono">${esc(t.date)}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold">${esc(periodLabel(t.period))}</span>
            ${badge}
          </div>
          <div class="text-xs font-black text-amber-400 font-mono">Combined KTC: ${num(t.total_value)} <span class="text-slate-500 font-normal">(${esc(t.ktc_month)} values)</span></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${t.sides.map(side).join('')}</div>
        ${t.voided ? `<div class="text-[11px] text-rose-300">${esc(t.void_reason)}</div>` : ''}
        ${t.comments ? `<div class="text-[11px] text-slate-400 italic">💬 ${esc(t.comments)}</div>` : ''}
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="space-y-4">
      <div class="flex justify-between items-center">
        <h2 class="text-sm font-black text-amber-400 uppercase tracking-wide">⚔️ Trades & Token Awards</h2>
        <span class="text-xs text-slate-400">${trades.length} trades · FAAB counts $1 = 10 KTC</span>
      </div>
      ${cards}
    </div>`;
}

// ---------------------------------------------------------------------------
// 5. WAIVERS
// ---------------------------------------------------------------------------
function renderWaivers(container) {
  const waivers = tokensData.waivers || [];
  const min = tokensData.rules?.waiver_min_bid ?? 25;
  if (!waivers.length) {
    container.innerHTML = emptyBox(`No waiver claims of $${min}+ for the ${esc(tokensData.season)} season yet.`);
    return;
  }

  const rows = waivers.map(w => `
    <tr class="border-t border-slate-800/80 hover:bg-slate-800/30 transition">
      <td class="py-2.5 px-3 text-xs font-mono text-slate-400">${esc(w.date)}</td>
      <td class="py-2.5 px-3 text-xs text-slate-400">${esc(periodLabel(w.period))}</td>
      <td class="py-2.5 px-3 text-xs font-bold text-slate-200">${esc(w.name)}</td>
      <td class="py-2.5 px-3 text-xs font-black text-amber-300">${esc(w.player)}${w.dropped ? `<div class="text-[10px] font-normal text-slate-500">dropped ${esc(w.dropped)}</div>` : ''}</td>
      <td class="py-2.5 px-3 text-xs text-right font-mono font-bold text-cyan-400">$${w.bid}</td>
      <td class="py-2.5 px-3 text-xs text-right font-mono font-black ${w.tokens ? 'text-emerald-400' : 'text-slate-500'}">
        ${w.tokens ? `+${w.tokens}` : '0'}${w.note ? `<div class="text-[10px] font-normal text-rose-300">${esc(w.note)}</div>` : ''}
      </td>
    </tr>`).join('');

  container.innerHTML = `
    <div class="${card} overflow-hidden">
      <div class="px-5 py-3.5 border-b border-slate-800 flex justify-between items-center">
        <h2 class="text-sm font-black text-amber-400 uppercase tracking-wide">⚡ Waiver Claims of $${min}+ (1 Token, Max ${tokensData.rules?.waiver_quarter_cap ?? 5}/Quarter)</h2>
        <span class="text-xs text-slate-400">${waivers.length} claims</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead>
            <tr class="text-[10px] font-extrabold text-slate-400 uppercase bg-slate-950 border-b border-slate-800">
              <th class="py-2 px-3">Date</th><th class="py-2 px-3">Period</th><th class="py-2 px-3">Franchise</th>
              <th class="py-2 px-3">Player Added</th><th class="py-2 px-3 text-right">Bid</th><th class="py-2 px-3 text-right">Tokens</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// 6. MONTHLY KTC VALUES (the snapshot each month's trades are valued with)
// ---------------------------------------------------------------------------
async function loadSnapshot(month) {
  if (!snapshotCache[month]) {
    const res = await fetch(`ktc-values/KTC-${month}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const seen = new Set();
    snapshotCache[month] = (await res.json())
      .map(p => ({
        name: p.name || p.playerName || '',
        pos: p.position || '',
        team: p.team || '',
        value: Number(p['sf-tep-value'] ?? p.superflexValues?.tep?.value ?? 0)
      }))
      .filter(p => p.name && !seen.has(`${p.name}|${p.pos}`) && seen.add(`${p.name}|${p.pos}`))
      .sort((a, b) => b.value - a.value);
  }
  return snapshotCache[month];
}

async function renderValues(container) {
  const months = [...(tokensData.ktc_months || [])].reverse();
  if (!selectedMonth) {
    container.innerHTML = emptyBox('No KTC snapshots saved yet.');
    return;
  }

  let list;
  try {
    list = await loadSnapshot(selectedMonth);
  } catch (err) {
    container.innerHTML = emptyBox(`Could not load KTC-${esc(selectedMonth)}.json.`);
    return;
  }
  if (currentTab !== 'values') return;

  const q = playerSearchQuery.trim().toLowerCase();
  const shown = q
    ? list.filter(p => p.name.toLowerCase().includes(q) || p.pos.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
    : list;

  const rows = shown.slice(0, 600).map((p, i) => {
    const isPick = p.pos === 'RDP';
    return `
      <tr class="border-t border-slate-800/80 hover:bg-slate-800/30 transition ${isPick ? 'bg-amber-500/5' : ''}">
        <td class="py-2 px-3 text-xs text-slate-500 font-mono w-12">${i + 1}</td>
        <td class="py-2 px-3 text-xs font-bold ${isPick ? 'text-amber-300' : 'text-slate-100'}">${esc(p.name)}</td>
        <td class="py-2 px-3 text-xs"><span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold ${isPick ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-300'}">${isPick ? 'PICK' : esc(p.pos)}</span></td>
        <td class="py-2 px-3 text-xs font-mono text-slate-400">${isPick ? '' : esc(p.team)}</td>
        <td class="py-2 px-3 text-xs text-right font-black font-mono text-amber-400">${num(p.value)}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-col md:flex-row items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg">
        <div class="flex items-center gap-3 w-full md:w-auto">
          <label for="snapshot-month" class="text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0">Month:</label>
          <select id="snapshot-month" class="bg-slate-800 text-slate-200 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold w-full md:w-auto">
            ${months.map(m => `<option value="${esc(m)}" ${m === selectedMonth ? 'selected' : ''}>${esc(m)}</option>`).join('')}
          </select>
        </div>
        <input type="text" id="player-search" placeholder="Search player, position or team…" value="${esc(playerSearchQuery)}"
          class="w-full md:w-72 bg-slate-800 text-slate-100 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-semibold placeholder-slate-500" />
      </div>
      <div class="${card} overflow-hidden">
        <div class="px-5 py-3 border-b border-slate-800 flex justify-between items-center">
          <h2 class="text-sm font-black text-amber-400 uppercase tracking-wide">📈 KTC Superflex TE-Premium Values (${esc(selectedMonth)})</h2>
          <span class="text-xs text-slate-400">${shown.length} entries</span>
        </div>
        <div class="overflow-x-auto max-h-[650px] overflow-y-auto">
          <table class="w-full text-left border-collapse">
            <thead class="sticky top-0 z-10 bg-slate-950 border-b border-slate-800">
              <tr class="text-[10px] font-extrabold text-slate-400 uppercase">
                <th class="py-2.5 px-3">#</th><th class="py-2.5 px-3">Player / Pick</th><th class="py-2.5 px-3">Pos</th>
                <th class="py-2.5 px-3">Team</th><th class="py-2.5 px-3 text-right">KTC Value</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="5" class="py-8 text-center text-xs text-slate-500 italic">No matches.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>`;

  document.getElementById('snapshot-month').addEventListener('change', e => {
    selectedMonth = e.target.value;
    renderValues(container);
  });
  const search = document.getElementById('player-search');
  search.addEventListener('input', e => {
    playerSearchQuery = e.target.value;
    renderValues(container).then(() => {
      const el = document.getElementById('player-search');
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  });
}

document.addEventListener('DOMContentLoaded', initTokensPage);
