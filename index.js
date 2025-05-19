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
const CRON_SCHEDULE  = process.env.CRON_SCHEDULE || '0 */12 * * *'; // каждые 12 часов
const DIGEST_HOURS   = Number(process.env.DIGEST_HOURS) || 24;      // последние 24 ч
const FALLBACK_IMAGE = 'https://placehold.co/800x400?text=Frontend+Digest';

// Логируем коротко, что окружение подхватилось
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

// Проверка свежести записи
function isFresh(pubDate) {
  return (new Date() - new Date(pubDate)) <= DIGEST_HOURS * 3600_000;
}

// Перевод + короткое резюме
async function translateAndSummarize(text) {
  const prompt = `
Переведи на русский и в 1–2 предложениях изложи суть:
"${text}"
`;
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.3
    });
    return res.choices[0].message.content.trim() || text;
  } catch (err) {
    console.warn('⚠️ Ошибка OpenAI, возвращаем оригинал:', err.message);
    return text;
  }
}

// Генерация обложки
async function generateCover(dateStr) {
  const prompt = `
Создай минималистичную обложку для дайджеста фронтенд-новостей за ${dateStr}.
Используй иконки HTML, CSS, JS и браузера.
`;
  try {
    const img = await openai.images.generate({
      prompt: prompt.trim(),
      n: 1,
      size: '800x400'
    });
    return img.data[0].url;
  } catch {
    console.warn('⚠️ Не удалось сгенерировать обложку, используем заглушку');
    return FALLBACK_IMAGE;
  }
}

// Собираем текст дайджеста
async function buildDigest() {
  const dateStr = new Date().toISOString().slice(0,10);
  const header  = `📰 *Фронтенд-дайджест за ${dateStr}*\n`;
  const lines   = [header];

  for (let { name, url } of feeds) {
    let feed;
    try {
      feed = await parser.parseURL(url);
    } catch {
      console.log(`ℹ️ Пропускаем ${name} (недоступен)`);
      continue;
    }
    const items = feed.items
      .filter(i => i.pubDate && isFresh(i.pubDate))
      .slice(0, 3);
    if (!items.length) continue;

    lines.push(`🔹 *${name}*`);
    for (let item of items) {
      const fullText = `${item.title}${item.contentSnippet ? ' — ' + item.contentSnippet : ''}`;
      const summary  = await translateAndSummarize(fullText);
      const [headline, ...rest] = summary.split('\n');
      lines.push(`• [${headline.trim()}](${item.link})`);
      if (rest.length) lines.push(`  Кратко: ${rest.join(' ').trim()}`);
    }
    lines.push('');
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

// Основная функция отправки
async function sendDigest() {
  const dateStr = new Date().toISOString().slice(0,10);
  const cover   = await generateCover(dateStr);

  try {
    await bot.sendPhoto(CHANNEL_ID, cover, {
      caption: `📰 *Фронтенд-дайджест за ${dateStr}*`,
      parse_mode: 'Markdown'
    });
    console.log('✅ Обложка отправлена');
  } catch (err) {
    console.error('❌ Ошибка при отправке обложки:', err.message);
  }

  try {
    const text = await buildDigest();
    if (!text) {
      console.log('ℹ️ Нет свежих новостей за период', DIGEST_HOURS, 'ч.');
      return;
    }
    await bot.sendMessage(CHANNEL_ID, text, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
    console.log('✅ Дайджест отправлен');
  } catch (err) {
    console.error('❌ Ошибка при отправке дайджеста:', err.message);
  }
}

// Планировщик — каждые 12 часов
cron.schedule(CRON_SCHEDULE, () => {
  console.log('🚀 Запуск по расписанию', CRON_SCHEDULE);
  sendDigest();
});

// Тестовый запуск
if (process.argv.includes('--run-now')) {
  sendDigest();
}
