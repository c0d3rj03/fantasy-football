const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'tokens_data.json');
const ktcPath = path.join(__dirname, 'ktc-2026-data.json');

// Calculate Token Award based on Total Trade Value (Per PBR Bylaws)
function calculateTradeTokens(totalVal) {
  if (totalVal >= 37500) return 12;
  if (totalVal >= 30000) return 10;
  if (totalVal >= 22500) return 8;
  if (totalVal >= 15000) return 6;
  if (totalVal >= 7500) return 4;
  return 2;
}

// 2026 Trades recorded in the PBR Token Tracker
const knownTrades = [
  {
    date: "2026-08-29",
    team1: "BattleBots",
    team1_assets: [{ name: "Year 2026 Draft Pick 5.11", value: 1201 }],
    team2: "Peaky Fookin Blinders",
    team2_assets: [{ name: "Year 2026 Draft Pick 5.09", value: 1201 }]
  },
  {
    date: "2026-05-19",
    team1: "BattleBots",
    team1_assets: [
      { name: "RB Alvin Kamara, NOS", value: 2045 },
      { name: "Year 2027 4th Round Draft Pick", value: 1746 }
    ],
    team2: "Ted Lasso",
    team2_assets: [
      { name: "WR Jalen Royals, KCC", value: 1820 },
      { name: "Year 2026 Draft Pick 3.14", value: 1796 }
    ]
  },
  {
    date: "2026-05-13",
    team1: "Hamsterdam",
    team1_assets: [
      { name: "Year 2026 Draft Pick 4.01", value: 1720 },
      { name: "Year 2026 Draft Pick 2.14", value: 2390 }
    ],
    team2: "Peaky Fookin Blinders",
    team2_assets: [
      { name: "Year 2026 Draft Pick 2.13", value: 2515 },
      { name: "Year 2026 Draft Pick 4.09", value: 1518 }
    ]
  },
  {
    date: "2026-05-13",
    team1: "BattleBots",
    team1_assets: [
      { name: "Year 2026 Draft Pick 2.10", value: 2765 },
      { name: "Year 2026 Draft Pick 2.11", value: 2765 },
      { name: "Year 2027 5th Round Draft Pick", value: 1264 }
    ],
    team2: "Norsemen",
    team2_assets: [
      { name: "Year 2026 Draft Pick 3.03", value: 2265 },
      { name: "Year 2026 Draft Pick 3.04", value: 2265 },
      { name: "Year 2026 Draft Pick 3.05", value: 2116 },
      { name: "Year 2027 4th Round Draft Pick", value: 1746 }
    ]
  },
  {
    date: "2026-05-12",
    team1: "Norsemen",
    team1_assets: [
      { name: "Year 2027 1st Round Draft Pick", value: 5831 }
    ],
    team2: "Orcan Terror",
    team2_assets: [
      { name: "WR Matthew Golden, GBP", value: 3707 },
      { name: "WR Cedric Tillman, CLE", value: 1980 },
      { name: "Year 2027 2nd Round Draft Pick", value: 3499 }
    ]
  },
  {
    date: "2026-05-12",
    team1: "Hamsterdam",
    team1_assets: [
      { name: "Year 2026 Draft Pick 2.02", value: 3259 },
      { name: "Year 2026 Draft Pick 5.01", value: 1218 }
    ],
    team2: "The Meaty Ogres",
    team2_assets: [
      { name: "Year 2026 Draft Pick 2.07", value: 3033 },
      { name: "Year 2026 Draft Pick 3.07", value: 2116 }
    ]
  },
  {
    date: "2026-05-11",
    team1: "Orcan Terror",
    team1_assets: [
      { name: "Year 2026 Draft Pick 1.10", value: 3862 },
      { name: "Year 2026 Draft Pick 1.11", value: 3862 },
      { name: "Year 2026 Draft Pick 3.03", value: 2265 }
    ],
    team2: "Norsemen",
    team2_assets: [
      { name: "TE Harold Fannin, CLE", value: 5477 },
      { name: "Year 2027 2nd Round Draft Pick", value: 3499 }
    ]
  },
  {
    date: "2026-05-11",
    team1: "Norsemen",
    team1_assets: [
      { name: "RB Dylan Sampson, CLE", value: 2740 }
    ],
    team2: "Springfield Isotopes",
    team2_assets: [
      { name: "Year 2026 Draft Pick 3.05", value: 2116 },
      { name: "Year 2026 Draft Pick 5.05", value: 1218 }
    ]
  },
  {
    date: "2026-05-11",
    team1: "2 Roops, 1 Silva",
    team1_assets: [
      { name: "RB Quinshon Judkins, CLE", value: 5458 }
    ],
    team2: "Springfield Isotopes",
    team2_assets: [
      { name: "RB TreVeyon Henderson, NEP", value: 5477 }
    ]
  },
  {
    date: "2026-05-10",
    team1: "The Two Tones",
    team1_assets: [
      { name: "Year 2026 Draft Pick 2.02", value: 3259 },
      { name: "Year 2026 Draft Pick 2.14", value: 2390 }
    ],
    team2: "Hamsterdam",
    team2_assets: [
      { name: "WR Keon Coleman, BUF", value: 2538 },
      { name: "TE Jake Ferguson, DAL", value: 3740 }
    ]
  },
  {
    date: "2026-05-10",
    team1: "Springfield Isotopes",
    team1_assets: [
      { name: "QB Kyler Murray, MIN", value: 4099 },
      { name: "Year 2027 1st Round Draft Pick", value: 5831 },
      { name: "Year 2026 Draft Pick 2.05", value: 3033 }
    ],
    team2: "The Two Tones",
    team2_assets: [
      { name: "WR Tetairoa McMillan, CAR", value: 6627 },
      { name: "Year 2027 2nd Round Draft Pick", value: 3499 },
      { name: "WR DK Metcalf, PIT", value: 3731 }
    ]
  },
  {
    date: "2026-05-09",
    team1: "Peaky Fookin Blinders",
    team1_assets: [
      { name: "Year 2026 Draft Pick 1.07", value: 4579 },
      { name: "Year 2027 1st Round Draft Pick", value: 5831 },
      { name: "Year 2027 3rd Round Draft Pick", value: 2412 }
    ],
    team2: "The Two Tones",
    team2_assets: [
      { name: "Year 2026 Draft Pick 1.02", value: 5668 },
      { name: "Year 2027 3rd Round Draft Pick", value: 2412 }
    ]
  },
  {
    date: "2026-03-13",
    team1: "2 Roops, 1 Silva",
    team1_assets: [
      { name: "WR Alec Pierce, IND", value: 3964 },
      { name: "TE Kyle Pitts, ATL", value: 5103 },
      { name: "Year 2027 2nd Round Draft Pick", value: 3431 },
      { name: "Year 2027 3rd Round Draft Pick", value: 2312 }
    ],
    team2: "The Meaty Ogres",
    team2_assets: [
      { name: "QB Malik Willis, MIA", value: 3492 },
      { name: "WR Jameson Williams, DET", value: 4740 },
      { name: "WR Xavier Worthy, KCC", value: 3483 },
      { name: "Year 2027 4th Round Draft Pick", value: 1689 }
    ]
  }
];

