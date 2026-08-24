// Google Sheets 服務:記帳 + 筆記
// 兩者共用同一份試算表,分成「記帳」與「筆記」兩個工作表。
// 試算表由 setup-sheets.js 建立,ID 存在 GOOGLE_SHEETS_ID 這個 Secret。

const { google } = require('googleapis');

const EXPENSE_SHEET = '記帳';
const NOTE_SHEET = '筆記';

// 尚未跑過 setup-sheets.js 時,Secret 會是這個佔位值
const NOT_CONFIGURED = 'NOT_SET';
const SETUP_HINT = '記帳與筆記功能還沒設定完成,請先在電腦上執行 node setup-sheets.js';

function getSpreadsheetId() {
  const id = process.env.GOOGLE_SHEETS_ID;
  if (!id || id === NOT_CONFIGURED) {
    throw new Error(SETUP_HINT);
  }
  return id;
}

function taipeiNowParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    yearMonth: `${get('year')}-${get('month')}`,
  };
}

async function appendRow(auth, sheetName, values) {
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${sheetName}!A:D`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}

async function readRows(auth, sheetName) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${sheetName}!A2:D`, // 跳過標題列
  });
  return res.data.values || [];
}

// ── 記帳 ──

// 新增一筆支出,欄位為:日期 / 時間 / 品項 / 金額
async function addExpense(auth, { item, amount }) {
  const { date, time } = taipeiNowParts();
  await appendRow(auth, EXPENSE_SHEET, [date, time, item, amount]);
  return { date, item, amount };
}

// 統計某個月份(預設本月)的支出總額與筆數
async function getMonthlyExpense(auth, yearMonth = null) {
  const target = yearMonth || taipeiNowParts().yearMonth;
  const rows = await readRows(auth, EXPENSE_SHEET);

  const matched = rows.filter((r) => (r[0] || '').startsWith(target));
  const total = matched.reduce((sum, r) => sum + (Number(r[3]) || 0), 0);

  // 依品項小計,方便看錢花在哪
  const byItem = {};
  for (const r of matched) {
    const item = r[2] || '(未命名)';
    byItem[item] = (byItem[item] || 0) + (Number(r[3]) || 0);
  }
  const topItems = Object.entries(byItem)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return { yearMonth: target, total, count: matched.length, topItems };
}

// 一次記多筆支出
async function addExpenses(auth, entries) {
  const { date, time } = taipeiNowParts();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${EXPENSE_SHEET}!A:D`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: entries.map((e) => [date, time, e.item, e.amount]) },
  });
  return entries.map((e) => ({ date, ...e }));
}

// 取得工作表的數字 id(刪除整列時必須用這個,不能用名稱)
async function getSheetId(auth, title) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.get({ spreadsheetId: getSpreadsheetId() });
  const sheet = (res.data.sheets || []).find((s) => s.properties.title === title);
  if (!sheet) throw new Error(`找不到名為「${title}」的工作表`);
  return sheet.properties.sheetId;
}

// 刪除最後一筆記帳(打錯時用)
async function deleteLastExpense(auth) {
  const rows = await readRows(auth, EXPENSE_SHEET);
  if (!rows.length) return null;

  const lastRowIndex = rows.length + 1; // 資料從第 2 列開始
  const [date, , item, amount] = rows[rows.length - 1];

  const sheets = google.sheets({ version: 'v4', auth });
  const sheetId = await getSheetId(auth, EXPENSE_SHEET);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: lastRowIndex - 1, endIndex: lastRowIndex },
          },
        },
      ],
    },
  });

  return { date, item, amount: Number(amount) || 0 };
}

// 修改最後一筆記帳的金額(打錯數字時用)
async function updateLastExpenseAmount(auth, newAmount) {
  const rows = await readRows(auth, EXPENSE_SHEET);
  if (!rows.length) return null;

  const lastRowIndex = rows.length + 1;
  const [, , item, oldAmount] = rows[rows.length - 1];

  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${EXPENSE_SHEET}!D${lastRowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[newAmount]] },
  });

  return { item, oldAmount: Number(oldAmount) || 0, newAmount };
}

// 本月 vs 上月支出比較
async function compareMonthlyExpense(auth) {
  const { yearMonth } = taipeiNowParts();
  const [y, m] = yearMonth.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;

  const [current, previous] = await Promise.all([
    getMonthlyExpense(auth, yearMonth),
    getMonthlyExpense(auth, prev),
  ]);

  return { current, previous, diff: current.total - previous.total };
}

// ── 筆記 ──

// 新增一則不綁時間的筆記
async function addNote(auth, content) {
  const { date, time } = taipeiNowParts();
  await appendRow(auth, NOTE_SHEET, [date, time, content, '未完成']);
  return { date, content };
}

// 取得所有「未完成」的筆記
async function getPendingNotes(auth) {
  const rows = await readRows(auth, NOTE_SHEET);
  return rows
    .map((r, idx) => ({ rowIndex: idx + 2, date: r[0], content: r[2], status: r[3] }))
    .filter((n) => n.content && n.status !== '已完成');
}

// 把第 n 則未完成筆記標記為已完成(n 從 1 開始,對應 getPendingNotes 的顯示順序)
async function completeNote(auth, displayIndex) {
  const pending = await getPendingNotes(auth);
  const target = pending[displayIndex - 1];
  if (!target) return null;

  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${NOTE_SHEET}!D${target.rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['已完成']] },
  });

  return target;
}

module.exports = {
  addExpense,
  addExpenses,
  getMonthlyExpense,
  compareMonthlyExpense,
  deleteLastExpense,
  updateLastExpenseAmount,
  addNote,
  getPendingNotes,
  completeNote,
  EXPENSE_SHEET,
  NOTE_SHEET,
  SETUP_HINT,
};
