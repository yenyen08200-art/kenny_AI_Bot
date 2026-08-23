// 階段二:日程與任務管理
// - parseNaturalLanguageTodo: 解析自然語言待辦文字,交給 Gemini 判斷時間與標題
// - checkScheduleConflict: 新增行程前比對 Google Calendar 既有行程,回傳重疊的行程清單

const { parseTodoFromText } = require('../services/aiService');
const { findOverlappingEvents } = require('../services/calendarService');

async function parseNaturalLanguageTodo(text) {
  return parseTodoFromText(text);
}

async function checkScheduleConflict(auth, { start, end }) {
  return findOverlappingEvents(auth, { start, end });
}

module.exports = { parseNaturalLanguageTodo, checkScheduleConflict };
