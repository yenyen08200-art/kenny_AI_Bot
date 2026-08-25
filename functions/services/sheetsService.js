// Google Sheets 服務:記帳 + 筆記
// 兩者共用同一份試算表,分成「記帳」與「筆記」兩個工作表。
// 試算表由 setup-sheets.js 建立,ID 存在 GOOGLE_SHEETS_ID 這個 Secret。

const { google } = require('googleapis');
const { classify } = require('./expenseCategory');

const EXPENSE_SHEET = '記帳';
const NOTE_SHEET = '筆記';
const BUDGET_SHEET = '預算';
const SAVING_SHEET = '存款';

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

// 統計某個工作表某個月份(預設本月)的總額與筆數,記帳/存款共用
async function getMonthlySum(auth, sheetName, yearMonth = null) {
  const target = yearMonth || taipeiNowParts().yearMonth;
  const rows = await readRows(auth, sheetName);

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

// 統計某個月份(預設本月)的支出總額與筆數
async function getMonthlyExpense(auth, yearMonth = null) {
  return getMonthlySum(auth, EXPENSE_SHEET, yearMonth);
}

// 統計某個月份(預設本月)存了多少(不算進支出統計)
async function getMonthlySavings(auth, yearMonth = null) {
  return getMonthlySum(auth, SAVING_SHEET, yearMonth);
}

// 記一筆存款(轉去存的錢,不是花掉,所以獨立一張表,不會混進支出統計)
async function addSavings(auth, entries) {
  const { date, time } = taipeiNowParts();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${SAVING_SHEET}!A:D`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: entries.map((e) => [date, time, e.item, e.amount]) },
  });
  return entries.map((e) => ({ date, ...e }));
}

// 依分類統計某個月份(預設本月)的支出,分類由 expenseCategory.js 用關鍵字自動判斷
async function getMonthlyExpenseByCategory(auth, yearMonth = null) {
  const target = yearMonth || taipeiNowParts().yearMonth;
  const rows = await readRows(auth, EXPENSE_SHEET);
  const matched = rows.filter((r) => (r[0] || '').startsWith(target));

  const byCategory = {};
  for (const r of matched) {
    const category = classify(r[2]);
    byCategory[category] = (byCategory[category] || 0) + (Number(r[3]) || 0);
  }

  return Object.entries(byCategory)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
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

// 修改最後一筆記帳的金額和/或備註(打錯數字、忘記寫細節時用)。
// amount 是 null 就不改金額,note 是 null 就不改品項。
async function updateLastExpenseAmount(auth, { amount = null, note = null } = {}) {
  const rows = await readRows(auth, EXPENSE_SHEET);
  if (!rows.length) return null;

  const lastRowIndex = rows.length + 1;
  const [, , oldItem, oldAmount] = rows[rows.length - 1];

  const newAmount = amount !== null ? amount : Number(oldAmount) || 0;
  const newItem = note ? `${oldItem}・${note}` : oldItem;

  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${EXPENSE_SHEET}!C${lastRowIndex}:D${lastRowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[newItem, newAmount]] },
  });

  return { item: newItem, oldAmount: Number(oldAmount) || 0, newAmount };
}

// 查某個日期區間(含頭尾)的支出,startDate/endDate 皆為 'YYYY-MM-DD'
async function getExpensesByDateRange(auth, startDate, endDate) {
  const rows = await readRows(auth, EXPENSE_SHEET);
  const items = rows
    .filter((r) => (r[0] || '') >= startDate && (r[0] || '') <= endDate)
    .map((r) => ({ date: r[0], item: r[2], amount: Number(r[3]) || 0 }));
  const total = items.reduce((s, e) => s + e.amount, 0);
  return { total, count: items.length, items };
}

// 依關鍵字搜尋記帳紀錄(不限本月,搜尋全部歷史)
async function searchExpenses(auth, keyword) {
  const rows = await readRows(auth, EXPENSE_SHEET);
  return rows
    .map((r) => ({ date: r[0], item: r[2], amount: Number(r[3]) || 0 }))
    .filter((e) => e.item && e.item.includes(keyword));
}

// 過去 7 天(含今天)的支出統計,週間回顧用
async function getWeeklyExpenseSummary(auth) {
  const rows = await readRows(auth, EXPENSE_SHEET);
  const cutoff = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(
    new Date(Date.now() - 7 * 86400000)
  );

  const matched = rows.filter((r) => (r[0] || '') >= cutoff);
  const total = matched.reduce((sum, r) => sum + (Number(r[3]) || 0), 0);
  return { total, count: matched.length };
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

// ── 預算 ──

// 讀「預算」分頁(分類 / 月預算),用 setup-budget.js 建立。回傳 { 分類: 金額 } 的物件,
// 金額 <= 0 視為「沒設定」,不列入預算狀態
async function getBudgets(auth) {
  const rows = await readRows(auth, BUDGET_SHEET);
  const budgets = {};
  for (const r of rows) {
    const category = r[0];
    const amount = Number(r[1]);
    if (category && Number.isFinite(amount) && amount > 0) budgets[category] = amount;
  }
  return budgets;
}

// 設定/更新單一分類的月預算(category 必須是 expenseCategory.js 裡的固定分類之一)
async function setBudget(auth, category, amount) {
  const sheets = google.sheets({ version: 'v4', auth });
  const rows = await readRows(auth, BUDGET_SHEET);
  const idx = rows.findIndex((r) => r[0] === category);

  if (idx === -1) {
    await appendRow(auth, BUDGET_SHEET, [category, amount]);
    return;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${BUDGET_SHEET}!B${idx + 2}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[amount]] },
  });
}

// 各分類「預算 vs 本月已花」的狀態,只列出有設定預算的分類
async function getBudgetStatus(auth, yearMonth = null) {
  const target = yearMonth || taipeiNowParts().yearMonth;
  const [byCategory, budgets] = await Promise.all([getMonthlyExpenseByCategory(auth, target), getBudgets(auth)]);
  const spentMap = Object.fromEntries(byCategory.map((c) => [c.category, c.total]));

  const items = Object.entries(budgets)
    .map(([category, budget]) => {
      const spent = spentMap[category] || 0;
      return { category, budget, spent, remaining: budget - spent };
    })
    .sort((a, b) => b.spent - a.spent);

  const totalBudget = items.reduce((s, b) => s + b.budget, 0);
  const totalSpent = items.reduce((s, b) => s + b.spent, 0);

  return { yearMonth: target, items, totalBudget, totalSpent, totalRemaining: totalBudget - totalSpent };
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

// 把指定的未完成筆記標記為已完成。displayIndices 是陣列(n 從 1 開始,
// 對應 getPendingNotes 的顯示順序),一次可以完成多則。
async function completeNotes(auth, displayIndices) {
  const pending = await getPendingNotes(auth);
  const targets = displayIndices.map((i) => pending[i - 1]).filter(Boolean);
  if (!targets.length) return [];

  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: targets.map((t) => ({ range: `${NOTE_SHEET}!D${t.rowIndex}`, values: [['已完成']] })),
    },
  });

  return targets;
}

// 整筆刪除筆記(不是標記完成,是真的從表格移除),同樣支援一次刪多則
async function deleteNotes(auth, displayIndices) {
  const pending = await getPendingNotes(auth);
  const targets = displayIndices.map((i) => pending[i - 1]).filter(Boolean);
  if (!targets.length) return [];

  const sheets = google.sheets({ version: 'v4', auth });
  const sheetId = await getSheetId(auth, NOTE_SHEET);

  // 由大到小刪除,避免同一批次裡刪掉前面的列導致後面的列位移錯位
  const sortedDesc = [...targets].sort((a, b) => b.rowIndex - a.rowIndex);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      requests: sortedDesc.map((t) => ({
        deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: t.rowIndex - 1, endIndex: t.rowIndex } },
      })),
    },
  });

  return targets;
}

// 依關鍵字搜尋筆記(不限未完成,含已完成的歷史紀錄)
async function searchNotes(auth, keyword) {
  const rows = await readRows(auth, NOTE_SHEET);
  return rows
    .map((r, idx) => ({ rowIndex: idx + 2, date: r[0], content: r[2], status: r[3] }))
    .filter((n) => n.content && n.content.includes(keyword));
}

module.exports = {
  addExpense,
  addExpenses,
  getMonthlyExpense,
  getMonthlyExpenseByCategory,
  getExpensesByDateRange,
  getWeeklyExpenseSummary,
  compareMonthlyExpense,
  getBudgets,
  getBudgetStatus,
  setBudget,
  addSavings,
  getMonthlySavings,
  deleteLastExpense,
  updateLastExpenseAmount,
  searchExpenses,
  addNote,
  getPendingNotes,
  completeNotes,
  deleteNotes,
  searchNotes,
  EXPENSE_SHEET,
  NOTE_SHEET,
  BUDGET_SHEET,
  SETUP_HINT,
};
