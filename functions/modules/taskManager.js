// 階段二:日程與任務管理
// - checkScheduleConflict: 新增行程前比對 Google Calendar 既有行程,回傳重疊的行程清單
// (自然語言意圖判斷/解析已整合進 services/aiService.js 的 parseUserIntent)

const { findOverlappingEvents } = require('../services/calendarService');

async function checkScheduleConflict(auth, { start, end }) {
  return findOverlappingEvents(auth, { start, end });
}

module.exports = { checkScheduleConflict };
