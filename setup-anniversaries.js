// 一次性設定腳本:建立生日/紀念日的每年重複全天行程
//
// 用法: node setup-anniversaries.js
//
// 每筆都是「全天 + 每年重複(RRULE:FREQ=YEARLY)」的行程,當天早安簡報跟
// 「今天狀況」就會自動列出來,不用另外寫提醒邏輯。
// 重複執行是安全的:已經有同名行程就會跳過,不會重複新增。

const { google } = require('googleapis');
const { authorize } = require('./services/googleAuth');

const ANNIVERSARIES = [
  { summary: '🎉 紀念日', month: 12, day: 31 },
  { summary: '🎂 我的生日', month: 9, day: 6 },
  { summary: '🎂 女友生日', month: 10, day: 12 },
  { summary: '🎂 妹妹生日', month: 9, day: 15 },
  { summary: '🎂 媽媽生日', month: 8, day: 20 },
  { summary: '🎂 爸爸生日', month: 1, day: 3 },
];

function pad(n) {
  return String(n).padStart(2, '0');
}

// 找下一次會發生的日期(今年的日期已過就從明年開始,之後靠 RRULE 每年自動延續)
function nextOccurrence(month, day) {
  const now = new Date();
  const year = now.getFullYear();
  const thisYear = new Date(year, month - 1, day);
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetYear = thisYear < todayMidnight ? year + 1 : year;
  return `${targetYear}-${pad(month)}-${pad(day)}`;
}

function nextDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function alreadyExists(calendar, summary) {
  const res = await calendar.events.list({
    calendarId: 'primary',
    q: summary,
    timeMin: new Date(2000, 0, 1).toISOString(),
    timeMax: new Date(2100, 0, 1).toISOString(),
    singleEvents: true,
    maxResults: 5,
  });
  return (res.data.items || []).some((e) => e.summary === summary);
}

async function main() {
  const auth = await authorize();
  const calendar = google.calendar({ version: 'v3', auth });

  for (const a of ANNIVERSARIES) {
    if (await alreadyExists(calendar, a.summary)) {
      console.log(`已存在,略過:${a.summary}`);
      continue;
    }

    const start = nextOccurrence(a.month, a.day);
    const end = nextDay(start);

    await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: a.summary,
        start: { date: start },
        end: { date: end },
        recurrence: ['RRULE:FREQ=YEARLY'],
      },
    });
    console.log(`已新增:${a.summary}(${start} 起每年重複）`);
  }

  console.log('\n完成！這些行程當天會自動出現在早安簡報跟「今天狀況」裡。');
}

main().catch((err) => {
  console.error('發生錯誤:', err.message);
  process.exitCode = 1;
});
