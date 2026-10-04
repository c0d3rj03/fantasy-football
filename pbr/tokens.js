// ===========================================================================
// PREMIER BATTLE ROYALE (PBR) - TOKEN TRACKER CONTROLLER (tokens.js)
// ===========================================================================

let tokensData = null;
let currentTab = 'summary';
let selectedSnapshotDate = '2026-10-01';
let playerSearchQuery = '';

// ---------------------------------------------------------------------------\n// 1. DATA INITIALIZATION & FETCHING\n// ---------------------------------------------------------------------------\nasync function initTokensPage() {
  console.log("🎟️ Initializing PBR Tokens Page...");

  try {
    let response = await fetch('tokens_data.json').catch(() => null);
    if (!response || !response.ok) {
      response = await fetch('pbr/tokens_data.json');
    }

    tokensData = await response.json();
    console.log("✅ Token data loaded successfully:", tokensData);

    // Auto-select latest snapshot date available
    const snapshotDates = Object.keys(tokensData.monthly_player_values || {}).sort().reverse();
    if (snapshotDates.length > 0) {
      selectedSnapshotDate = snapshotDates[0];
    }

    renderTokenPage();
  } catch (err) {
    console.error("❌ Failed to load tokens data:", err);
    document.getElementById('tokens-content').innerHTML = `
      <div class="p-6 bg-red-950/40 border border-red-800/60 rounded-2xl text-red-300 text-center">
        ⚠️ Failed to load <code>tokens_data.json</code>. Ensure the file exists in your project directory.
      </div>
    `;
  }
}

// ---------------------------------------------------------------------------\n// 2. MAIN CONTROLLER & TAB SWITCHER\n// ---------------------------------------------------------------------------\nfunction switchTab(tabName) {
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
  if (!container) return;

  if (currentTab === 'summary') renderSummaryTracker(container);
  else if (currentTab === 'trades') renderTradesLog(container);
  else if (currentTab === 'waivers') renderWaiversLog(container);
  else if (currentTab === 'values') renderMonthlyValues(container);
}

