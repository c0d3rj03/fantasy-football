const fs = require('fs');
const path = require('path');

const LEAGUE_ID = "63213";
const YEAR = "2026";
const BASE_URL = `https://www42.myfantasyleague.com/${YEAR}`;
const MFL_USERNAME = process.env.MFL_USERNAME;
const MFL_PASSWORD = process.env.MFL_PASSWORD;

function parseAuthCookie(response, existingCookie = '') {
  let rawCookies = [];
  if (typeof response.headers.getSetCookie === 'function') {
    rawCookies = response.headers.getSetCookie();
  } else {
    const sc = response.headers.get('set-cookie');
    if (sc) rawCookies = [sc];
  }

  const cookieMap = new Map();

  if (existingCookie) {
    existingCookie.split(';').forEach(pair => {
      const [k, ...v] = pair.split('=');
      if (k && v.length > 0) {
        cookieMap.set(k.trim(), v.join('=').trim());
      }
    });
  }

  rawCookies.forEach(c => {
    const [firstPart] = c.split(';');
    if (firstPart) {
      const [k, ...v] = firstPart.split('=');
      if (k && v.length > 0) {
        cookieMap.set(k.trim(), v.join('=').trim());
      }
    }
  });

  return Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function fetchWithCookieAccumulation(url, options = {}, existingCookie = '') {
  const reqHeaders = { ...(options.headers || {}) };
  if (existingCookie) {
    reqHeaders['Cookie'] = existingCookie;
  }

  const response = await fetch(url, {
    ...options,
    headers: reqHeaders,
    redirect: 'manual'
  });

  const updatedCookie = parseAuthCookie(response, existingCookie);

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    if (location) {
      const redirectUrl = location.startsWith('http') ? location : new URL(location, url).toString();
      return await fetchWithCookieAccumulation(redirectUrl, { method: 'GET', headers: options.headers }, updatedCookie);
    }
  }

  return { response, cookie: updatedCookie };
}

