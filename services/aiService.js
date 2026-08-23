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

// ── 自然語言速記待辦:解析 LINE 訊息中的時間與任務內容 ──

function buildTodoPrompt(text, now) {
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

  return `你是一位協助安排行程的個人秘書。使用者傳了一則訊息,請判斷裡面是否包含「待辦事項/行程」以及對應的時間,只輸出一個 JSON 物件,不要有其他文字、不要加 markdown code fence,格式如下:

{
  "isValid": true 或 false,
  "title": "行程標題(簡潔,去除時間詞)",
  "startTime": "ISO 8601 格式時間字串,需含時區,例如 2026-08-25T15:00:00+08:00",
  "endTime": "ISO 8601 格式時間字串",
  "reason": "若 isValid 為 false,簡短說明原因"
}

規則:
- 現在時間是:${nowStr}(台灣時區 UTC+8),請以此為基準換算「明天」「後天」「這禮拜五」等相對時間
- 若訊息只提到日期沒提到明確時間(例如只說「明天」),開始時間預設為當天 09:00
- 若使用者沒說結束時間,endTime 請填開始時間 + 1 小時
- 若訊息中沒有任何可辨識的時間資訊,或訊息看起來不是待辦/行程(例如純聊天、問候語),isValid 請設為 false 並填寫 reason
- startTime / endTime 一律要換算成完整日期時間,不要留相對用詞
- 直接輸出 JSON 物件本身,不要加任何說明文字或 \`\`\`

使用者訊息:「${text}」`;
}

// 解析一則文字訊息,回傳 { isValid, title, start, end } 或 { isValid: false, reason }
async function parseTodoFromText(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 GEMINI_API_KEY,請至 .env 設定 Gemini API 金鑰。');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const prompt = buildTodoPrompt(text, new Date());
  const result = await model.generateContent(prompt);
  const rawText = result.response.text();

  let parsed;
  try {
    parsed = extractJson(rawText);
  } catch (err) {
    console.error('[aiService] parseTodoFromText JSON 解析失敗,原始內容:', rawText);
    return { isValid: false, reason: 'AI 解析失敗,請換個說法試試' };
  }

  if (!parsed.isValid || !parsed.startTime) {
    return { isValid: false, reason: parsed.reason || '無法辨識時間資訊' };
  }

  const start = new Date(parsed.startTime);
  if (Number.isNaN(start.getTime())) {
    return { isValid: false, reason: '時間格式無法辨識' };
  }

  let end = parsed.endTime ? new Date(parsed.endTime) : null;
  if (!end || Number.isNaN(end.getTime()) || end <= start) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }

  return {
    isValid: true,
    title: String(parsed.title || text).slice(0, 100),
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

module.exports = { generateBriefingData, buildPrompt, parseTodoFromText };
