// Firebase Cloud Functions 入口
// 功能:記帳 / 筆記 / 整週行程 / 刪除與搜尋行程 / 今日總覽 / 快捷按鈕
// - webhookLine: LINE Webhook,取代原本 webhook.js 的 Express 伺服器
//   支援四種意圖:新增行程 / 查天氣 / 查行程(今天、上午下午、特定時間點) / 閒聊
// - dailyBriefing: 每天 07:00 排程,取代原本 Windows 工作排程器 + daily-bot.js

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const line = require('@line/bot-sdk');

const { authorize } = require('./services/googleAuth');
const {
  getTodayEvents,
  getEventsForDay,
  getEventsForRange,
  searchEvents,
  addEvent,
  addRecurringEvent,
  updateEventTime,
  deleteEvent,
} = require('./services/calendarService');
const { taipeiDayStart } = require('./services/dateUtil');
const { getTodayWeather } = require('./services/weatherService');
const { generateBriefingData } = require('./services/aiService');
const { parseWithRules } = require('./services/ruleParser');
const { parseWithClaude } = require('./services/claudeService');
const { buildMorningBriefingFlex, buildListCard, COLOR, rainColor } = require('./services/flexMessageBuilder');
const { getFreeSlotsForDay, WORK_START_HOUR, WORK_END_HOUR } = require('./services/freeSlotService');
const { pushMessage } = require('./services/lineService');
const sheetsService = require('./services/sheetsService');
const { classify } = require('./services/expenseCategory');
const taskManager = require('./modules/taskManager');

// ── Secrets(名稱需對應 firebase functions:secrets:set 建立的名稱)──
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const CWA_API_KEY = defineSecret('CWA_API_KEY');
const LINE_CHANNEL_ACCESS_TOKEN = defineSecret('LINE_CHANNEL_ACCESS_TOKEN');
const LINE_CHANNEL_SECRET = defineSecret('LINE_CHANNEL_SECRET');
const LINE_USER_ID = defineSecret('LINE_USER_ID');
const GOOGLE_CREDENTIALS_JSON = defineSecret('GOOGLE_CREDENTIALS_JSON');
const GOOGLE_TOKEN_JSON = defineSecret('GOOGLE_TOKEN_JSON');
const GOOGLE_SHEETS_ID = defineSecret('GOOGLE_SHEETS_ID');

// webhookLine 現在以規則解析為主,只有規則判斷不出來時才呼叫 Claude(不需要 Gemini)
const WEBHOOK_SECRETS = [
  ANTHROPIC_API_KEY,
  CWA_API_KEY,
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
  LINE_USER_ID,
  GOOGLE_CREDENTIALS_JSON,
  GOOGLE_TOKEN_JSON,
  GOOGLE_SHEETS_ID,
];

// 每日晨報維持用 Gemini 生成摘要文字(一天只呼叫一次,不受額度影響)
const BRIEFING_SECRETS = [
  GEMINI_API_KEY,
  CWA_API_KEY,
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_USER_ID,
  GOOGLE_CREDENTIALS_JSON,
  GOOGLE_TOKEN_JSON,
];

// 週間回顧不需要任何 AI,純資料彙整(記帳+筆記+下週行程)
const WEEKLY_SECRETS = [
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_USER_ID,
  GOOGLE_CREDENTIALS_JSON,
  GOOGLE_TOKEN_JSON,
  GOOGLE_SHEETS_ID,
];

const REGION = 'asia-east1'; // 台灣機房,延遲較低

// ── 共用格式化 / 篩選工具 ──

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatEventLine(e) {
  return `・ ${e.isAllDay ? '全天' : formatTime(e.start)} ${e.summary}`;
}

function getTaipeiHour(iso) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', hour: 'numeric', hour12: false }).formatToParts(
    new Date(iso)
  );
  const hourPart = parts.find((p) => p.type === 'hour');
  return Number(hourPart.value) % 24;
}

const PERIOD_RANGES = { morning: [0, 12], afternoon: [12, 18], evening: [18, 24] };
const PERIOD_WORD = { morning: '上午', afternoon: '下午', evening: '晚上' };

function filterEventsByPeriod(events, period) {
  const range = PERIOD_RANGES[period];
  if (!range) return events; // period === 'all'
  const [from, to] = range;
  return events.filter((e) => e.isAllDay || (getTaipeiHour(e.start) >= from && getTaipeiHour(e.start) < to));
}

function findEventsAtTime(events, iso) {
  const t = new Date(iso).getTime();
  return events.filter((e) => e.isAllDay || (t >= new Date(e.start).getTime() && t < new Date(e.end).getTime()));
}

function buildDayLabel(dateOffset) {
  if (dateOffset === 0) return '今天';
  if (dateOffset === 1) return '明天';
  if (dateOffset === 2) return '後天';
  return `${dateOffset} 天後`;
}

function formatDateShort(iso) {
  return new Date(iso).toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
}

// 抓出今天的生日/紀念日(全天事件,標題開頭是 🎂 或 🎉),回傳去掉 emoji 的名稱陣列
function getSpecialDayNames(events) {
  return events
    .filter((e) => e.isAllDay && /^[🎂🎉]/u.test(e.summary))
    .map((e) => e.summary.replace(/^[🎂🎉]\s*/u, ''));
}

