// AI 統整服務:呼叫 Gemini API,將天氣 + 行程整理成「結構化 JSON」,供 Flex Message 樣板綁定使用
const { GoogleGenerativeAI } = require('@google/generative-ai');

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

// 呼叫 Gemini,回傳結構化簡報資料(供 flexMessageBuilder 綁定使用)
async function generateBriefingData({ weather, events }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 GEMINI_API_KEY,請至 .env 設定 Gemini API 金鑰。');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const prompt = buildPrompt({ weather, events });
  const result = await model.generateContent(prompt);
  const rawText = result.response.text();

  let parsed;
  try {
    parsed = extractJson(rawText);
  } catch (err) {
    console.error('[aiService] Gemini 回傳非合法 JSON,改用預設文案。原始內容:', rawText);
    parsed = fallbackBriefing({ weather, events });
  }

  return {
    weather,
    summary: String(parsed.summary || '今日簡報').slice(0, 30),
    reminder: String(parsed.reminder || '').slice(0, 40),
    highlightEvents: Array.isArray(parsed.highlightEvents) ? parsed.highlightEvents.slice(0, 5) : [],
  };
}

// ── 意圖判斷:同一句話先分類「新增行程 / 查天氣 / 查行程 / 閒聊」,再交給對應的處理流程 ──

function buildIntentPrompt(text, now) {
  const nowStr = now.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'long',
  });

  return `你是一位個人秘書機器人,負責判斷使用者傳來的訊息屬於哪一種意圖,只輸出一個 JSON 物件,不要有其他文字、不要加 markdown code fence。

意圖只能是以下四種之一:
- "add_event": 使用者想新增一筆行程/待辦(訊息裡有明確或可換算的時間)
- "query_weather": 使用者在問天氣(例如「今天天氣」「會不會下雨」)
- "query_schedule": 使用者在問行程(例如「今天行程」「今天有什麼重要的事」「上午/下午有什麼安排」「下午3點有沒有行程」)
- "chitchat": 以上皆非(閒聊、問候,或訊息不足以判斷)

輸出格式:
{
  "intent": "add_event | query_weather | query_schedule | chitchat",
  "title": "僅 add_event 需要:行程標題,簡潔、去除時間詞",
  "startTime": "僅 add_event 需要:ISO 8601 時間字串,含時區",
  "endTime": "僅 add_event 需要:ISO 8601 時間字串",
  "dateOffset": "僅 query_schedule 需要:整數,0=今天,1=明天,以此類推",
  "period": "僅 query_schedule 需要:all / morning / afternoon / evening",
  "specificTime": "僅 query_schedule 且使用者問特定時間點時需要:ISO 8601 時間字串,否則為 null",
  "reason": "僅 chitchat 需要:簡短說明為什麼判斷成閒聊"
}

規則:
- 現在時間是:${nowStr}(台灣時區 UTC+8),請以此為基準換算「明天」「這禮拜五」「下午3點」等相對時間
- add_event:若訊息只提到日期沒提到明確時間,開始時間預設當天 09:00;沒說結束時間,endTime 填開始時間 + 1 小時
- query_schedule:若沒提到上午/下午/晚上,period 填 "all";若沒問特定時間點,specificTime 填 null;若沒提到是哪一天,dateOffset 填 0(今天)
- 不確定或不適用的欄位可以省略或填 null,但 intent 一定要填
- 直接輸出 JSON 物件本身,不要加任何說明文字或 \`\`\`

使用者訊息:「${text}」`;
}

// 解析一則文字訊息的意圖,回傳對應形狀的物件(intent 不同,欄位也不同)
async function parseUserIntent(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 GEMINI_API_KEY,請至 .env 設定 Gemini API 金鑰。');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const prompt = buildIntentPrompt(text, new Date());
  const result = await model.generateContent(prompt);
  const rawText = result.response.text();

  let parsed;
  try {
    parsed = extractJson(rawText);
  } catch (err) {
    console.error('[aiService] parseUserIntent JSON 解析失敗,原始內容:', rawText);
    return { intent: 'chitchat', reason: 'AI 解析失敗,請換個說法試試' };
  }

  if (parsed.intent === 'add_event') {
    if (!parsed.startTime) return { intent: 'chitchat', reason: '沒有偵測到明確時間' };
    const start = new Date(parsed.startTime);
    if (Number.isNaN(start.getTime())) return { intent: 'chitchat', reason: '時間格式無法辨識' };

    let end = parsed.endTime ? new Date(parsed.endTime) : null;
    if (!end || Number.isNaN(end.getTime()) || end <= start) {
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }

    return {
      intent: 'add_event',
      title: String(parsed.title || text).slice(0, 100),
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }

  if (parsed.intent === 'query_weather') {
    return { intent: 'query_weather' };
  }

  if (parsed.intent === 'query_schedule') {
    const dateOffset = Number.isInteger(parsed.dateOffset) ? parsed.dateOffset : 0;
    const period = ['morning', 'afternoon', 'evening', 'all'].includes(parsed.period) ? parsed.period : 'all';
    let specificTime = null;
    if (parsed.specificTime) {
      const t = new Date(parsed.specificTime);
      if (!Number.isNaN(t.getTime())) specificTime = t.toISOString();
    }
    return { intent: 'query_schedule', dateOffset, period, specificTime };
  }

  return { intent: 'chitchat', reason: parsed.reason || '無法辨識意圖' };
}

module.exports = { generateBriefingData, buildPrompt, parseUserIntent };
