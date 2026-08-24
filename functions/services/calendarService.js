// Google Calendar 服務:行程查詢、新增、刪除、搜尋
const { google } = require('googleapis');

// 把 Google Calendar 的原始事件轉成本專案統一使用的格式(id 是刪除行程時要用的)
function mapEvent(e) {
  return {
    id: e.id,
    summary: e.summary || '(無標題)',
    start: e.start.dateTime || e.start.date,
    end: e.end.dateTime || e.end.date,
    isAllDay: !e.start.dateTime,
  };
}

// 取得「某一天」(本機時區)所有行程,含全天事件。dayOffset: 0=今天,1=明天,以此類推
async function getEventsForDay(auth, dayOffset = 0) {
  const calendar = google.calendar({ version: 'v3', auth });

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + dayOffset);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (res.data.items || []).map(mapEvent);
}

// 取得「今日」所有行程(daily-bot 晨報用)
async function getTodayEvents(auth) {
  return getEventsForDay(auth, 0);
}

// 取得從今天起連續 days 天的行程(「這週行程」用)
async function getEventsForRange(auth, dayOffset = 0, days = 7) {
  const calendar = google.calendar({ version: 'v3', auth });

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + dayOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + days);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (res.data.items || []).map(mapEvent);
}

// 依關鍵字搜尋行程(預設往前 90 天、往後 180 天)
async function searchEvents(auth, keyword, { pastDays = 90, futureDays = 180 } = {}) {
  const calendar = google.calendar({ version: 'v3', auth });

  const timeMin = new Date();
  timeMin.setDate(timeMin.getDate() - pastDays);
  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + futureDays);

  const res = await calendar.events.list({
    calendarId: 'primary',
    q: keyword,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  });

  return (res.data.items || []).map(mapEvent);
}

// 刪除一筆行程(需先用 searchEvents / getEventsForDay 取得 id)
async function deleteEvent(auth, eventId) {
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.delete({ calendarId: 'primary', eventId });
}

// 改期:更新一筆行程的起訖時間
async function updateEventTime(auth, eventId, { start, end }) {
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: { start: { dateTime: start }, end: { dateTime: end } },
  });
  return mapEvent(res.data);
}

// 新增循環行程。recurrence 例:'RRULE:FREQ=WEEKLY;BYDAY=WE'
async function addRecurringEvent(auth, { summary, start, end, recurrence, description = '' }) {
  const calendar = google.calendar({ version: 'v3', auth });

  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary,
      description,
      start: { dateTime: start, timeZone: 'Asia/Taipei' },
      end: { dateTime: end, timeZone: 'Asia/Taipei' },
      recurrence: [recurrence],
    },
  });

  return { ...mapEvent(res.data), htmlLink: res.data.htmlLink };
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

  return { ...mapEvent(res.data), htmlLink: res.data.htmlLink };
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

  return (res.data.items || []).map(mapEvent);
}

module.exports = {
  getTodayEvents,
  getEventsForDay,
  getEventsForRange,
  searchEvents,
  addEvent,
  addRecurringEvent,
  updateEventTime,
  deleteEvent,
  findOverlappingEvents,
};