// 常用指令改由「圖文選單」(rich menu,見 setup-richmenu.js)常駐提供,不再用 Quick Reply

function reply(client, event, text) {
  return client.replyMessage(event.replyToken, { type: 'text', text });
}

// 卡片回覆(清單類資訊用)
function replyCard(client, event, card) {
  return client.replyMessage(event.replyToken, card);
}

// 把行程清單依日期分組,回傳 buildListCard 需要的 sections
function groupEventsIntoSections(events) {
  const groups = new Map();
  for (const e of events) {
    const key = formatDateShort(e.start);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups].map(([date, items]) => ({
    heading: date,
    rows: items.map((e) => ({ left: e.isAllDay ? '全天' : formatTime(e.start), right: e.summary })),
  }));
}

// ── 各意圖的處理函式 ──

async function handleAddEvent(event, client, parsed) {
  const auth = authorize();

  // 衝突查詢跟新增行程互不依賴,平行送出,省一次來回的時間
  const t0 = Date.now();
  const [conflicts, created] = await Promise.all([
    taskManager.checkScheduleConflict(auth, { start: parsed.start, end: parsed.end }),
    addEvent(auth, { summary: parsed.title, start: parsed.start, end: parsed.end }),
  ]);
  logger.info(`[timing] Calendar API(衝突查詢+新增,平行)耗時 ${Date.now() - t0}ms`);

  const lines = [
    '✅ 已幫你加入行程',
    `📌 ${created.summary}`,
    `🕒 ${formatDateTime(created.start)} - ${formatDateTime(created.end)}`,
  ];
  if (conflicts.length > 0) {
    lines.push('', `⚠️ 這個時段跟「${conflicts[0].summary}」有重疊,記得確認一下喔`);
  }

  return reply(client, event, lines.join('\n'));
}

function formatWeatherText(weather) {
  return [
    `🌤 今天天氣(${weather.location})`,
    `${weather.description},降雨機率 ${weather.rainChance}%`,
    `氣溫 ${weather.minTemp}°C - ${weather.maxTemp}°C`,
  ].join('\n');
}

async function handleWeatherQuery(event, client) {
  const t0 = Date.now();
  const weather = await getTodayWeather();
  logger.info(`[timing] CWA 天氣 API 耗時 ${Date.now() - t0}ms`);
  return reply(client, event, formatWeatherText(weather));
}

async function handleScheduleQuery(event, client, parsed) {
  const auth = authorize();
  const t0 = Date.now();
  const events = await getEventsForDay(auth, parsed.dateOffset);
  logger.info(`[timing] Calendar API(查詢)耗時 ${Date.now() - t0}ms`);
  const dayLabel = buildDayLabel(parsed.dateOffset);

  if (parsed.specificTime) {
    const matched = findEventsAtTime(events, parsed.specificTime);
    const timeLabel = formatTime(parsed.specificTime);
    const text = matched.length
      ? `🕒 ${dayLabel} ${timeLabel} 的行程:\n${matched.map(formatEventLine).join('\n')}`
      : `🕒 ${dayLabel} ${timeLabel} 目前沒有安排行程,是空的喔`;
    return reply(client, event, text);
  }

  const filtered = filterEventsByPeriod(events, parsed.period);
  const label = `${dayLabel}${PERIOD_WORD[parsed.period] || ''}`;
  const text = filtered.length
    ? `📅 ${label}的行程:\n${filtered.map(formatEventLine).join('\n')}`
    : `📅 ${label}沒有安排行程,輕鬆一下吧！`;

  return reply(client, event, text);
}

// ── 今日總覽:天氣 + 行程一次回覆(卡片)──
async function handleOverview(event, client) {
  const auth = authorize();
  const [weather, events] = await Promise.all([getTodayWeather(), getEventsForDay(auth, 0)]);
  const specialNames = getSpecialDayNames(events);

  const card = buildListCard({
    title: '☀️ 今日總覽',
    subtitle: new Date().toLocaleDateString('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
    }),
    hero: { value: `${weather.rainChance}%`, label: `降雨機率・${weather.description}・${weather.minTemp}-${weather.maxTemp}°C` },
    accent: rainColor(weather.rainChance),
    sections: [
      ...(specialNames.length ? [{ heading: '🎉 特別日子', rows: specialNames.map((n) => ({ left: n })) }] : []),
      {
        heading: `📅 今日行程(${events.length} 筆)`,
        rows: events.map((e) => ({ left: e.isAllDay ? '全天' : formatTime(e.start), right: e.summary })),
        emptyText: '今天沒有安排行程,輕鬆一下吧！',
      },
    ],
  });

  return replyCard(client, event, card);
}

// ── 整週行程:依日期分組列出(卡片)──
async function handleWeekQuery(event, client, parsed) {
  const auth = authorize();
  const events = await getEventsForRange(auth, parsed.dayOffset, parsed.days);
  const label = parsed.dayOffset >= 7 ? '下週' : '這週';

  const card = buildListCard({
    title: `📅 ${label}行程`,
    subtitle: `未來 ${parsed.days} 天・共 ${events.length} 筆`,
    sections: events.length
      ? groupEventsIntoSections(events)
      : [{ rows: [], emptyText: `${label}沒有安排行程,可以好好安排一下` }],
  });

  return replyCard(client, event, card);
}