function extractHiddenFields(html) {
  const hiddenFields = {};
  const inputRegex = /<input[^>]*>/gi;
  let match;

  while ((match = inputRegex.exec(html)) !== null) {
    const tag = match[0];
    if (/type=["']?hidden["']?/i.test(tag)) {
      const nameMatch = /name=["']?([^"'\s>]+)["']?/i.exec(tag);
      const valueMatch = /value=["']?([^"'>]*)["']?/i.exec(tag);
      if (nameMatch && nameMatch[1]) {
        hiddenFields[nameMatch[1]] = valueMatch && valueMatch[1] ? valueMatch[1] : '';
      }
    }
  }

  return hiddenFields;
}

async function loginToMFL() {
  const loginUrl = `${BASE_URL}/login`;
  const params = new URLSearchParams({
    USERNAME: MFL_USERNAME,
    PASSWORD: MFL_PASSWORD,
    L: LEAGUE_ID
  });

  const baseHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  };

  try {
    // 1. Login POST
    let { response, cookie } = await fetchWithCookieAccumulation(loginUrl, {
      method: 'POST',
      headers: { ...baseHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    const loginHtml = await response.text();

    if (!cookie || !cookie.includes('MFL_USER_ID')) {
      console.error("❌ Failed to authenticate with MFL. Check credentials.");
      return null;
    }

    console.log("✅ Authenticated with MFL (MFL_USER_ID obtained).");

    // 2. Extract "Become Commissioner" URL from HTML
    // Looking for: href="https://www42.myfantasyleague.com/2026/logout?L=63213&amp;BECOME=0000" or similar
    let becomeUrl = null;
    const commishLinkRegex = /href=["']([^"']*BECOME=0000[^"']*)["']/i;
    const match = commishLinkRegex.exec(loginHtml);

    if (match && match[1]) {
      // CRITICAL FIX: Unescape HTML entity &amp; -> & so URL parameter BECOME=0000 is sent cleanly!
      becomeUrl = match[1].replace(/&amp;/g, '&');
      if (!becomeUrl.startsWith('http')) {
        becomeUrl = new URL(becomeUrl, BASE_URL).toString();
      }
      console.log(`👑 Found 'Become Commissioner' link: ${becomeUrl}`);
    } else {
      // Fallback
      becomeUrl = `${BASE_URL}/logout?L=${LEAGUE_ID}&BECOME=0000`;
      console.log(`ℹ️ 'Become Commissioner' link not found in login HTML. Using fallback: ${becomeUrl}`);
    }

    // 3. Elevate session to Commissioner mode
    console.log("Elevating session to Commissioner mode...");
    const becomeResult = await fetchWithCookieAccumulation(becomeUrl, {
      method: 'GET',
      headers: baseHeaders
    }, cookie);

    cookie = becomeResult.cookie;
    console.log("\n📋 Active Session Cookies after elevation:");
    console.log("  ", cookie);

    if (cookie.includes('MFL_IS_COMMISH')) {
      console.log("✅ Commissioner mode (MFL_IS_COMMISH) active!\n");
    } else {
      console.log("ℹ️ Session updated with Commissioner mode elevation.\n");
    }

    return cookie;
  } catch (err) {
    console.error("❌ Network or login error:", err.message);
    return null;
  }
}

async function pushInDivisionVPs(cookie, weekNum, vpWinners) {
  const csetupUrl = `${BASE_URL}/csetup?L=${LEAGUE_ID}&C=STANDADJ&VICTORY_POINTS=1`;
  const postUrl = `${BASE_URL}/csetup`;

  const headers = {
    'Cookie': cookie,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': csetupUrl,
    'Origin': BASE_URL
  };

  try {
    console.log("Fetching MFL Standings Adjustment form to extract session tokens...");
    const getResponseObj = await fetchWithCookieAccumulation(csetupUrl, { method: 'GET', headers: { ...headers, 'Cookie': cookie } }, cookie);
    cookie = getResponseObj.cookie;
    const getHtml = await getResponseObj.response.text();

    const csetupPath1 = path.join(__dirname, 'csetup_form.html');
    const csetupPath2 = path.join(process.cwd(), 'csetup_form.html');
    fs.writeFileSync(csetupPath1, getHtml);
    if (csetupPath1 !== csetupPath2) fs.writeFileSync(csetupPath2, getHtml);

    console.log(`📄 Saved GET form HTML to:\n  - ${csetupPath1}`);

    if (getHtml.includes("Commissioner Access Required")) {
      console.error("\n❌ MFL Session Error: MFL returned 'Commissioner Access Required' page. Verify your account has Commissioner rights for league " + LEAGUE_ID);
      return;
    }

    const hiddenTokens = extractHiddenFields(getHtml);
    console.log("Captured hidden tokens:", hiddenTokens);

    const params = new URLSearchParams();
    params.set("form_name", hiddenTokens.form_name || "sadj");
    params.set("LEAGUE_ID", LEAGUE_ID);
    params.set("C", "STANDADJ");
    if (hiddenTokens.input_expires) {
      params.set("input_expires", hiddenTokens.input_expires);
    }
    params.set("VICTORY_POINTS", "1");
    params.set("PREFIX", "");

    const winnerSet = new Set(vpWinners.map(id => String(id).padStart(4, '0')));

    for (let i = 1; i <= 12; i++) {
      const formattedFid = String(i).padStart(4, '0');
      const isWinner = winnerSet.has(formattedFid);
      params.set(`WEEK${formattedFid}`, String(weekNum));
      params.set(`ADJUST_VP${formattedFid}`, isWinner ? "1" : "");
      params.set(`EXP${formattedFid}`, isWinner ? "In-Division Top 2 Score" : "");
    }

    params.set("ASUBMIT", "Adjust Standings");

    console.log("\nSubmitting form adjustments to MFL...");
    console.log("Payload String:", params.toString());

    const postResultObj = await fetchWithCookieAccumulation(postUrl, {
      method: 'POST',
      headers: {
        'Cookie': cookie,
        'User-Agent': headers['User-Agent'],
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': csetupUrl,
        'Origin': BASE_URL
      },
      body: params
    }, cookie);

    const postHtml = await postResultObj.response.text();

    const mflRespPath1 = path.join(__dirname, 'mfl_response.html');
    const mflRespPath2 = path.join(process.cwd(), 'mfl_response.html');
    fs.writeFileSync(mflRespPath1, postHtml);
    if (mflRespPath1 !== mflRespPath2) fs.writeFileSync(mflRespPath2, postHtml);

    console.log(`\n🎉 Form submitted for Week ${weekNum}! Response written to:\n  - ${mflRespPath1}`);
    console.log("Winning teams updated:");
    vpWinners.forEach(fid => console.log(` - Team ID ${String(fid).padStart(4, '0')} (+1 VP)`));

  } catch (err) {
    console.error("❌ Failed during MFL update process:", err.message);
  }
}

async function main() {
  console.log("🏈 --- PBR MFL Victory Point Sync Tool --- 🏈\n");

  if (!MFL_USERNAME || !MFL_PASSWORD) {
    console.error("❌ Error: Missing MFL_USERNAME or MFL_PASSWORD environment variables.");
    return;
  }

  const dataPath = path.join(__dirname, 'data.json');
  if (!fs.existsSync(dataPath)) {
    console.error("❌ Error: data.json not found in current directory. Run node fetcher.js first.");
    return;
  }

  const leagueData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const weeklyData = leagueData.weekly_data || {};

  const [, , weekArg] = process.argv;
  let targetWeekKey = weekArg;

  if (!targetWeekKey) {
    const playedWeeks = Object.keys(weeklyData).filter(k => weeklyData[k].played);
    if (playedWeeks.length === 0) {
      console.log("⚠️ No played weeks found in data.json.");
      return;
    }
    targetWeekKey = String(Math.max(...playedWeeks.map(Number)));
  }

  const weekObj = weeklyData[targetWeekKey];
  if (!weekObj) {
    console.error(`❌ Week ${targetWeekKey} not found in data.json.`);
    return;
  }

  console.log(`Targeting Week ${targetWeekKey} results...`);
  const vpWinners = [];
  const battleRoyale = weekObj.battle_royale || {};

  Object.entries(battleRoyale).forEach(([divName, teams]) => {
    const sorted = [...teams].sort((a, b) => (b.score || 0) - (a.score || 0));
    const top2 = sorted.slice(0, 2);
    top2.forEach(t => vpWinners.push(t.id));
    console.log(` • ${divName} Top 2: ${top2.map(t => `${t.name} (${t.score.toFixed(2)} PF)`).join(', ')}`);
  });

  if (vpWinners.length === 0) {
    console.log("⚠️ No in-division VP winners identified for this week.");
    return;
  }

  console.log(`\nLogging into MFL as Commissioner (${MFL_USERNAME})...`);
  const cookie = await loginToMFL();
  if (cookie) {
    await pushInDivisionVPs(cookie, targetWeekKey, vpWinners);
  }
}

main();
