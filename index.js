// index.js
require('dotenv').config();

const Parser      = require('rss-parser');
const TelegramBot = require('node-telegram-bot-api');
const cron        = require('node-cron');
const OpenAI      = require('openai');

// —————— КОНФИГУРАЦИЯ ——————
const BOT_TOKEN      = process.env.BOT_TOKEN;
const CHANNEL_ID     = process.env.CHANNEL_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CRON_SCHEDULE  = process.env.CRON_SCHEDULE || '0 * * * *';
const DIGEST_HOURS   = Number(process.env.DIGEST_HOURS) || 24;

console.log('✅ ENV:', {
  BOT_TOKEN: !!BOT_TOKEN,
  CHANNEL_ID: !!CHANNEL_ID,
  OPENAI:    !!OPENAI_API_KEY,
  CRON:      CRON_SCHEDULE,
  HOURS:     DIGEST_HOURS
});

const feeds = [
  { name: 'Smashing Magazine',        url: 'https://www.smashingmagazine.com/feed/' },
  { name: 'CSS-Tricks',               url: 'https://css-tricks.com/feed/' },
  { name: 'Dev.to (frontend)',        url: 'https://dev.to/feed/frontend' },
  { name: 'Frontend Focus',           url: 'https://frontendfoc.us/rss' },
  // … другие ленты …
];

const parser = new Parser();
const bot    = new TelegramBot(BOT_TOKEN, { polling: false });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function isFresh(pubDate) {
  return (new Date() - new Date(pubDate)) <= DIGEST_HOURS * 3600_000;
}

async function translateToRussian(text) {
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: `Переведи на русский:\n\n${text}` }],
      max_tokens: 200,
      temperature: 0.2
    });
    return res.choices[0].message.content.trim() || text;
  } catch {
    return text;
  }
}

async function buildDigest() {
  const now     = new Date();
  const dateStr = now.toISOString().slice(0,16).replace('T',' ');
  const header  = `📰 *Дайджест фронтенд-новостей за последние ${DIGEST_HOURS}ч (на ${dateStr})*\n`;
  const lines   = [header];

  for (let { name, url } of feeds) {
    const feed  = await parser.parseURL(url);
    const items = feed.items
      .filter(i => i.pubDate && isFresh(i.pubDate))
      .slice(0, 3);

    if (!items.length) continue;

    lines.push(`🔹 *${name}*`);
    for (let item of items) {
      // Берём и переводим заголовок и сниппет
      const titleRu   = await translateToRussian(item.title);
      const snippet   = item.contentSnippet || '';
      const snippetRu = snippet ? await translateToRussian(snippet) : '';

      lines.push(`• *${titleRu}*`);
      if (snippetRu) {
        lines.push(`  Кратко: ${snippetRu}`);
      }
      lines.push(`  Читать дальше: [ссылка](${item.link})\n`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

async function sendDigest() {
  const text = await buildDigest();
  if (!text) {
    console.log('Нет новостей за период', DIGEST_HOURS, 'ч.');
    return;
  }
  await bot.sendMessage(CHANNEL_ID, text, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  });
  console.log('✅ Дайджест отправлен:', new Date().toISOString());
}

cron.schedule(CRON_SCHEDULE, sendDigest);

if (process.argv.includes('--run-now')) {
  sendDigest();
}