// ── 關鍵字搜尋行程(卡片)──
async function handleSearchEvent(event, client, parsed) {
  const auth = authorize();
  const found = await searchEvents(auth, parsed.keyword);

  const card = buildListCard({
    title: `🔍 搜尋:${parsed.keyword}`,
    subtitle: found.length ? `找到 ${found.length} 筆(前後半年內)` : '搜尋範圍:前後半年內',
    sections: found.length
      ? [
          {
            rows: found.slice(0, 12).map((e) => ({
              left: formatDateShort(e.start),
              right: `${e.isAllDay ? '全天' : formatTime(e.start)} ${e.summary}`,
            })),
          },
        ]
      : [{ rows: [], emptyText: `找不到跟「${parsed.keyword}」有關的行程` }],
    footerText: found.length > 12 ? `還有 ${found.length - 12} 筆未顯示` : null,
  });

  return replyCard(client, event, card);
}

// ── 查空檔 ──
async function handleFreeSlots(event, client, parsed) {
  const auth = authorize();
  const sections = [];
  let totalSlots = 0;

  for (let i = 0; i < parsed.days; i++) {
    const dayOffset = parsed.dayOffset + i;
    const events = await getEventsForDay(auth, dayOffset);
    const slots = getFreeSlotsForDay(events, dayOffset, parsed.period);
    totalSlots += slots.length;

    const heading =
      parsed.days === 1
        ? null
        : new Date(Date.now() + dayOffset * 86400000).toLocaleDateString('zh-TW', {
            timeZone: 'Asia/Taipei',
            month: '2-digit',
            day: '2-digit',
            weekday: 'short',
          });

    sections.push({
      heading,
      rows: slots.map((s) => ({ left: `${formatTime(s.start)}-${formatTime(s.end)}`, right: '可安排' })),
      emptyText: parsed.days === 1 ? '這個時段已經排滿了' : '整天排滿',
    });
  }

  const periodWord = PERIOD_WORD[parsed.period] || '';
  const dayLabel = parsed.days === 1 ? buildDayLabel(parsed.dayOffset) : parsed.dayOffset >= 7 ? '下週' : '這週';

  const card = buildListCard({
    title: `🗓 ${dayLabel}${periodWord}空檔`,
    subtitle: `可安排時間 ${WORK_START_HOUR}:00-${WORK_END_HOUR}:00・共 ${totalSlots} 個時段`,
    accent: totalSlots ? COLOR.rainLow : COLOR.rainMid,
    sections,
    footerText: '全天事件不佔用時段,少於 30 分鐘的空檔不顯示',
  });

  return replyCard(client, event, card);
}

// ── 改期 ──
async function handleReschedule(event, client, parsed) {
  const auth = authorize();

  // 先定位要改的是哪一筆
  let candidates;
  if (parsed.sourceDayOffset !== null && parsed.sourceDayOffset !== undefined) {
    candidates = await getEventsForDay(auth, parsed.sourceDayOffset);
    if (parsed.sourceTime) candidates = findEventsAtTime(candidates, parsed.sourceTime);
    if (parsed.sourceKeyword) candidates = candidates.filter((e) => e.summary.includes(parsed.sourceKeyword));
  } else {
    candidates = await searchEvents(auth, parsed.sourceKeyword);
  }
  candidates = candidates.filter((e) => !e.isAllDay); // 全天事件沒有時間可改

  if (!candidates.length) {
    return reply(client, event, '🔍 找不到要改期的行程,可以試試「把明天的會議改到後天」');
  }
  if (candidates.length > 1) {
    const card = buildListCard({
      title: '⚠️ 找到多筆行程',
      subtitle: '請講得更明確一點,例如帶上行程名稱',
      accent: COLOR.rainMid,
      sections: [
        {
          rows: candidates.slice(0, 8).map((e) => ({
            left: formatDateShort(e.start),
            right: `${formatTime(e.start)} ${e.summary}`,
          })),
        },
      ],
    });
    return replyCard(client, event, card);
  }

  // 算出新的起訖時間:沒指定新時間就沿用原本的時間,只換日期
  const target = candidates[0];
  const oldStart = new Date(target.start);
  const durationMs = new Date(target.end).getTime() - oldStart.getTime();

  const baseOffset = parsed.newDayOffset !== null ? parsed.newDayOffset : parsed.sourceDayOffset || 0;
  const dayBase = taipeiDayStart(baseOffset);

  const hour = parsed.newHour !== null ? parsed.newHour : Number(formatTime(target.start).split(':')[0]);
  const minute = parsed.newMinute !== null ? parsed.newMinute : Number(formatTime(target.start).split(':')[1]);

  const newStart = new Date(dayBase.getTime() + (hour * 60 + minute) * 60 * 1000);
  const newEnd = new Date(newStart.getTime() + durationMs);

  const updated = await updateEventTime(auth, target.id, {
    start: newStart.toISOString(),
    end: newEnd.toISOString(),
  });

  return reply(
    client,
    event,
    `🔄 已改期\n📌 ${updated.summary}\n舊:${formatDateTime(target.start)}\n新:${formatDateTime(updated.start)}`
  );
}

