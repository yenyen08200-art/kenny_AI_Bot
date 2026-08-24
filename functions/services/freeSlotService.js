// 空檔計算:把行事曆上「已被占用的時段」從可安排時間裡扣掉,算出剩下的空白區間
// 純運算,不呼叫任何外部 API

// 預設可安排時間 09:00 - 21:00(台北時間)
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 21;
// 小於這個長度的空檔不顯示(避免一堆 5 分鐘的碎片)
const MIN_SLOT_MINUTES = 30;

const PERIOD_HOURS = {
  morning: [WORK_START_HOUR, 12],
  afternoon: [12, 18],
  evening: [18, WORK_END_HOUR],
  all: [WORK_START_HOUR, WORK_END_HOUR],
};

// 取得台北時區某一天某個小時的 UTC 時間戳
function taipeiTimestamp(dayOffset, hour) {
  const now = new Date();
  const taipeiDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const base = new Date(`${taipeiDateStr}T00:00:00+08:00`);
  base.setUTCDate(base.getUTCDate() + dayOffset);
  return base.getTime() + hour * 3600 * 1000;
}

// 把重疊或相鄰的忙碌區間合併,避免重複扣除
function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];

  for (const cur of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

// 計算單日空檔。events 需為 calendarService 回傳的格式
// 全天事件(例如「停班停課」「生日」)不占用時段,所以不列入忙碌區間
function getFreeSlotsForDay(events, dayOffset, period = 'all') {
  const [fromHour, toHour] = PERIOD_HOURS[period] || PERIOD_HOURS.all;
  const windowStart = taipeiTimestamp(dayOffset, fromHour);
  const windowEnd = taipeiTimestamp(dayOffset, toHour);

  const busy = mergeIntervals(
    events
      .filter((e) => !e.isAllDay)
      .map((e) => ({ start: new Date(e.start).getTime(), end: new Date(e.end).getTime() }))
      .filter((i) => i.end > windowStart && i.start < windowEnd)
  );

  const slots = [];
  let cursor = windowStart;
  for (const b of busy) {
    if (b.start > cursor) slots.push({ start: cursor, end: Math.min(b.start, windowEnd) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= windowEnd) break;
  }
  if (cursor < windowEnd) slots.push({ start: cursor, end: windowEnd });

  return slots
    .filter((s) => s.end - s.start >= MIN_SLOT_MINUTES * 60 * 1000)
    .map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() }));
}

module.exports = { getFreeSlotsForDay, WORK_START_HOUR, WORK_END_HOUR };
