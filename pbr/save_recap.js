const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data.json');
const recapPath = path.join(__dirname, 'recap.json');
const draftPath = path.join(__dirname, 'draft_recap.txt');

function sanitizeSlackMrkdwn(text) {
  if (!text) return '';
  let clean = text;
  clean = clean.replace(/\*\*(.*?)\*\*/g, '**');
  clean = clean.replace(/^#{1,6}\s*(.*)$/gm, '');
  clean = clean.replace(/^[\s	]*[-*_]{3,}[\s	]*$/gm, '');
  clean = clean.replace(/-{3,}/g, '');
  return clean.trim();
}

function updateDataJsonRecap(pbrData, weekNum, cleanRecap) {
  const weekStr = String(weekNum);
  const weekIdx = Number(weekNum) - 1;
  const currentQuarter = Math.ceil(weekNum / 4);
  const quarterStr = String(currentQuarter);
  const quarterIdx = currentQuarter - 1;

  pbrData.last_recap = cleanRecap;
  pbrData.recap_updated_at = new Date().toISOString();

  if (pbrData.weekly_recaps) {
    if (Array.isArray(pbrData.weekly_recaps)) {
      pbrData.weekly_recaps[weekIdx] = cleanRecap;
    } else if (typeof pbrData.weekly_recaps === 'object') {
      pbrData.weekly_recaps[weekStr] = cleanRecap;
    }
  } else {
    pbrData.weekly_recaps = {};
    pbrData.weekly_recaps[weekStr] = cleanRecap;
  }

  if (pbrData.recaps) {
    if (Array.isArray(pbrData.recaps)) {
      pbrData.recaps[weekIdx] = cleanRecap;
    } else if (typeof pbrData.recaps === 'object') {
      pbrData.recaps[weekStr] = cleanRecap;
    }
  }

  if (pbrData.weekly_data) {
    if (Array.isArray(pbrData.weekly_data)) {
      pbrData.weekly_data.forEach(item => {
        if (item && (item.week == weekNum || item.week_num == weekNum)) item.recap = cleanRecap;
      });
      if (pbrData.weekly_data[weekIdx]) pbrData.weekly_data[weekIdx].recap = cleanRecap;
    } else if (typeof pbrData.weekly_data === 'object') {
      if (pbrData.weekly_data[weekStr]) pbrData.weekly_data[weekStr].recap = cleanRecap;
    }
  }

  if (pbrData.weeks) {
    if (Array.isArray(pbrData.weeks)) {
      pbrData.weeks.forEach(item => {
        if (item && (item.week == weekNum || item.week_num == weekNum)) item.recap = cleanRecap;
      });
      if (pbrData.weeks[weekIdx]) pbrData.weeks[weekIdx].recap = cleanRecap;
    } else if (typeof pbrData.weeks === 'object') {
      if (pbrData.weeks[weekStr]) pbrData.weeks[weekStr].recap = cleanRecap;
    }
  }

  if (pbrData.quarters) {
    let qObj = pbrData.quarters[quarterStr] || pbrData.quarters[quarterIdx] || pbrData.quarters[currentQuarter];
    if (!qObj && Array.isArray(pbrData.quarters)) qObj = pbrData.quarters[quarterIdx];
    if (qObj) {
      if (qObj.weekly_data) {
        if (Array.isArray(qObj.weekly_data)) {
          qObj.weekly_data.forEach(item => {
            if (item && (item.week == weekNum || item.week_num == weekNum)) item.recap = cleanRecap;
          });
          if (qObj.weekly_data[weekIdx]) qObj.weekly_data[weekIdx].recap = cleanRecap;
        } else if (typeof qObj.weekly_data === 'object') {
          if (qObj.weekly_data[weekStr]) qObj.weekly_data[weekStr].recap = cleanRecap;
        }
      }
      if (qObj.weeks) {
        if (Array.isArray(qObj.weeks)) {
          qObj.weeks.forEach(item => {
            if (item && (item.week == weekNum || item.week_num == weekNum)) item.recap = cleanRecap;
          });
        } else if (typeof qObj.weeks === 'object') {
          if (qObj.weeks[weekStr]) qObj.weeks[weekStr].recap = cleanRecap;
        }
      }
    }
  }
}

function saveRecap() {
  const args = process.argv.slice(2);
  let textToSave = args.join(' ').trim();

  if (!textToSave && fs.existsSync(draftPath)) {
    textToSave = fs.readFileSync(draftPath, 'utf8');
  }

  if (!textToSave) {
    console.error('❌ Error: No recap text found!');
    console.log('Usage option 1: node save_recap.js "Paste your formatted recap here"');
    console.log('Usage option 2: Save recap in pbr/draft_recap.txt and run: node save_recap.js');
    process.exit(1);
  }

  const cleanRecap = sanitizeSlackMrkdwn(textToSave);
  const recapPayload = { timestamp: new Date().toISOString(), recap: cleanRecap };

  try {
    fs.writeFileSync(recapPath, JSON.stringify(recapPayload, null, 2), 'utf8');
    console.log('✅ Updated pbr/recap.json');
  } catch (e) {
    console.error('Warning: Failed to write recap.json:', e.message);
  }

  if (fs.existsSync(dataPath)) {
    try {
      const pbrData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      const weekNum = pbrData.current_week || pbrData.week || 4;
      updateDataJsonRecap(pbrData, weekNum, cleanRecap);
      fs.writeFileSync(dataPath, JSON.stringify(pbrData, null, 2), 'utf8');
      console.log('✅ Updated pbr/data.json across all week ' + weekNum + ' recap locations');
    } catch (e) {
      console.error('Error updating data.json:', e.message);
    }
  }

  console.log('🎉 Done! Recap successfully saved for the dashboard.');
}

saveRecap();