// ── 循環行程 ──
async function handleRecurringEvent(event, client, parsed) {
  const auth = authorize();
  const end = new Date(new Date(parsed.firstStart).getTime() + 60 * 60 * 1000).toISOString();

  const created = await addRecurringEvent(auth, {
    summary: parsed.title,
    start: parsed.firstStart,
    end,
    recurrence: parsed.recurrence,
  });

  return reply(
    client,
    event,
    `🔁 已建立循環行程\n📌 ${created.summary}\n🔄 ${parsed.description}\n🕒 從 ${formatDateTime(created.start)} 開始`
  );
}

// ── 刪除行程:找不到就說找不到,找到多筆就請使用者講清楚,只有唯一一筆才真的刪 ──
async function handleDeleteEvent(event, client, parsed) {
  const auth = authorize();

  let candidates;
  if (parsed.dateOffset !== null && parsed.dateOffset !== undefined) {
    candidates = await getEventsForDay(auth, parsed.dateOffset);
    if (parsed.targetTime) candidates = findEventsAtTime(candidates, parsed.targetTime);
    if (parsed.keyword) {
      candidates = candidates.filter((e) => e.summary.includes(parsed.keyword));
    }
  } else {
    candidates = await searchEvents(auth, parsed.keyword);
  }

  if (!candidates.length) {
    return reply(client, event, `🔍 找不到符合的行程,可以換個說法試試(例如「取消 牙醫」)`);
  }

  if (candidates.length > 1) {
    const lines = ['⚠️ 找到多筆符合的行程,請講得更明確一點:'];
    for (const e of candidates.slice(0, 8)) {
      lines.push(`・${formatDateShort(e.start)} ${e.isAllDay ? '全天' : formatTime(e.start)} ${e.summary}`);
    }
    return reply(client, event, lines.join('\n'));
  }

  const target = candidates[0];
  await deleteEvent(auth, target.id);
  return reply(
    client,
    event,
    `🗑 已刪除行程\n📌 ${target.summary}\n🕒 ${formatDateTime(target.start)}`
  );
}

// ── 記帳 ──

// 記帳後檢查剛剛入帳的分類這個月是不是已經超出預算(只有設定過預算的分類才會檢查)
async function buildBudgetWarning(auth, items) {
  const status = await sheetsService.getBudgetStatus(auth);
  if (!status.items.length) return '';

  const touched = new Set(items.map((i) => classify(i.item)));
  const overs = status.items.filter((b) => touched.has(b.category) && b.remaining < 0);
  if (!overs.length) return '';

  return (
    '\n\n' +
    overs
      .map((b) => `⚠️ ${b.category}本月已超支 $${Math.abs(b.remaining).toLocaleString()}(預算 $${b.budget.toLocaleString()},已花 $${b.spent.toLocaleString()})`)
      .join('\n')
  );
}

async function handleAddExpense(event, client, parsed) {
  const auth = authorize();
  await sheetsService.addExpense(auth, { item: parsed.item, amount: parsed.amount });
  const warning = await buildBudgetWarning(auth, [{ item: parsed.item }]);
  return reply(client, event, `💰 已記帳\n${parsed.item} $${parsed.amount}${warning}`);
}

async function handleAddExpenses(event, client, parsed) {
  const auth = authorize();
  await sheetsService.addExpenses(auth, parsed.entries);
  const total = parsed.entries.reduce((s, e) => s + e.amount, 0);
  const detail = parsed.entries.map((e) => `・${e.item} $${e.amount}`).join('\n');
  const warning = await buildBudgetWarning(auth, parsed.entries);
  return reply(client, event, `💰 已記帳 ${parsed.entries.length} 筆(共 $${total})\n${detail}${warning}`);
}

async function handleDeleteLastExpense(event, client) {
  const auth = authorize();
  const removed = await sheetsService.deleteLastExpense(auth);
  if (!removed) return reply(client, event, '💰 目前沒有任何記帳紀錄可以刪除');
  return reply(client, event, `🗑 已刪除最後一筆\n${removed.item} $${removed.amount}`);
}

async function handleUpdateLastExpense(event, client, parsed) {
  const auth = authorize();
  const updated = await sheetsService.updateLastExpenseAmount(auth, parsed.amount);
  if (!updated) return reply(client, event, '💰 目前沒有任何記帳紀錄可以修改');
  return reply(client, event, `✏️ 已修正\n${updated.item}:$${updated.oldAmount} → $${updated.newAmount}`);
}

function buildExpenseCard({ yearMonth, total, count, topItems }, byCategory, { title, subtitle, accent, footerText } = {}) {
  return buildListCard({
    title: title || `💰 ${yearMonth} 支出統計`,
    subtitle: subtitle || `${count} 筆紀錄`,
    accent,
    hero: { value: `$${total.toLocaleString()}`, label: `${yearMonth} 總支出・${count} 筆` },
    sections: [
      {
        heading: '📊 分類佔比',
        rows: byCategory.map((c) => ({ left: c.category, right: `$${c.total.toLocaleString()}`, bold: true })),
        emptyText: '這個月還沒有任何記帳紀錄',
      },
      {
        heading: '花最多的項目',
        rows: topItems.map(([item, amount]) => ({ left: item, right: `$${amount.toLocaleString()}`, bold: true })),
        emptyText: '這個月還沒有任何記帳紀錄',
      },
    ],
    footerText,
  });
}

