// 用法:
//   node calendar.js list [幾天內, 預設7]     -> 列出近期行程
//   node calendar.js add "標題" "開始時間" "結束時間" ["說明"]
//     時間格式範例: "2026-08-25T10:00:00+08:00"
//
// 第一次執行任一指令時,會自動開啟瀏覽器要求登入 Google 帳號授權,
// 授權完成後會在根目錄產生 token.json,之後就不用再重新登入。

const { google } = require('googleapis');
const { authorize } = require('./services/googleAuth');

async function listEvents(auth, days = 7) {
  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = res.data.items || [];
  if (events.length === 0) {
    console.log(`未來 ${days} 天內沒有行程。`);
    return;
  }

  console.log(`未來 ${days} 天內的行程:\n`);
  for (const event of events) {
    const start = event.start.dateTime || event.start.date;
    console.log(`- [${start}] ${event.summary}`);
  }
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function addEvent(auth, summary, startTime, endTime, description = '') {
  const calendar = google.calendar({ version: 'v3', auth });
  const isAllDay = DATE_ONLY_RE.test(startTime);

  const start = isAllDay ? { date: startTime } : { dateTime: startTime };
  // 全天事件的 end.date 是「不包含」的隔天,若使用者只給同一天當結束日則自動 +1 天
  const end = isAllDay
    ? { date: endTime && DATE_ONLY_RE.test(endTime) && endTime !== startTime ? endTime : addDays(startTime, 1) }
    : { dateTime: endTime };

  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: { summary, description, start, end },
  });

  console.log('行程新增成功:');
  console.log(`- ${res.data.summary} (${res.data.start.dateTime || res.data.start.date} ~ ${res.data.end.dateTime || res.data.end.date})`);
  console.log(`  連結: ${res.data.htmlLink}`);
}

async function main() {
  const [, , command, ...args] = process.argv;
  const auth = await authorize();

  if (command === 'list') {
    const days = args[0] ? parseInt(args[0], 10) : 7;
    await listEvents(auth, days);
  } else if (command === 'add') {
    const [summary, startTime, endTime, description] = args;
    if (!summary || !startTime || !endTime) {
      console.error('用法: node calendar.js add "標題" "開始時間" "結束時間" ["說明"]');
      process.exitCode = 1;
      return;
    }
    await addEvent(auth, summary, startTime, endTime, description);
  } else {
    console.log('用法:');
    console.log('  node calendar.js list [天數]');
    console.log('  node calendar.js add "標題" "開始時間(ISO格式)" "結束時間(ISO格式)" ["說明"]');
  }
}

main().catch(err => {
  console.error('發生錯誤:', err.message);
  process.exitCode = 1;
});