function processTrades() {
  console.log('🔄 Processing PBR Trade Ledger & Tokens...');

  if (!fs.existsSync(dataPath)) {
    console.error('❌ tokens_data.json not found! Run rebuild_tokens.js first.');
    return;
  }

  const tokensData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  // Reset trade tokens counters
  Object.keys(tokensData.summary).forEach(t => {
    tokensData.summary[t].trade_tokens = 0;
  });

  const processedTrades = knownTrades.map(tr => {
    const val1 = tr.team1_assets.reduce((sum, a) => sum + a.value, 0);
    const val2 = tr.team2_assets.reduce((sum, a) => sum + a.value, 0);
    const totalVal = val1 + val2;
    const tokensAwarded = calculateTradeTokens(totalVal);

    // Award tokens to both teams
    if (tokensData.summary[tr.team1]) {
      tokensData.summary[tr.team1].trade_tokens += tokensAwarded;
    }
    if (tokensData.summary[tr.team2]) {
      tokensData.summary[tr.team2].trade_tokens += tokensAwarded;
    }

    return {
      date: tr.date,
      team1: tr.team1,
      team1_assets: tr.team1_assets,
      team1_value: val1,
      team2: tr.team2,
      team2_assets: tr.team2_assets,
      team2_value: val2,
      total_value: totalVal,
      tokens_awarded_each: tokensAwarded
    };
  });

  tokensData.trades = processedTrades;

  // Recalculate total current tokens for each team
  Object.keys(tokensData.summary).forEach(t => {
    const s = tokensData.summary[t];
    s.current_tokens = s.start + s.trade_tokens + s.waiver_tokens + s.promotion_tokens;
  });

  tokensData.last_updated = new Date().toISOString();

  fs.writeFileSync(dataPath, JSON.stringify(tokensData, null, 2));

  console.log(`\n====================================================================================`);
  console.log(`                                2026 PBR TRADES LEDGER                              `);
  console.log(`====================================================================================`);

  processedTrades.forEach(tr => {
    console.log(`\n📅 [${tr.date}] ${tr.team1}  <--->  ${tr.team2}`);
    console.log(`  • ${tr.team1} sent: ${tr.team1_assets.map(a => `${a.name} (${a.value})`).join(', ')} [Subtotal: ${tr.team1_value}]`);
    console.log(`  • ${tr.team2} sent: ${tr.team2_assets.map(a => `${a.name} (${a.value})`).join(', ')} [Subtotal: ${tr.team2_value}]`);
    console.log(`  📊 Total Trade Value: ${tr.total_value.toLocaleString()} | 🎟️ Tokens Earned Each: +${tr.tokens_awarded_each}`);
  });

  console.log(`\n====================================================================================`);
  console.log(`                           CURRENT PBR TOKEN SUMMARY (2026)                          `);
  console.log(`====================================================================================`);
  console.log(`Franchise                | Start | Trade Tokens | Waiver Tokens | Promo Tokens | TOTAL TOKENS`);
  console.log(`------------------------------------------------------------------------------------`);
  Object.keys(tokensData.summary).forEach(t => {
    const s = tokensData.summary[t];
    console.log(`${t.padEnd(24)} | ${String(s.start).padStart(5)} | ${String(s.trade_tokens).padStart(12)} | ${String(s.waiver_tokens).padStart(13)} | ${String(s.promotion_tokens).padStart(12)} | ${String(s.current_tokens).padStart(12)}`);
  });

  console.log(`\n✅ Saved updated trade calculations and token summary to pbr/tokens_data.json!`);
}

processTrades();