// ---------------------------------------------------------------------------\n// 3. TAB 1: SUMMARY TRACKER VIEW\n// ---------------------------------------------------------------------------\nfunction renderSummaryTracker(container) {
  const teamsMap = tokensData?.teams || {};
  const teamsList = Object.values(teamsMap);

  // Calculate circulating tokens
  const totalCirculating = teamsList.reduce((sum, t) => sum + (t.total || 0), 0);

  let rowsHtml = teamsList.map((t, idx) => {
    const odds = totalCirculating > 0 ? ((t.total / totalCirculating) * 100).toFixed(2) : '0.00';
    return `
      <tr class="border-t border-slate-800/80 hover:bg-slate-800/30 transition">
        <td class="py-2.5 px-3 text-xs font-bold text-slate-200">
          <span class="font-mono text-slate-500 text-[10px] mr-1.5">${idx + 1}.</span>
          ${t.name}
        </td>
        <td class="py-2.5 px-3 text-xs text-right font-mono text-slate-400">${t.start_tokens || 0}</td>
        <td class="py-2.5 px-3 text-xs text-right font-mono text-emerald-400">+${t.trade_tokens || 0}</td>
        <td class="py-2.5 px-3 text-xs text-right font-mono text-cyan-400">+${t.waiver_tokens || 0}</td>
        <td class="py-2.5 px-3 text-xs text-right font-mono text-amber-300">+${t.promo_tokens || 0}</td>
        <td class="py-2.5 px-3 text-xs text-right font-black text-amber-400 font-mono">${t.total || 0}</td>
        <td class="py-2.5 px-3 text-xs text-right font-bold text-emerald-300 font-mono bg-emerald-500/10 rounded">${odds}%</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="space-y-6">
      
      <!-- TOP OVERVIEW CARDS -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg backdrop-blur-sm">
          <div class="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Circulating Tokens</div>
          <div class="text-2xl font-black text-amber-400 mt-1 font-mono">${totalCirculating} 🎟️</div>
          <div class="text-[11px] text-slate-500 mt-1">Active across all 12 franchises</div>
        </div>

        <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg backdrop-blur-sm">
          <div class="text-xs font-bold text-slate-400 uppercase tracking-wider">Token Award Draw Date</div>
          <div class="text-xl font-black text-white mt-1">January 10, 2027</div>
          <div class="text-[11px] text-slate-500 mt-1">Wheel spin following postseason completion</div>
        </div>

        <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg backdrop-blur-sm">
          <div class="text-xs font-bold text-slate-400 uppercase tracking-wider">Min. Commitment Rule</div>
          <div class="text-xl font-black text-emerald-400 mt-1">50% Token Minimum</div>
          <div class="text-[11px] text-slate-500 mt-1">Required to qualify for wheel awards</div>
        </div>
      </div>

      <!-- FRANCHISE TOKEN LEDGER TABLE -->
      <div class="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div class="px-5 py-3.5 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
          <h2 class="text-sm font-black text-amber-400 uppercase tracking-wide flex items-center gap-2">
            <span>🎟️</span> 2026 Franchise Token Ledger
          </h2>
          <span class="text-xs text-slate-400">Updated: ${tokensData?.last_updated ? new Date(tokensData.last_updated).toLocaleDateString() : 'Live'}</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead>
              <tr class="text-[10px] font-extrabold text-slate-400 uppercase bg-slate-950 border-b border-slate-800">
                <th class="py-2 px-3">Franchise</th>
                <th class="py-2 px-3 text-right">Start</th>
                <th class="py-2 px-3 text-right">Trades</th>
                <th class="py-2 px-3 text-right">Waivers ($25+)</th>
                <th class="py-2 px-3 text-right">Promotions</th>
                <th class="py-2 px-3 text-right">Current Tokens</th>
                <th class="py-2 px-3 text-right">Draw Wheel Odds</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  `;
}

// ---------------------------------------------------------------------------\n// 4. TAB 2: TRADES LOG VIEW\n// ---------------------------------------------------------------------------\nfunction renderTradesLog(container) {
  const trades = tokensData?.trades || [];

  if (trades.length === 0) {
    container.innerHTML = `
      <div class="p-8 bg-slate-900 border border-slate-800 rounded-2xl text-center text-slate-400 italic">
        No completed trades recorded for the 2026 season yet.
      </div>
    `;
    return;
  }

  let cardsHtml = trades.map(t => {
    return `
      <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
        <div class="flex justify-between items-center border-b border-slate-800 pb-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-slate-400 font-mono">${t.date}</span>
            <span class="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-black">+${t.tokens_awarded} Tokens Each</span>
          </div>
          <div class="text-xs font-black text-amber-400 font-mono">Combined KTC Value: ${(t.total_value || 0).toLocaleString()}</div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Team 1 -->
          <div class="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div class="text-xs font-black text-amber-300 mb-1">${t.team1}</div>
            <div class="text-xs text-slate-300 leading-relaxed">${t.team1_assets || 'Assets'}</div>
          </div>

          <!-- Team 2 -->
          <div class="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div class="text-xs font-black text-amber-300 mb-1">${t.team2}</div>
            <div class="text-xs text-slate-300 leading-relaxed">${t.team2_assets || 'Assets'}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="space-y-4">
      <div class="flex justify-between items-center">
        <h2 class="text-sm font-black text-amber-400 uppercase tracking-wide flex items-center gap-2">
          <span>⚔️</span> Completed Trade Transactions & Token Awards
        </h2>
        <span class="text-xs text-slate-400">${trades.length} Trades Logged</span>
      </div>
      ${cardsHtml}
    </div>
  `;
}

// ---------------------------------------------------------------------------\n// 5. TAB 3: WAIVERS LOG VIEW ($25+)\n// ---------------------------------------------------------------------------\nfunction renderWaiversLog(container) {
  const waivers = tokensData?.waivers || [];

  if (waivers.length === 0) {
    container.innerHTML = `
      <div class="p-8 bg-slate-900 border border-slate-800 rounded-2xl text-center text-slate-400 italic">
        No $25+ FAAB waiver claims logged for the 2026 season yet.
      </div>
    `;
    return;
  }

  let rowsHtml = waivers.map((w, idx) => {
    const player = tokensData?.players?.[w.player_id] || { name: w.player_id || 'Player' };
    return `
      <tr class="border-t border-slate-800/80 hover:bg-slate-800/30 transition">
        <td class="py-2.5 px-3 text-xs font-mono text-slate-400">${w.date}</td>
        <td class="py-2.5 px-3 text-xs font-bold text-slate-200">${w.team}</td>
        <td class="py-2.5 px-3 text-xs font-black text-amber-300">${player.name}</td>
        <td class="py-2.5 px-3 text-xs text-right font-mono font-bold text-cyan-400">$${w.bid} FAAB</td>
        <td class="py-2.5 px-3 text-xs text-right font-mono font-black text-emerald-400">+1 Token</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl space-y-3">
      <div class="px-5 py-3.5 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
        <h2 class="text-sm font-black text-amber-400 uppercase tracking-wide flex items-center gap-2">
          <span>⚡</span> FAAB Waiver Claims >= $25 (+1 Token, Max 5/Quarter)
        </h2>
        <span class="text-xs text-slate-400">${waivers.length} Qualifying Claims</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead>
            <tr class="text-[10px] font-extrabold text-slate-400 uppercase bg-slate-950 border-b border-slate-800">
              <th class="py-2 px-3">Date</th>
              <th class="py-2 px-3">Franchise</th>
              <th class="py-2 px-3">Player Acquired</th>
              <th class="py-2 px-3 text-right">FAAB Bid</th>
              <th class="py-2 px-3 text-right">Tokens Earned</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------\n// 6. TAB 4: MONTHLY KTC PLAYER & DRAFT PICK VALUES VIEW\n// ---------------------------------------------------------------------------\nfunction renderMonthlyValues(container) {
  const snapshotMap = tokensData?.monthly_player_values || {};
  const availableDates = Object.keys(snapshotMap).sort().reverse();
  const catalog = tokensData?.players || {};

  const activeValuesMap = snapshotMap[selectedSnapshotDate] || {};

  // Join catalog with values
  let playerList = Object.entries(activeValuesMap).map(([id, val]) => {
    const meta = catalog[id] || {};
    return {
      id,
      name: meta.name || id,
      pos: meta.pos || 'FLEX',
      team: meta.team || 'FA',
      value: val
    };
  });

  // Apply Search Filter
  if (playerSearchQuery.trim()) {
    const q = playerSearchQuery.toLowerCase();
    playerList = playerList.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.pos.toLowerCase().includes(q) || 
      p.team.toLowerCase().includes(q)
    );
  }

  // Sort by Value Descending
  playerList.sort((a, b) => b.value - a.value);

  const dateOptionsHtml = availableDates.map(d => `
    <option value="${d}" ${d === selectedSnapshotDate ? 'selected' : ''} class="bg-slate-900 text-amber-300">
      Snapshot: ${d}
    </option>
  `).join('');

  let tableRows = playerList.map((p, idx) => {
    const isPick = p.pos === 'RDP' || p.pos === 'PICK' || p.name.toLowerCase().includes('draft pick') || p.name.toLowerCase().includes('1st') || p.name.toLowerCase().includes('2nd');
    return `
      <tr class="border-t border-slate-800/80 hover:bg-slate-800/30 transition ${isPick ? 'bg-amber-500/5' : ''}">
        <td class="py-2 px-3 text-xs text-slate-500 font-mono w-12">${idx + 1}</td>
        <td class="py-2 px-3 text-xs font-bold ${isPick ? 'text-amber-300 font-black' : 'text-slate-100'}">
          ${p.name}
        </td>
        <td class="py-2 px-3 text-xs">
          <span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold ${isPick ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-slate-800 text-slate-300'}">
            ${p.pos}
          </span>
        </td>
        <td class="py-2 px-3 text-xs font-mono text-slate-400">${p.team}</td>
        <td class="py-2 px-3 text-xs text-right font-black font-mono text-amber-400">${(p.value || 0).toLocaleString()}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="space-y-4">
      
      <!-- FILTER & SNAPSHOT CONTROLS -->
      <div class="flex flex-col md:flex-row items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg backdrop-blur-sm">
        <div class="flex items-center gap-3 w-full md:w-auto">
          <label class="text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0">Snapshot Date:</label>
          <select id="snapshot-date-select" class="bg-slate-800 text-slate-200 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:border-amber-500 cursor-pointer shadow-inner w-full md:w-auto">
            ${dateOptionsHtml.length > 0 ? dateOptionsHtml : '<option value="none">No Snapshots Found</option>'}
          </select>
        </div>

        <div class="w-full md:w-72">
          <input 
            type="text" 
            id="player-search-input" 
            placeholder="Search player or pick name..." 
            value="${playerSearchQuery}"
            class="w-full bg-slate-800 text-slate-100 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-semibold focus:outline-none focus:border-amber-500 placeholder-slate-500"
          />
        </div>
      </div>

      <!-- PLAYER & PICK VALUES TABLE -->
      <div class="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div class="px-5 py-3 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
          <h2 class="text-sm font-black text-amber-400 uppercase tracking-wide flex items-center gap-2">
            <span>📈</span> KeepTradeCut Dynasty Values (${selectedSnapshotDate})
          </h2>
          <span class="text-xs text-slate-400">${playerList.length} Entries Showing</span>
        </div>

        <div class="overflow-x-auto max-h-[650px] overflow-y-auto">
          <table class="w-full text-left border-collapse">
            <thead class="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 shadow">
              <tr class="text-[10px] font-extrabold text-slate-400 uppercase">
                <th class="py-2.5 px-3">#</th>
                <th class="py-2.5 px-3">Player / Draft Pick</th>
                <th class="py-2.5 px-3">Pos</th>
                <th class="py-2.5 px-3">Team</th>
                <th class="py-2.5 px-3 text-right">KTC Value</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows.length > 0 ? tableRows : '<tr><td colspan="5" class="py-8 text-center text-xs text-slate-500 italic">No players or draft picks found matching your search.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  `;

  // Attach search and select listeners
  document.getElementById('snapshot-date-select')?.addEventListener('change', (e) => {
    selectedSnapshotDate = e.target.value;
    renderMonthlyValues(container);
  });

  document.getElementById('player-search-input')?.addEventListener('input', (e) => {
    playerSearchQuery = e.target.value;
    renderMonthlyValues(container);
  });
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initTokensPage();
});
