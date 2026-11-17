// Claudine: the commissioner's Claude-powered co-host for the weekly recap.
// Gemmy (Gemini) writes short takes; Claudine (Claude) replies to each one, agreeing or arguing,
// and the two are interleaved into one brief post. generate_post.js decides when to use it.
//
// Env: ANTHROPIC_API_KEY (repo secret PBR_ANTHROPIC_API_KEY). CLAUDINE_MODEL overrides the model.
const CLAUDINE_MODEL = process.env.CLAUDINE_MODEL || 'claude-opus-5-5';

// "TAKE: 👑 UPPER | text" lines from Gemmy → [{ topic, text }]. Falls back to paragraphs if Gemmy skipped the markers.
function parseTakes(text) {
  const marked = (text || '').split(/^\s*TAKE:\s*/m).slice(1).map(s => s.trim()).filter(Boolean);
  const raw = marked.length ? marked : (text || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  return raw.map(t => {
    const bar = t.indexOf('|');
    return bar > 0 && bar < 60
      ? { topic: t.slice(0, bar).replace(/\*/g, '').trim(), text: t.slice(bar + 1).trim() }
      : { topic: '', text: t };
  });
}

const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    replies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          take: { type: 'integer', description: 'Number of the Gemmy take this replies to' },
          stance: { type: 'string', enum: ['agree', 'argue', 'add'] },
          text: { type: 'string' }
        },
        required: ['take', 'stance', 'text'],
        additionalProperties: false
      }
    },
    closer: { type: 'string' }
  },
  required: ['replies', 'closer'],
  additionalProperties: false
};

function claudineSystemPrompt() {
  return [
    'You are Claudine, the PBR (Premier Battle Royale) dynasty fantasy football league commissioner\'s AI, built on Claude.',
    'Gemmy is the league\'s snarky mascot, built on Gemini. You two co-host the weekly recap in Slack: Gemmy writes short takes, you reply to each one.',
    '',
    'Your voice: dry, quick, numbers-first, a little smug about being right. Playfully competitive with Gemmy, never mean to Gemmy, and as willing as Gemmy to roast managers.',
    '',
    'For each take, pick a stance:',
    '- agree: pile on, ideally with a number Gemmy left out.',
    '- argue: push back when Gemmy got the emphasis wrong (by the league\'s stakes below) or a fact wrong. If Gemmy stated a number that is not in the data, or got one wrong, say so plainly and give the right one.',
    '- add: a sharper angle or the stat that actually matters.',
    'Use at least one agree and at least one argue across the replies. Reply to every take, in order.',
    '',
    'Rules:',
    '- Each reply: 1-2 sentences, under 220 characters. Brevity is the joke.',
    '- Use only the numbers, players and moves in the data. Never invent any.',
    '- Potential Points (PP) measure roster depth, not lineup-setting. Bench points (PP minus score) are the lineup measure.',
    '- Slack formatting: *bold* with single asterisks, _italics_. No headings, no bullets, no @mentions. At most one emoji per reply, as a Unicode character.',
    '- Don\'t start replies with "Gemmy" or with your own name; the layout already labels who is talking.',
    '- closer: one line under 140 characters to end the post, aimed at the league or at Gemmy.'
  ].join('\n');
}

/**
 * Asks Claude for Claudine's replies. context: the league rules, stakes and week data (generate_post.js leagueContext).
 * Returns { replies: [{ take, stance, text }], closer }. Throws on any failure; the caller decides the fallback.
 */
async function writeClaudineReplies(takes, context) {
  const { Anthropic } = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const numbered = takes.map((t, i) => `${i + 1}. ${t.topic ? `[${t.topic}] ` : ''}${t.text}`).join('\n');
  const response = await client.beta.messages.create({
    model: CLAUDINE_MODEL,
    max_tokens: 16000,
    // If a safety classifier declines, the API retries on a fallback model instead of failing the post.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: REPLY_SCHEMA } },
    system: claudineSystemPrompt(),
    messages: [{ role: 'user', content: `${context}\n\nGEMMY'S TAKES THIS WEEK:\n${numbered}\n\nWrite your replies.` }]
  });
  if (response.stop_reason === 'refusal') throw new Error(`Claude declined (${response.stop_details?.category || 'no category'})`);
  if (response.stop_reason === 'max_tokens') throw new Error('Claude hit max_tokens');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed = JSON.parse(text);
  console.log(`Claudine (${response.model}) wrote ${parsed.replies.length} replies; ${response.usage.input_tokens} in / ${response.usage.output_tokens} out tokens.`);
  return parsed;
}

// One post: title, then each Gemmy take with Claudine's reply under it, then Claudine's closer.
function assembleDuet(week, takes, claudine) {
  const byTake = new Map((claudine?.replies || []).map(r => [Number(r.take), r.text.trim()]));
  const blocks = takes.map((t, i) => [
    t.topic ? `*${t.topic}*` : null,
    `🎙️ *Gemmy:* ${t.text}`,
    byTake.get(i + 1) ? `🤖 *Claudine:* ${byTake.get(i + 1)}` : null
  ].filter(Boolean).join('\n'));
  return [
    claudine ? `🎙️ *GEMMY vs CLAUDINE: WEEK ${week}* 🤖` : `🎙️ *GEMMY'S WEEKLY DISPATCH: WEEK ${week} RECAP* 🎙️`,
    claudine ? '_Gemmy brings the roast. Claudine checks the math._' : null,
    ...blocks,
    claudine?.closer ? `🤖 ${claudine.closer.trim()}` : null
  ].filter(Boolean).join('\n\n');
}

module.exports = { parseTakes, writeClaudineReplies, assembleDuet, CLAUDINE_MODEL };