async function handleExpenseQuery(event, client, parsed) {
  const auth = authorize();
  const yearMonth = parsed && parsed.yearMonth;
  const [summary, byCategory] = await Promise.all([
    sheetsService.getMonthlyExpense(auth, yearMonth),
    sheetsService.getMonthlyExpenseByCategory(auth, yearMonth),
  ]);

  if (!summary.count) {
    return reply(client, event, `💰 ${summary.yearMonth} 沒有任何記帳紀錄`);
  }
  return replyCard(client, event, buildExpenseCard(summary, byCategory));
}

// ── 剩餘預算 ──
async function handleBudgetStatus(event, client) {
  const auth = authorize();
  const status = await sheetsService.getBudgetStatus(auth);

  if (!status.items.length) {
    return reply(
      client,
      event,
      '📊 目前還沒有設定任何預算\n到 Google Sheet 的「預算」分頁,把想設定的分類金額改成大於 0 的數字就會開始追蹤(例如「房租」改成 3000)'
    );
  }

  const card = buildListCard({
    title: '💰 本月預算',
    subtitle: status.yearMonth,
    accent: status.totalRemaining < 0 ? COLOR.rainHigh : COLOR.rainLow,
    hero: {
      value: `$${status.totalRemaining.toLocaleString()}`,
      label: `總剩餘・已花 $${status.totalSpent.toLocaleString()} / 預算 $${status.totalBudget.toLocaleString()}`,
    },
    sections: [
      {
        rows: status.items.map((b) => ({
          left: b.category,
          right: `$${b.spent.toLocaleString()} / $${b.budget.toLocaleString()}${b.remaining < 0 ? '⚠️' : ''}`,
          bold: b.remaining < 0,
        })),
      },
    ],
    footerText: '要調整預算金額,到 Google Sheet 的「預算」分頁改就好',
  });

  return replyCard(client, event, card);
}

// ── 單日/區間記帳查詢 ──
async function handleExpenseRangeQuery(event, client, parsed) {
  const auth = authorize();
  const { total, count, items } = await sheetsService.getExpensesByDateRange(auth, parsed.startDate, parsed.endDate);

  if (!count) {
    return reply(client, event, `💰 ${parsed.label} 沒有任何記帳紀錄`);
  }

  const card = buildListCard({
    title: `💰 ${parsed.label} 支出`,
    subtitle: `${count} 筆紀錄`,
    hero: { value: `$${total.toLocaleString()}`, label: `總支出・${count} 筆` },
    sections: [
      {
        rows: items.slice(0, 15).map((e) => ({ left: formatDateShort(e.date), right: `${e.item} $${e.amount}` })),
      },
    ],
    footerText: items.length > 15 ? `還有 ${items.length - 15} 筆未顯示` : null,
  });

  return replyCard(client, event, card);
}

// ── 本月 vs 上月比較 ──
async function handleExpenseCompare(event, client) {
  const auth = authorize();
  const { current, previous, diff } = await sheetsService.compareMonthlyExpense(auth);

  const trend = diff > 0 ? `多花了 $${diff.toLocaleString()}` : diff < 0 ? `少花了 $${Math.abs(diff).toLocaleString()}` : '跟上個月一樣';
  const accent = diff > 0 ? COLOR.rainHigh : diff < 0 ? COLOR.rainLow : COLOR.primary;

  const card = buildListCard({
    title: '📊 本月 vs 上月',
    subtitle: `${previous.yearMonth} → ${current.yearMonth}`,
    accent,
    hero: { value: trend, label: `本月 $${current.total.toLocaleString()}・上月 $${previous.total.toLocaleString()}` },
    sections: [
      {
        heading: '本月花最多的項目',
        rows: current.topItems.map(([item, amount]) => ({ left: item, right: `$${amount.toLocaleString()}`, bold: true })),
        emptyText: '本月還沒有記帳紀錄',
      },
    ],
    footerText: `本月 ${current.count} 筆・上月 ${previous.count} 筆`,
  });

  return replyCard(client, event, card);
}

