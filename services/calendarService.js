// Google Calendar 服務:取得今日行程
const { google } = require('googleapis');

// 取得「今日」(本機時區)所有行程,含全天事件
async function getTodayEvents(auth) {
  const calendar = google.calendar({ version: 'v3', auth });

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = res.data.items || [];
  return events.map((e) => ({
    summary: e.summary || '(無標題)',
    start: e.start.dateTime || e.start.date,
    end: e.end.dateTime || e.end.date,
    isAllDay: !e.start.dateTime,
  }));
}

// 新增一筆行程(start/end 需為 ISO 8601 時間字串)
async function addEvent(auth, { summary, start, end, description = '' }) {
  const calendar = google.calendar({ version: 'v3', auth });

  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary,
      description,
      start: { dateTime: start },
      end: { dateTime: end },
    },
  });

  return {
    summary: res.data.summary,
    start: res.data.start.dateTime || res.data.start.date,
    end: res.data.end.dateTime || res.data.end.date,
    htmlLink: res.data.htmlLink,
  };
}

// 查詢指定時間範圍內是否已有其他行程(用於新增前的衝突檢測)
async function findOverlappingEvents(auth, { start, end }) {
  const calendar = google.calendar({ version: 'v3', auth });

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: start,
    timeMax: end,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = res.data.items || [];
  return events.map((e) => ({
    summary: e.summary || '(無標題)',
    start: e.start.dateTime || e.start.date,
    end: e.end.dateTime || e.end.date,
  }));
}

module.exports = { getTodayEvents, addEvent, findOverlappingEvents };
