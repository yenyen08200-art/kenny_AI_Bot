// AI 統整服務:呼叫 Claude,將天氣 + 行程整理成「結構化 JSON」,供 Flex Message 樣板綁定使用
//
// 原本用 Gemini,但 Gemini 專案因為跟 Firebase 帳單綁在一起,被轉成「預付額度」模式,
// 額度歸零就整個晨報噴錯消失。改用跟 claudeService.js(規則解析器 fallback)一致的
// Claude Haiku,額度掌握在自己手上,不會再被 Gemini 那邊的帳單狀態影響。
const Anthropic = require('@anthropic-ai/sdk');

const HIGH_RAIN_THRESHOLD = 70;

function formatEventTime(e) {
  return e.isAllDay
    ? '全天'
    : new Date(e.start).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatEventForPrompt(e) {
  return `${formatEventTime(e)} ${e.summary}`;
}

function buildPrompt({ weather, events }) {
  const eventLines = events.length ? events.map(formatEventForPrompt).join('\n') : '(今天沒有安排行程)';

  return `你是一位親切、精煉的個人秘書。請根據以下資訊,只輸出一個 JSON 物件,不要有任何其他文字、不要加 markdown code fence,格式與規則如下:

{
  "summary": "一句 15 字以內、口語化的今日總結",
  "reminder": "一句 20 字以內的貼心提醒(例如天氣或行程相關的提醒)",
  "highlightEvents": [
    { "time": "時間字串,例如 09:00 或 全天", "title": "行程重點,盡量精簡" }
  ]
}

規則:
- highlightEvents 最多列出 5 筆,若原始行程超過 5 筆,請挑選你認為最重要的
- 若今天沒有行程,highlightEvents 請回傳空陣列 []
- summary 與 reminder 不要用「早安」開頭,語氣自然、不要制式化,不要寫長句
- 直接輸出 JSON 物件本身,不要加任何說明文字或 \`\`\`

【天氣資訊】
地點:${weather.location}
天氣現象:${weather.description}
降雨機率:${weather.rainChance}%
氣溫:${weather.minTemp}°C - ${weather.maxTemp}°C

【今日行程】
${eventLines}`;
}

function extractJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '');
  return JSON.parse(cleaned);
}

function fallbackBriefing({ weather, events }) {
  return {
    summary: '今日簡報',
    reminder: Number(weather.rainChance) >= HIGH_RAIN_THRESHOLD ? '降雨機率偏高,記得帶傘' : '祝你有美好的一天',
    highlightEvents: events.slice(0, 5).map((e) => ({ time: formatEventTime(e), title: e.summary })),
  };
}

// 呼叫 Claude,回傳結構化簡報資料(供 flexMessageBuilder 綁定使用)
//
// 整段包在 try/catch 裡:額度用完、帳單問題、網路逾時等任何原因失敗,都直接退回
// fallbackBriefing 的樣板文案,確保晨報一定會送出,不會因為 AI 那句話生不出來就整篇消失。
async function generateBriefingData({ weather, events }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 ANTHROPIC_API_KEY,請至 .env 設定 Claude API 金鑰。');
  }

  let parsed;
  try {
    const client = new Anthropic({ apiKey });
    const prompt = buildPrompt({ weather, events });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawText = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    parsed = extractJson(rawText);
  } catch (err) {
    console.error('[aiService] Claude 呼叫失敗,改用預設文案。', err.message);
    parsed = fallbackBriefing({ weather, events });
  }

  return {
    weather,
    summary: String(parsed.summary || '今日簡報').slice(0, 30),
    reminder: String(parsed.reminder || '').slice(0, 40),
    highlightEvents: Array.isArray(parsed.highlightEvents) ? parsed.highlightEvents.slice(0, 5) : [],
  };
}

module.exports = { generateBriefingData, buildPrompt };
