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
const CRON_SCHEDULE  = process.env.CRON_SCHEDULE || '0 9 * * *'; // каждый день в 09:00
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
  { name: 'A List Apart',             url: 'https://alistapart.com/feed/' },
  { name: 'SitePoint (Front End)',    url: 'https://www.sitepoint.com/front-end/feed/' },
  { name: 'JavaScript Weekly',        url: 'https://javascriptweekly.com/rss/' },
  { name: 'CSS Weekly',               url: 'https://css-weekly.com/feed/' },
  { name: 'HTML5 Weekly',             url: 'https://html5weekly.com/rss.xml' },
  { name: 'React Status',             url: 'https://react.statuscode.com/rss' },
  { name: 'Vue.js News',              url: 'https://news.vuejs.org/rss.xml' },
  { name: 'Angular Blog',             url: 'https://blog.angular.io/feed.xml' },
  { name: 'TypeScript Weekly',        url: 'https://www.typescriptweekly.com/rss.xml' },
  { name: 'Reddit r/frontend',        url: 'https://www.reddit.com/r/frontend/.rss' },
  { name: 'Hacker News (Front Page)', url: 'https://hnrss.org/frontpage' },
  { name: 'Medium (Frontend Tag)',    url: 'https://medium.com/feed/tag/frontend' }
];

const parser = new Parser();
const bot    = new TelegramBot(BOT_TOKEN, { polling: false });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Проверка свежести: за последние DIGEST_HOURS часов
function isFresh(pubDate) {
  return (new Date() - new Date(pubDate)) <= DIGEST_HOURS * 3600_000;
}

// Краткий резюме текста через ИИ
async function summarizeRussian(text, maxTokens = 100) {
  const prompt = `
Дай краткое резюме на русском (1–2 предложения) следующего текста, выделив суть:
"${text}"
`;
  const res = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.3
  });
  return res.choices[0].message.content.trim();
}

// Генерация обложки через DALL·E
async function generateCover(dateStr) {
  const prompt = `
Создай минималистичную иконографическую обложку для дайджеста новостей по фронтенд-разработке за ${dateStr}.
Используй элементы HTML, CSS, JS и иконку браузера, в мягких тонах.
`;
  const res = await openai.images.generate({
    prompt: prompt.trim(),
    size: '800x400',
    n: 1
  });
  return res.data[0].url;
}

// Собираем и переводим дайджест
async function buildDigest() {
  const now     = new Date();
  const dateStr = now.toISOString().slice(0,10); // YYYY-MM-DD
  const header  = `📰 *Дайджест фронтенд-новостей за ${dateStr}*\n`;
  const lines   = [header];

  for (let { name, url } of feeds) {
    let feed;
    try {
      feed = await parser.parseURL(url);
    } catch (e) {
      console.error(`Не загрузить ${name}:`, e.message);
      continue;
    }

    const items = feed.items
      .filter(i => i.pubDate && isFresh(i.pubDate))
      .slice(0, 3);

    if (!items.length) continue;
    lines.push(`🔹 *${name}*`);

    for (let item of items) {
      // резюме заголовка и сниппета
      const titleSum   = await summarizeRussian(item.title, 50);
      const snippet    = item.contentSnippet || '';
      const snippetSum = snippet ? await summarizeRussian(snippet, 80) : '';

      lines.push(`• ${titleSum}`);
      if (snippetSum) lines.push(`  _${snippetSum}_`);
      lines.push(`  ▶ [Читать полностью](${item.link})\n`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

// Отправка обложки и дайджеста
async function sendDigest() {
  const now     = new Date();
  const dateStr = now.toISOString().slice(0,10);
  // 1) Обложка
  let coverUrl;
  try {
    coverUrl = await generateCover(dateStr);
    await bot.sendPhoto(CHANNEL_ID, coverUrl, {
      caption: `📰 *Фронтенд-дайджест за ${dateStr}*`,
      parse_mode: 'Markdown'
    });
  } catch (e) {
    console.error('Не удалось сгенерировать обложку:', e.message);
  }
  // 2) Текст дайджеста
  const text = await buildDigest();
  if (!text) {
    console.log('Нет свежих новостей за период', DIGEST_HOURS, 'ч.');
    return;
  }
  await bot.sendMessage(CHANNEL_ID, text, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  });
  console.log('✅ Отправлен дайджест:', new Date().toISOString());
}

// Планировщик
cron.schedule(CRON_SCHEDULE, () => {
  console.log('Запуск sendDigest() по расписанию', CRON_SCHEDULE);
  sendDigest();
});

// Тестовый запуск
if (process.argv.includes('--run-now')) {
  sendDigest();
}
