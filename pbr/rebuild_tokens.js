const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'tokens_data.json');

const startingBalances = {
  "The Wild Cards": 11,
  "Hamsterdam": 13,
  "Shankly's Ghost": 0,
  "2 Roops, 1 Silva": 9,
  "Orcan Terror": 15,
  "The Meaty Ogres": 13,
  "Ted Lasso": 3,
  "Peaky Fookin Blinders": 0,
  "Springfield Isotopes": 20,
  "BattleBots": 84,
  "The Two Tones": 11,
  "Norsemen": 15
};

const cleanData = {
  season: "2026",
  last_updated: new Date().toISOString(),
  starting_balances: startingBalances,
  summary: {},
  waiver_summary: {},
  trades: []
};

Object.keys(startingBalances).forEach(team => {
  cleanData.summary[team] = {
    start: startingBalances[team],
    trade_tokens: 0,
    waiver_tokens: 0,
    promotion_tokens: 0,
    current_tokens: startingBalances[team]
  };
  cleanData.waiver_summary[team] = {
    Q1: 0, Q2: 0, Q3: 0, Post: 0, total: 0
  };
});

fs.writeFileSync(targetFile, JSON.stringify(cleanData, null, 2));
console.log('✅ Clean pbr/tokens_data.json initialized successfully!');
