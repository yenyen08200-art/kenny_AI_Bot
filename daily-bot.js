// 個人 AI 自動化秘書 - 核心晨報腳本
// 用法: node daily-bot.js
//
// 流程:抓天氣 + 抓今日行程 -> Gemini 統整成結構化 JSON -> 綁定 Flex Message 樣板 -> 推播到 LINE

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { authorize } = require('./services/googleAuth');
const { getTodayEvents } = require('./services/calendarService');
const { getTodayWeather } = require('./services/weatherService');
const { generateBriefingData } = require('./services/aiService');
const { buildMorningBriefingFlex } = require('./services/flexMessageBuilder');
const { pushMessage } = require('./services/lineService');

// ── 階段二模組(架構已預留,尚未串接進主流程,後續開發時在此掛載)──
// const taskManager = require('./modules/taskManager');
// const lifeAlert = require('./modules/lifeAlert');
// const contentSummarizer = require('./modules/contentSummarizer');
// const bizAssistant = require('./modules/bizAssistant');

async function runMorningBriefing() {
  console.log('[daily-bot] 開始產生今日晨報...');

  const auth = await authorize();
  const [weather, events] = await Promise.all([getTodayWeather(), getTodayEvents(auth)]);
  console.log(`[daily-bot] 天氣資料: ${weather.description}, 降雨機率 ${weather.rainChance}%`);
  console.log(`[daily-bot] 今日行程: ${events.length} 筆`);

  const briefing = await generateBriefingData({ weather, events });
  console.log(`[daily-bot] AI 摘要: ${briefing.summary} / 提醒: ${briefing.reminder}`);
  console.log(`[daily-bot] 重點行程: ${briefing.highlightEvents.length} 筆`);

  const flexMessage = buildMorningBriefingFlex(briefing);

  try {
    await pushMessage(flexMessage);
    console.log('[daily-bot] 已推播 Flex Message 至 LINE');
  } catch (err) {
    console.error('[daily-bot] LINE 推播失敗:', err.message);
  }
}

if (require.main === module) {
  runMorningBriefing().catch((err) => {
    console.error('[daily-bot] 執行失敗:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { runMorningBriefing };