// ── 指令說明 ──
const HELP_SECTIONS = [
  {
    heading: '📅 行程',
    rows: [
      { left: '新增', right: '明天下午3點跟設計師開會' },
      { left: '循環', right: '每週三下午2點健身' },
      { left: '改期', right: '把明天的會議改到後天' },
      { left: '取消', right: '取消 牙醫' },
      { left: '搜尋', right: '牙醫什麼時候 / 找 攝影' },
      { left: '查詢', right: '今天行程 / 這週行程 / 下午3點有沒有行程' },
      { left: '空檔', right: '這週哪天有空 / 明天下午有空嗎' },
    ],
  },
  {
    heading: '💰 記帳',
    rows: [
      { left: '記一筆', right: '午餐 120' },
      { left: '加備註', right: '晚餐100 備註正宗排骨飯(之後可以搜尋到)' },
      { left: '記多筆', right: '早餐50 午餐120 晚餐200' },
      { left: '刪除', right: '刪掉剛剛那筆' },
      { left: '改金額', right: '改成 150' },
      { left: '統計', right: '這個月花多少(含分類佔比)' },
      { left: '查月份', right: '上個月花多少 / 7月花多少' },
      { left: '查單日', right: '今天花多少 / 昨天花多少 / 8月20日花多少' },
      { left: '查區間', right: '8/1到8/15花多少' },
      { left: '比較', right: '這個月比上個月多花多少' },
      { left: '搜尋', right: '找記帳 隨身碟' },
      { left: '設定預算', right: '設定預算 房租 3000' },
      { left: '剩餘預算', right: '剩餘預算' },
      { left: '存款分配', right: '薪水32000 扣3000房租 扣5000存款' },
      { left: '存款統計', right: '本月存了多少' },
    ],
  },
  {
    heading: '📝 筆記',
    rows: [
      { left: '記下', right: '記一下要買隨身碟' },
      { left: '查看', right: '我的筆記' },
      { left: '完成', right: '完成 1 / 完成 1,2' },
      { left: '刪除', right: '刪除筆記 1' },
      { left: '搜尋', right: '找筆記 隨身碟' },
    ],
  },
  {
    heading: '🌤 其他',
    rows: [
      { left: '天氣', right: '今天天氣' },
      { left: '總覽', right: '今天狀況(天氣+行程)' },
    ],
  },
];

async function handleHelp(event, client) {
  const card = buildListCard({
    title: '🤖 呆呆秘書 使用說明',
    subtitle: '直接用講的就可以,不用記精確格式',
    sections: HELP_SECTIONS,
    footerText: '每天早上 07:00 會自動推播晨報',
  });
  return replyCard(client, event, card);
}

// ── 筆記 ──
async function handleAddNote(event, client, parsed) {
  const auth = authorize();
  await sheetsService.addNote(auth, parsed.content);
  return reply(client, event, `📝 已記下\n${parsed.content}`);
}

async function handleQueryNotes(event, client) {
  const auth = authorize();
  const notes = await sheetsService.getPendingNotes(auth);

  if (!notes.length) {
    return reply(client, event, '📝 目前沒有待辦筆記,很清爽！');
  }

  const lines = [`📝 待辦筆記(${notes.length} 則)`];
  notes.forEach((n, i) => lines.push(`${i + 1}. ${n.content}`));
  lines.push('', '完成傳「完成 1」、刪除傳「刪除筆記 1」,也可以一次多個「完成 1,2」');

  return reply(client, event, lines.join('\n'));
}

async function handleCompleteNote(event, client, parsed) {
  const auth = authorize();
  const done = await sheetsService.completeNotes(auth, parsed.indices);

  if (!done.length) {
    return reply(client, event, `🤔 找不到指定的筆記,可以先傳「我的筆記」看看清單`);
  }
  return reply(client, event, `✅ 已完成 ${done.length} 則\n${done.map((n) => `・${n.content}`).join('\n')}`);
}

async function handleDeleteNote(event, client, parsed) {
  const auth = authorize();
  const removed = await sheetsService.deleteNotes(auth, parsed.indices);

  if (!removed.length) {
    return reply(client, event, `🤔 找不到指定的筆記,可以先傳「我的筆記」看看清單`);
  }
  return reply(client, event, `🗑 已刪除 ${removed.length} 則\n${removed.map((n) => `・${n.content}`).join('\n')}`);
}

async function handleSearchNote(event, client, parsed) {
  const auth = authorize();
  const found = await sheetsService.searchNotes(auth, parsed.keyword);

  const card = buildListCard({
    title: `🔍 搜尋筆記:${parsed.keyword}`,
    subtitle: found.length ? `找到 ${found.length} 則` : '搜尋範圍:全部筆記',
    sections: found.length
      ? [{ rows: found.slice(0, 12).map((n) => ({ left: formatDateShort(n.date), right: `${n.content}${n.status === '已完成' ? '(已完成)' : ''}` })) }]
      : [{ rows: [], emptyText: `找不到跟「${parsed.keyword}」有關的筆記` }],
    footerText: found.length > 12 ? `還有 ${found.length - 12} 則未顯示` : null,
  });

  return replyCard(client, event, card);
}

async function handleSearchExpense(event, client, parsed) {
  const auth = authorize();
  const found = await sheetsService.searchExpenses(auth, parsed.keyword);
  const total = found.reduce((s, e) => s + e.amount, 0);

  const card = buildListCard({
    title: `🔍 搜尋記帳:${parsed.keyword}`,
    subtitle: found.length ? `找到 ${found.length} 筆・共 $${total.toLocaleString()}` : '搜尋範圍:全部紀錄',
    sections: found.length
      ? [{ rows: found.slice(0, 15).map((e) => ({ left: formatDateShort(e.date), right: `${e.item} $${e.amount}` })) }]
      : [{ rows: [], emptyText: `找不到跟「${parsed.keyword}」有關的記帳紀錄` }],
    footerText: found.length > 15 ? `還有 ${found.length - 15} 筆未顯示` : null,
  });

  return replyCard(client, event, card);
}

// ── 設定預算 ──
async function handleSetBudget(event, client, parsed) {
  const auth = authorize();
  const category = classify(parsed.categoryText);
  await sheetsService.setBudget(auth, category, parsed.amount);
  return reply(client, event, `✅ 已設定「${category}」本月預算為 $${parsed.amount.toLocaleString()}`);
}

