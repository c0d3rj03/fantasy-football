// ===========================================================================
// PREMIER BATTLE ROYALE (PBR) DASHBOARD CONTROLLER (pbr.js)
// ===========================================================================

let leagueData = null;
let currentQuarter = '1';
let currentWeek = '2';
let focusTeamId = localStorage.getItem('pbr_focus_team') || 'none';

console.log("=== PBR.JS CONTROLLER INITIALIZING ===");

// ---------------------------------------------------------------------------
// 1. SLACK EMOJI DICTIONARY & MARKDOWN PARSER
// ---------------------------------------------------------------------------
const SLACK_EMOJI_MAP = {
  ':toilet:': '🚽',
  ':trophy:': '🏆',
  ':fire:': '🔥',
  ':football:': '🏈',
  ':crown:': '👑',
  ':poop:': '💩',
  ':shit:': '💩',
  ':robot_face:': '🤖',
  ':robot:': '🤖',
  ':skull:': '💀',
  ':eyes:': '👀',
  ':gem:': '💎',
  ':100:': '💯',
  ':clown_face:': '🤡',
  ':clown:': '🤡',
  ':chart_with_upwards_trend:': '📈',
  ':chart_with_downwards_trend:': '📉',
  ':clap:': '👏',
  ':boom:': '💥',
  ':star:': '⭐',
  ':sunglasses:': '😎',
  ':muscle:': '💪',
  ':moneybag:': '💰',
  ':beer:': '🍺',
  ':beers:': '🍻',
  ':shrug:': '🤷',
  ':facepalm:': '🤦',
  ':warning:': '⚠️',
  ':zap:': '⚡',
  ':ghost:': '👻',
  ':dart:': '🎯',
  ':rocket:': '🚀',
  ':loudspeaker:': '📢',
  ':microphone:': '🎙️',
  ':check:': '✅',
  ':x:': '❌',
  ':white_check_mark:': '✅',
  ':heavy_check_mark:': '✔️',
  ':thinking_face:': '🤔',
  ':thinking:': '🤔',
  ':laughing:': '😆',
  ':joy:': '😂',
  ':rofl:': '🤣',
  ':sob:': '😭',
  ':grimacing:': '😬',
  ':saluting_face:': '🫡',
  ':raised_hands:': '🙌',
  ':folded_hands:': '🙏',
  ':pray:': '🙏',
  ':wave:': '👋',
  ':thumbsup:': '👍',
  ':thumbsdown:': '👎',
  ':+1:': '👍',
  ':-1:': '👎'
};

