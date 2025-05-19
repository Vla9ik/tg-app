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
const CRON_SCHEDULE  = process.env.CRON_SCHEDULE || '0 9 * * *';
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

// Краткий резюме текста через ИИ с обработкой недостатка квоты
async function summarizeRussian(text, maxTokens = 100) {
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: `
Дай краткое резюме на русском (1–2 предложения) этого текста:
"${text}"
      ` }],
      max_tokens: maxTokens,
      temperature: 0.3
    });
    return res.choices[0].message.content.trim() || text;
  } catch (err) {
    if (err.code === 'insufficient_quota') {
      console.warn('⚠️ Квота исчерпана, используем оригинал вместо резюме.');
      return text;
    }
    console.error('Ошибка в summarizeRussian:', err.message);
    return text;
  }
}

// Генерация обложки через DALL·E (также обрабатываем ошибки)
async function generateCover(dateStr) {
  try {
    const prompt = `
Создай минималистичную обложку для дайджеста фронтенд-новостей за ${dateStr}.
Используй иконки HTML, CSS, JS и браузера в мягких тонах.
    `;
    const res = await openai.images.generate({
      prompt: prompt.trim(),
      size: '800x400',
      n: 1
    });
    return res.data[0].url;
  } catch (err) {
    console.error('Ошибка генерации обложки:', err.message);
    return null;
  }
}

// Собираем и переводим дайджест
async function buildDigest() {
  const now     = new Date();
  const dateStr = now.toISOString().slice(0,10);
  const header  = `📰 *Фронтенд-дайджест за ${dateStr}*\n`;
  const lines   = [header];

  for (let { name, url } of feeds) {
    let feed;
    try {
      feed = await parser.parseURL(url);
    } catch (e) {
      console.error(`Не удалось загрузить ${name}:`, e.message);
      continue;
    }
    const items = feed.items
      .filter(i => i.pubDate && isFresh(i.pubDate))
      .slice(0,3);
    console.log(`Feed "${name}": найдено ${items.length}`);
    if (!items.length) continue;

    lines.push(`🔹 *${name}*`);
    for (let { title, contentSnippet, link } of items) {
      const textToSummarize = `${title}${contentSnippet ? ' — ' + contentSnippet : ''}`;
      const summary = await summarizeRussian(textToSummarize, 80);
      lines.push(`• ${summary}`);
      lines.push(`  ▶ [Читать далее](${link})\n`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

// Отправляем обложку и дайджест
async function sendDigest() {
  const dateStr = new Date().toISOString().slice(0,10);
  const coverUrl = await generateCover(dateStr);
  if (coverUrl) {
    await bot.sendPhoto(CHANNEL_ID, coverUrl, {
      caption: `📰 *Фронтенд-дайджест за ${dateStr}*`,
      parse_mode: 'Markdown'
    });
  }
  const text = await buildDigest();
  if (!text) {
    console.log('Нет свежих новостей за период', DIGEST_HOURS, 'ч.');
    return;
  }
  await bot.sendMessage(CHANNEL_ID, text, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  });
  console.log('✅ Дайджест отправлен:', new Date().toISOString());
}

// Планировщик
cron.schedule(CRON_SCHEDULE, () => {
  console.log('🚀 Запуск по расписанию', CRON_SCHEDULE);
  sendDigest();
});

// Быстрый тест
if (process.argv.includes('--run-now')) {
  sendDigest();
}