// ── 存款(不算支出)──
async function handleSavingsQuery(event, client) {
  const auth = authorize();
  const summary = await sheetsService.getMonthlySavings(auth);

  if (!summary.count) {
    return reply(client, event, `💰 ${summary.yearMonth} 還沒有任何存款紀錄`);
  }
  return replyCard(
    client,
    event,
    buildListCard({
      title: `💰 ${summary.yearMonth} 存款統計`,
      subtitle: `${summary.count} 筆紀錄`,
      hero: { value: `$${summary.total.toLocaleString()}`, label: `${summary.yearMonth} 總存款・${summary.count} 筆` },
      sections: [
        {
          heading: '存款明細',
          rows: summary.topItems.map(([item, amount]) => ({ left: item, right: `$${amount.toLocaleString()}`, bold: true })),
        },
      ],
      footerText: '存款不算進「這個月花多少」的支出統計',
    })
  );
}

// ── 薪水入帳一次分配到多個項目(支出 + 存款)──
async function handleAddAllocation(event, client, parsed) {
  const auth = authorize();
  const tasks = [];
  if (parsed.expenses.length) tasks.push(sheetsService.addExpenses(auth, parsed.expenses));
  if (parsed.savings.length) tasks.push(sheetsService.addSavings(auth, parsed.savings));
  await Promise.all(tasks);

  const lines = ['💰 已記錄薪水分配'];
  if (parsed.expenses.length) {
    lines.push('', '支出:');
    parsed.expenses.forEach((e) => lines.push(`・${e.item} $${e.amount}`));
  }
  if (parsed.savings.length) {
    lines.push('', '存款(不算進本月支出):');
    parsed.savings.forEach((s) => lines.push(`・${s.item} $${s.amount}`));
  }

  const warning = parsed.expenses.length ? await buildBudgetWarning(auth, parsed.expenses) : '';
  return reply(client, event, lines.join('\n') + warning);
}

async function handleTextMessage(event, client) {
  const userId = event.source.userId;
  const text = event.message.text;

  // 僅服務指定的個人使用者,避免其他人亂寫行程進日曆
  if (userId !== process.env.LINE_USER_ID) {
    logger.info(`拒絕非本人訊息,userId=${userId}`);
    return client.replyMessage(event.replyToken, { type: 'text', text: '這是私人秘書機器人,暫不提供服務 🙏' });
  }

  const tStart = Date.now();
  logger.info(`收到訊息: ${text}`);

  const tRule = Date.now();
  let parsed = parseWithRules(text);
  if (parsed) {
    logger.info(`[timing] 規則解析耗時 ${Date.now() - tRule}ms,意圖: ${parsed.intent}`);
  } else {
    const tClaude = Date.now();
    parsed = await parseWithClaude(text);
    logger.info(`[timing] 規則判斷不出來,改用 Claude fallback,耗時 ${Date.now() - tClaude}ms,意圖: ${parsed.intent}`);
  }

  const HANDLERS = {
    help: handleHelp,
    add_event: handleAddEvent,
    add_recurring_event: handleRecurringEvent,
    reschedule_event: handleReschedule,
    delete_event: handleDeleteEvent,
    search_event: handleSearchEvent,
    query_weather: handleWeatherQuery,
    query_schedule: handleScheduleQuery,
    query_week: handleWeekQuery,
    query_overview: handleOverview,
    query_free_slots: handleFreeSlots,
    add_expense: handleAddExpense,
    add_expenses: handleAddExpenses,
    delete_last_expense: handleDeleteLastExpense,
    update_last_expense: handleUpdateLastExpense,
    query_expense: handleExpenseQuery,
    query_expense_range: handleExpenseRangeQuery,
    query_expense_compare: handleExpenseCompare,
    query_budget: handleBudgetStatus,
    set_budget: handleSetBudget,
    query_savings: handleSavingsQuery,
    add_allocation: handleAddAllocation,
    add_note: handleAddNote,
    query_notes: handleQueryNotes,
    complete_note: handleCompleteNote,
    delete_note: handleDeleteNote,
    search_note: handleSearchNote,
    search_expense: handleSearchExpense,
  };

  const handler = HANDLERS[parsed.intent];
  if (handler) {
    const result = await handler(event, client, parsed);
    logger.info(`[timing] 總耗時(收到訊息→回覆送出)${Date.now() - tStart}ms`);
    return result;
  }

  return reply(
    client,
    event,
    `🤔 沒聽懂你的意思(${parsed.reason || '請再說清楚一點'})\n傳「指令」可以看完整功能列表`
  );
}