function parseSlackMarkdown(text) {
  if (!text) return '<p class="italic text-slate-400">No recap recorded for this week yet.</p>';

  // 1. Replace Slack Emoji shortcodes
  let cleanText = text.replace(/:[a-zA-Z0-9_\+\-]+:/g, (match) => {
    return SLACK_EMOJI_MAP[match] || match;
  });

  // 2. Parse Markdown
  return cleanText
    .replace(/^###\s?(.*)$/gm, '<h3 class="text-sm font-extrabold text-amber-400 mt-3 mb-1">$1</h3>')
    .replace(/^##\s?(.*)$/gm, '<h2 class="text-base font-black text-amber-300 mt-4 mb-2 border-b border-slate-800 pb-1">$1</h2>')
    .replace(/\*(.*?)\*/g, '<strong class="text-white font-bold">$1</strong>')
    .replace(/_(.*?)_/g, '<em class="text-slate-300 italic">$1</em>')
    .replace(/^>\s?(.*)$/gm, '<blockquote class="border-l-4 border-amber-500/70 bg-slate-800/40 px-3 py-1.5 rounded-r italic text-slate-300 my-2">$1</blockquote>')
    .replace(/^[•\-]\s?(.*)$/gm, '<div class="flex items-start gap-2 ml-1 my-1"><span class="text-amber-400">•</span><span>$1</span></div>')
    .replace(/\n/g, '<br>');
}

// ---------------------------------------------------------------------------
// 2. DATA INITIALIZATION & FETCH
// ---------------------------------------------------------------------------
async function initDashboard() {
  try {
    const response = await fetch('data.json');
    if (!response.ok) throw new Error('data.json not found');
    leagueData = await response.json();
  } catch (err) {
    console.warn("Could not load local data.json directly, checking fallback path pbr/data.json...", err);
    try {
      const response2 = await fetch('pbr/data.json');
      leagueData = await response2.json();
    } catch (e) {
      console.error("Failed to load PBR league data:", e);
      return;
    }
  }

  populateFocusTeamDropdown();
  autoSelectLatestWeek();
  renderDashboard();
}

function autoSelectLatestWeek() {
  const weeklyData = leagueData?.weekly_data || {};
  const playedWeeks = Object.keys(weeklyData).filter(w => weeklyData[w].played);
  
  if (playedWeeks.length > 0) {
    const maxWeek = Math.max(...playedWeeks.map(Number));
    currentWeek = String(maxWeek);
    currentQuarter = String(Math.ceil(maxWeek / 4));
  } else {
    currentWeek = '1';
    currentQuarter = '1';
  }

  const qSelect = document.getElementById('quarter-select');
  if (qSelect) qSelect.value = currentQuarter;
}

function populateFocusTeamDropdown() {
  const select = document.getElementById('focus-team-select');
  if (!select) return;

  const franchises = leagueData?.franchises || {};
  select.innerHTML = '<option value="none" class="bg-slate-900 text-slate-300">None (Show All)</option>';

  Object.values(franchises).sort((a,b) => a.name.localeCompare(b.name)).forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    opt.className = 'bg-slate-900 text-amber-300';
    if (f.id === focusTeamId) opt.selected = true;
    select.appendChild(opt);
  });
}

// ---------------------------------------------------------------------------
// 3. RENDER DASHBOARD
// ---------------------------------------------------------------------------
function renderDashboard() {
  renderWeekTabs();
  renderWeeklyWinner();
  renderMatchups();
  renderBattleRoyale();
  renderStandings();
  updateRecapButton();
}

function renderWeekTabs() {
  const container = document.getElementById('week-tabs-container') || document.getElementById('week-tabs');
  if (!container) return;

  container.innerHTML = '';
  const startWeek = (parseInt(currentQuarter) - 1) * 4 + 1;
  const endWeek = startWeek + 3;

  for (let w = startWeek; w <= endWeek; w++) {
    const wStr = String(w);
    const isPlayed = leagueData?.weekly_data?.[wStr]?.played;
    const isActive = wStr === currentWeek;

    const btn = document.createElement('button');
    btn.className = `px-3 py-1 text-xs font-bold rounded-lg border transition cursor-pointer flex items-center gap-1.5 ${
      isActive 
        ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md' 
        : isPlayed 
          ? 'bg-slate-800/90 text-slate-200 border-slate-700 hover:bg-slate-700' 
          : 'bg-slate-900/40 text-slate-500 border-slate-800 cursor-not-allowed'
    }`;
    
    btn.innerHTML = `<span>Week ${w}</span>${isPlayed ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>' : ''}`;
    
    btn.onclick = () => {
      currentWeek = wStr;
      renderDashboard();
    };

    container.appendChild(btn);
  }
}

function renderWeeklyWinner() {
  const card = document.getElementById('weekly-winner-card');
  if (!card) return;

  const weekObj = leagueData?.weekly_data?.[currentWeek];
  const battleRoyale = weekObj?.battle_royale || {};

  let topTeam = null;
  let maxScore = -1;

  Object.values(battleRoyale).forEach(divTeams => {
    divTeams.forEach(t => {
      if (t.score > maxScore) {
        maxScore = t.score;
        topTeam = t;
      }
    });
  });

  if (topTeam && maxScore > 0) {
    const nameEl = document.getElementById('weekly-winner-name');
    const scoreEl = document.getElementById('weekly-winner-score');
    if (nameEl) nameEl.textContent = topTeam.name;
    if (scoreEl) scoreEl.textContent = `${topTeam.score.toFixed(2)} PF`;
    card.classList.remove('hidden');
    card.classList.add('flex');
  } else {
    card.classList.add('hidden');
    card.classList.remove('flex');
  }
}

