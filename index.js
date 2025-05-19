// index.js
require('dotenv').config();
const Parser         = require('rss-parser');
const TelegramBot    = require('node-telegram-bot-api');
const cron           = require('node-cron');
const { Configuration, OpenAIApi } = require('openai');

const parser = new Parser();

// —————— КОНФИГУРАЦИЯ ——————

// Токены (лучше выносить в env / .env, но здесь для примера)
const BOT_TOKEN      = process.env.BOT_TOKEN;
const CHANNEL_ID     = process.env.CHANNEL_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CRON_SCHEDULE  = process.env.CRON_SCHEDULE || '*/05 * * * *';
const DIGEST_HOURS   = Number(process.env.DIGEST_HOURS) || 24;


// RSS-ленты фронтенд-тематики
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


// —————— ИНИЦИАЛИЗАЦИЯ ——————
const bot    = new TelegramBot(BOT_TOKEN, { polling: false });
const openai = new OpenAIApi(new Configuration({ apiKey: OPENAI_API_KEY }));

// Проверка свежих новостей: за DIGEST_HOURS часов
function isFresh(pubDate) {
  return (new Date() - new Date(pubDate)) <= DIGEST_HOURS * 60 * 60 * 1000;
}

// Перевод текста на русский через OpenAI
async function translateToRussian(text) {
  const res = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: `Переведи на русский:\n\n${text}` }],
    max_tokens: 200,
    temperature: 0.2
  });
  return res.data.choices[0].message.content.trim();
}

// Генерация текста дайджеста
async function buildDigest() {
  const now     = new Date();
  const dateStr = now.toISOString().slice(0,16).replace('T',' ');
  let lines     = [`📰 *Дайджест фронтенд-новостей за последние ${DIGEST_HOURS}ч (по состоянию на ${dateStr})*\n`];

  for (let { name, url } of feeds) {
    try {
      const feed  = await parser.parseURL(url);
      const items = feed.items
        .filter(i => i.pubDate && isFresh(i.pubDate))
        .slice(0,3);  // берём до 3 новостей с каждого источника

      if (!items.length) continue;

      lines.push(`🔹 *${name}*`);
      for (let i of items) {
        const titleRu = await translateToRussian(i.title);
        lines.push(`• ${titleRu} — [читать](${i.link})`);
      }
      lines.push('');
    } catch (e) {
      console.error(`Ошибка при парсинге ${name}:`, e.message);
    }
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

// Отправка дайджеста
async function sendDigest() {
  const digest = await buildDigest();
  if (!digest) {
    console.log('Нет свежих новостей за период', DIGEST_HOURS, 'ч.');
    return;
  }
  await bot.sendMessage(CHANNEL_ID, digest, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  });
  console.log('Дайджест отправлен по расписанию', CRON_SCHEDULE, new Date().toISOString());
}

// Запуск по расписанию
cron.schedule(CRON_SCHEDULE, sendDigest);

// Для теста можно запустить сразу командой `node index.js`
if (process.argv.includes('--run-now')) {
  sendDigest();
}