// ── ① LINE Webhook ──
exports.webhookLine = onRequest({ secrets: WEBHOOK_SECRETS, region: REGION }, async (req, res) => {
  const signature = req.headers['x-line-signature'];

  if (!signature || !line.validateSignature(req.rawBody, process.env.LINE_CHANNEL_SECRET, signature)) {
    res.status(401).send('signature validation failed');
    return;
  }

  const client = new line.Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
  const events = req.body.events || [];

  await Promise.all(
    events.map((event) => {
      if (event.type !== 'message' || event.message.type !== 'text') return null;
      return handleTextMessage(event, client).catch((err) => {
        logger.error('處理訊息失敗', err);
        // 尚未跑過 setup-sheets.js 時,給明確的設定提示而不是籠統的錯誤訊息
        const text =
          err.message === sheetsService.SETUP_HINT ? `⚙️ ${err.message}` : '處理時發生錯誤,請稍後再試 🙇';
        return client.replyMessage(event.replyToken, { type: 'text', text }).catch(() => {});
      });
    })
  );

  res.status(200).end();
});

// ── ② 排程:每天 07:00 早安簡報 ──
exports.dailyBriefing = onSchedule(
  { schedule: '0 7 * * *', timeZone: 'Asia/Taipei', secrets: BRIEFING_SECRETS, region: REGION },
  async () => {
    logger.info('開始產生今日晨報...');

    const auth = authorize();
    const [weather, events] = await Promise.all([getTodayWeather(), getTodayEvents(auth)]);
    logger.info(`天氣: ${weather.description}, 降雨機率 ${weather.rainChance}%`);
    logger.info(`今日行程: ${events.length} 筆`);

    const briefing = await generateBriefingData({ weather, events });
    const flexMessage = buildMorningBriefingFlex(briefing);

    await pushMessage(flexMessage);
    logger.info('已推播 Flex Message 至 LINE');

    const specialNames = getSpecialDayNames(events);
    if (specialNames.length) {
      await pushMessage(`🎉 提醒:今天是 ${specialNames.join('、')} 喔！`);
      logger.info(`已推播特別日子提醒: ${specialNames.join('、')}`);
    }
  }
);

// ── ③ 排程:每週五 18:00 週間回顧(本週支出、待辦、下週行程,不呼叫任何 AI)──
exports.weeklyReview = onSchedule(
  { schedule: '0 18 * * 5', timeZone: 'Asia/Taipei', secrets: WEEKLY_SECRETS, region: REGION },
  async () => {
    logger.info('開始產生週間回顧...');

    const auth = authorize();
    const [expenseSummary, pendingNotes, nextWeekEvents] = await Promise.all([
      sheetsService.getWeeklyExpenseSummary(auth),
      sheetsService.getPendingNotes(auth),
      getEventsForRange(auth, 7, 7),
    ]);

    const card = buildListCard({
      title: '📊 週間回顧',
      subtitle: '過去 7 天摘要',
      hero: { value: `$${expenseSummary.total.toLocaleString()}`, label: `本週支出・${expenseSummary.count} 筆` },
      sections: [
        {
          heading: '📝 待辦筆記',
          rows: pendingNotes.length ? [{ left: `${pendingNotes.length} 則尚未完成` }] : [],
          emptyText: '目前沒有待辦,很清爽！',
        },
        {
          heading: '📅 下週行程',
          rows: nextWeekEvents.map((e) => ({ left: formatDateShort(e.start), right: e.summary })),
          emptyText: '下週目前還沒有安排行程',
        },
      ],
      footerText: '祝你有美好的一週！',
    });

    await pushMessage(card);
    logger.info('已推播週間回顧');
  }
);

// ── ④ 排程:每月最後一天 20:00 月結報告(總支出、分類佔比、跟上月比較,不呼叫任何 AI)──
// Cloud Scheduler 沒有「每月最後一天」語法,28-31 號每天都會觸發,
// 這裡用「明天是不是這個月 1 號」判斷今天是不是最後一天,不是就跳過。
exports.monthlyReview = onSchedule(
  { schedule: '0 20 28-31 * *', timeZone: 'Asia/Taipei', secrets: WEEKLY_SECRETS, region: REGION },
  async () => {
    const tomorrow = taipeiDayStart(1);
    const tomorrowDay = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', day: '2-digit' }).format(tomorrow)
    );
    if (tomorrowDay !== 1) {
      logger.info('今天不是這個月最後一天,略過月結');
      return;
    }

    logger.info('開始產生月結報告...');
    const auth = authorize();
    const [byCategory, compare] = await Promise.all([
      sheetsService.getMonthlyExpenseByCategory(auth),
      sheetsService.compareMonthlyExpense(auth),
    ]);
    const { current, previous, diff } = compare;
    const trend =
      diff > 0 ? `多花了 $${diff.toLocaleString()}` : diff < 0 ? `少花了 $${Math.abs(diff).toLocaleString()}` : '跟上個月一樣';

    const card = buildListCard({
      title: '🧾 月結報告',
      subtitle: current.yearMonth,
      accent: diff > 0 ? COLOR.rainHigh : diff < 0 ? COLOR.rainLow : COLOR.primary,
      hero: { value: `$${current.total.toLocaleString()}`, label: `本月總支出・${current.count} 筆・${trend}` },
      sections: [
        {
          heading: '📊 分類佔比',
          rows: byCategory.map((c) => ({ left: c.category, right: `$${c.total.toLocaleString()}`, bold: true })),
          emptyText: '這個月還沒有記帳紀錄',
        },
      ],
      footerText: `上月 $${previous.total.toLocaleString()}・${previous.count} 筆`,
    });

    await pushMessage(card);
    logger.info('已推播月結報告');
  }
);