function renderMatchups() {
  const container = document.getElementById('matchups-grid') || document.getElementById('matchups-container');
  if (!container) return;

  container.innerHTML = '';
  const weekObj = leagueData?.weekly_data?.[currentWeek];
  const matchups = weekObj?.matchups || [];

  if (matchups.length === 0) {
    container.innerHTML = '<div class="col-span-full text-center py-6 text-xs text-slate-500 italic">No matchup data available for this week.</div>';
    return;
  }

  matchups.forEach(m => {
    const t1 = m.team1;
    const t2 = m.team2;
    const isT1Winner = t1.score > t2.score;
    const isT2Winner = t2.score > t1.score;

    const isFocusMatchup = focusTeamId !== 'none' && (t1.id === focusTeamId || t2.id === focusTeamId);

    const card = document.createElement('div');
    card.className = `p-3 rounded-lg border transition ${
      isFocusMatchup 
        ? 'bg-amber-500/10 border-amber-500/60 shadow-md shadow-amber-500/10 ring-1 ring-amber-500/40' 
        : 'bg-slate-800/60 border-slate-700/60 hover:border-slate-600'
    }`;

    card.innerHTML = `
      <div class="space-y-2">
        <!-- Team 1 -->
        <div class="flex items-center justify-between gap-2 p-1.5 rounded ${t1.id === focusTeamId ? 'bg-amber-500/20' : ''}">
          <div class="flex items-center gap-2 truncate">
            <span class="text-xs font-bold truncate ${isT1Winner ? 'text-white' : 'text-slate-400'}">${t1.name}</span>
            ${t1.vp_earned > 0 ? `<span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">+${t1.vp_earned} VP</span>` : ''}
          </div>
          <span class="text-xs font-black ${isT1Winner ? 'text-amber-300' : 'text-slate-400'}">${t1.score.toFixed(2)}</span>
        </div>

        <!-- VS Divider -->
        <div class="border-t border-slate-700/40"></div>

        <!-- Team 2 -->
        <div class="flex items-center justify-between gap-2 p-1.5 rounded ${t2.id === focusTeamId ? 'bg-amber-500/20' : ''}">
          <div class="flex items-center gap-2 truncate">
            <span class="text-xs font-bold truncate ${isT2Winner ? 'text-white' : 'text-slate-400'}">${t2.name}</span>
            ${t2.vp_earned > 0 ? `<span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">+${t2.vp_earned} VP</span>` : ''}
          </div>
          <span class="text-xs font-black ${isT2Winner ? 'text-amber-300' : 'text-slate-400'}">${t2.score.toFixed(2)}</span>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function renderBattleRoyale() {
  const container = document.getElementById('battle-royale-grid') || document.getElementById('battle-royale-container');
  if (!container) return;

  container.innerHTML = '';
  const weekObj = leagueData?.weekly_data?.[currentWeek];
  const battleRoyale = weekObj?.battle_royale || {};

  if (Object.keys(battleRoyale).length === 0) {
    container.innerHTML = '<div class="col-span-full text-center py-6 text-xs text-slate-500 italic">No battle royale data for this week.</div>';
    return;
  }

  Object.entries(battleRoyale).forEach(([divName, teams]) => {
    const divCard = document.createElement('div');
    divCard.className = 'bg-slate-800/40 border border-slate-700/60 rounded-lg p-3 space-y-2';

    const sortedTeams = [...teams].sort((a,b) => b.score - a.score);

    let rowsHtml = sortedTeams.map((t, idx) => {
      const isTop2 = idx < 2 && t.score > 0;
      const isFocus = t.id === focusTeamId;

      return `
        <div class="flex items-center justify-between text-xs py-1 px-1.5 rounded ${isFocus ? 'bg-amber-500/25 font-extrabold text-amber-300' : isTop2 ? 'bg-emerald-500/10 text-white' : 'text-slate-400'}">
          <div class="flex items-center gap-1.5 truncate">
            <span class="font-mono text-[10px] text-slate-500">${idx + 1}.</span>
            <span class="truncate ${isTop2 ? 'font-bold' : ''}">${t.name}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="font-bold">${t.score.toFixed(2)}</span>
            ${isTop2 ? '<span class="text-[9px] font-black px-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">+1 VP</span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    divCard.innerHTML = `
      <div class="text-xs font-black text-amber-400 uppercase tracking-wider border-b border-slate-700/60 pb-1 flex justify-between items-center">
        <span>${divName}</span>
        <span class="text-[10px] text-slate-500 font-normal">Top 2 Earn VP</span>
      </div>
      <div class="space-y-1">
        ${rowsHtml}
      </div>
    `;

    container.appendChild(divCard);
  });
}

// ---------------------------------------------------------------------------
// 4. TIME-TRAVELING STANDINGS CALCULATOR & DEMOTION HIGHLIGHTING
// ---------------------------------------------------------------------------
function renderStandings() {
  const container = document.getElementById('standings-container');
  const subtitle = document.getElementById('standings-subtitle');
  if (!container) return;

  container.innerHTML = '';
  if (subtitle) subtitle.textContent = `Cumulative thru Week ${currentWeek}`;

  // Calculate cumulative stats for current quarter up to currentWeek
  const startWeek = (parseInt(currentQuarter) - 1) * 4 + 1;
  const targetWeek = parseInt(currentWeek);

  const standingsMap = {};

  // Initialize franchise records
  const franchises = leagueData?.franchises || {};
  Object.values(franchises).forEach(f => {
    standingsMap[f.id] = {
      id: f.id,
      name: f.name,
      division: f.division_name || f.division || 'Division',
      total_vp: 0,
      pf: 0,
      pp: 0,
      wins: 0,
      losses: 0,
      ties: 0
    };
  });

  // Aggregate stats from startWeek up to targetWeek
  for (let w = startWeek; w <= targetWeek; w++) {
    const wObj = leagueData?.weekly_data?.[String(w)];
    if (!wObj || !wObj.played) continue;

    // Head-to-Head stats
    (wObj.matchups || []).forEach(m => {
      [m.team1, m.team2].forEach((t, idx) => {
        const opp = idx === 0 ? m.team2 : m.team1;
        if (standingsMap[t.id]) {
          standingsMap[t.id].total_vp += (t.vp_earned || 0);
          standingsMap[t.id].pf += (t.score || 0);

          if (t.score > opp.score) standingsMap[t.id].wins += 1;
          else if (opp.score > t.score) standingsMap[t.id].losses += 1;
          else if (t.score > 0) standingsMap[t.id].ties += 1;
        }
      });
    });

    // Battle Royale VPs and Potential Points
    Object.values(wObj.battle_royale || {}).forEach(divTeams => {
      divTeams.forEach(t => {
        if (standingsMap[t.id]) {
          standingsMap[t.id].pp += (t.pp || t.score || 0);
        }
      });

      const sorted = [...divTeams].sort((a,b) => b.score - a.score);
      sorted.slice(0, 2).forEach(t => {
        if (t.score > 0 && standingsMap[t.id]) {
          standingsMap[t.id].total_vp += 1;
        }
      });
    });
  }

  // Group by Division
  const divisions = {};
  Object.values(standingsMap).forEach(team => {
    const divName = team.division || 'Division';
    if (!divisions[divName]) divisions[divName] = [];
    divisions[divName].push(team);
  });

  // Sort and Render each Division
  Object.entries(divisions).forEach(([divName, teams]) => {
    teams.sort((a, b) => b.total_vp - a.total_vp || b.pf - a.pf);

    // Identify team with lowest PP for Relegation Risk in Upper & Middle Divisions
    let lowestPpTeamId = null;
    const lowerDivName = divName.toLowerCase();

    if (lowerDivName.includes('upper')) {
      lowestPpTeamId = teams.reduce((min, t) => (t.pp < min.pp ? t : min), teams[0])?.id;
    } else if (lowerDivName.includes('middle')) {
      const eligibleTeams = teams.slice(1); // Exclude #1 team being promoted
      if (eligibleTeams.length > 0) {
        lowestPpTeamId = eligibleTeams.reduce((min, t) => (t.pp < min.pp ? t : min), eligibleTeams[0])?.id;
      }
    }

    const divBox = document.createElement('div');
    divBox.className = 'bg-slate-800/40 border border-slate-700/60 rounded-lg overflow-hidden';

    let tableRows = teams.map((t, idx) => {
      const isFocus = t.id === focusTeamId;
      const isRelegationTarget = t.id === lowestPpTeamId;

      return `
        <tr class="border-t border-slate-800/80 ${isFocus ? 'bg-amber-500/25 font-bold text-amber-300' : 'hover:bg-slate-800/30'}">
          <td class="py-1.5 px-2.5 text-xs flex items-center justify-between">
            <div>
              <span class="font-mono text-[10px] text-slate-500 mr-1.5">${idx + 1}</span>
              <span class="font-semibold ${isRelegationTarget ? 'text-red-400 font-bold' : 'text-slate-200'}">${t.name}</span>
            </div>
            ${isRelegationTarget ? '<span class="text-[10px] text-red-400 font-bold ml-1">⬇️</span>' : ''}
          </td>
          <td class="py-1.5 px-2.5 text-xs text-right font-black text-amber-400">${t.total_vp}</td>
          <td class="py-1.5 px-2.5 text-xs text-right font-mono text-slate-300">${t.pf.toFixed(1)}</td>
          <td class="py-1.5 px-2.5 text-xs text-right font-mono ${isRelegationTarget ? 'text-red-400 font-black' : 'text-slate-400'}">${t.pp.toFixed(1)}</td>
          <td class="py-1.5 px-2.5 text-xs text-right font-mono text-slate-400">${t.wins}-${t.losses}-${t.ties}</td>
        </tr>
      `;
    }).join('');

    divBox.innerHTML = `
      <div class="px-3 py-1.5 bg-slate-800/80 border-b border-slate-700/60 text-xs font-black text-amber-400 uppercase tracking-wider flex justify-between items-center">
        <span>${divName}</span>
        ${lowestPpTeamId ? '<span class="text-[9px] text-red-400/80 font-normal lowercase">red PP = demotion risk</span>' : ''}
      </div>
      <table class="w-full text-left">
        <thead>
          <tr class="text-[10px] font-bold text-slate-500 uppercase border-b border-slate-800">
            <th class="py-1 px-2.5">Team</th>
            <th class="py-1 px-2.5 text-right">VP</th>
            <th class="py-1 px-2.5 text-right">PF</th>
            <th class="py-1 px-2.5 text-right">PP</th>
            <th class="py-1 px-2.5 text-right">W-L</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    `;

    container.appendChild(divBox);
  });
}

// ---------------------------------------------------------------------------
// 5. EVENT LISTENERS & MODAL CONTROLS
// ---------------------------------------------------------------------------
function updateRecapButton() {
  const btnText = document.getElementById('recap-btn-text') || document.querySelector('#recap-btn .tracking-wide') || document.getElementById('recap-btn');
  if (btnText) {
    btnText.innerText = `View Gemmy's Week ${currentWeek} Recap`;
  }
}

function openRecapModal() {
  const modal = document.getElementById('recap-modal');
  const title = document.getElementById('recap-modal-title');
  const body = document.getElementById('recap-modal-body');

  const rawRecap = leagueData?.weekly_data?.[currentWeek]?.recap || '';

  if (title) title.innerText = `Gemmy's Week ${currentWeek} Breakdown`;
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

document.addEventListener('DOMContentLoaded', () => {
  // Quarter selector
  document.getElementById('quarter-select')?.addEventListener('change', (e) => {
    currentQuarter = e.target.value;
    currentWeek = String((parseInt(currentQuarter) - 1) * 4 + 1);
    renderDashboard();
  });

  // Focus team selector
  document.getElementById('focus-team-select')?.addEventListener('change', (e) => {
    focusTeamId = e.target.value;
    localStorage.setItem('pbr_focus_team', focusTeamId);
    renderDashboard();
  });

  // Modal triggers
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

  // Initialize data load
  initDashboard();
});
