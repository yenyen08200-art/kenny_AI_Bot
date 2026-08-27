// Google Sheets 服務:記帳 + 筆記
// 兩者共用同一份試算表,分成「記帳」與「筆記」兩個工作表。
// 試算表由 setup-sheets.js 建立,ID 存在 GOOGLE_SHEETS_ID 這個 Secret。

const { google } = require('googleapis');
const { classify } = require('./expenseCategory');

const EXPENSE_SHEET = '記帳';
const NOTE_SHEET = '筆記';
const BUDGET_SHEET = '預算';
const ACCOUNT_SHEET = '帳戶';
const TRANSFER_SHEET = '轉帳';
const CATEGORY_RULE_SHEET = '自訂分類';
const MEMORY_SHEET = '記憶';
const DEFAULT_ACCOUNT = '現金';

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
    range: `${sheetName}!A:F`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}

async function readRows(auth, sheetName) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${sheetName}!A2:F`, // 跳過標題列;寬度夠涵蓋各工作表的欄位數
  });
  return res.data.values || [];
}

// ── 記帳 ──

// 新增一筆支出,欄位為:日期 / 時間 / 品項 / 金額 / 帳戶(不指定就算現金)
async function addExpense(auth, { item, amount, account = DEFAULT_ACCOUNT }) {
  const { date, time } = taipeiNowParts();
  await appendRow(auth, EXPENSE_SHEET, [date, time, item, amount, account]);
  return { date, item, amount, account };
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

// 依分類統計某個月份(預設本月)的支出,分類由 expenseCategory.js 用關鍵字自動判斷
// 讀使用者自己教的分類關鍵字(例如「星巴克算學習工作」),優先於內建規則比對
async function getCustomCategoryRules(auth) {
  const rows = await readRows(auth, CATEGORY_RULE_SHEET);
  return rows.filter((r) => r[0] && r[1]).map((r) => ({ keyword: r[0], category: r[1] }));
}

// 新增一條自訂分類規則(category 已經是正規化過的固定分類名稱)
async function addCustomCategoryRule(auth, keyword, category) {
  await appendRow(auth, CATEGORY_RULE_SHEET, [keyword, category]);
}

async function getMonthlyExpenseByCategory(auth, yearMonth = null) {
  const target = yearMonth || taipeiNowParts().yearMonth;
  const [rows, customRules] = await Promise.all([readRows(auth, EXPENSE_SHEET), getCustomCategoryRules(auth)]);
  const matched = rows.filter((r) => (r[0] || '').startsWith(target));

  const byCategory = {};
  for (const r of matched) {
    const category = classify(r[2], customRules);
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
    range: `${EXPENSE_SHEET}!A:E`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: entries.map((e) => [date, time, e.item, e.amount, e.account || DEFAULT_ACCOUNT]) },
  });
  return entries.map((e) => ({ date, account: e.account || DEFAULT_ACCOUNT, ...e }));
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

// ── 帳戶 / 轉帳 ──
//
// 帳戶餘額不是存一個容易跑掉的累計數字,而是「起始餘額 + 起始日期之後的異動」每次
// 查詢當下重新加總——記帳、改資料、刪記錄都不會讓餘額對不起來。

// 記帳/轉帳的「日期 時間」組成排序用的鍵值,跟帳戶的起始時間用同一套格式比大小。
// 舊資料只有日期沒有時間也沒關係:"2026-08-25" 在字串排序上小於 "2026-08-25 12:45",
// 效果等同「這天一整天都算」,跟原本只比對日期的邏輯相容
function dateTimeKey(date, time) {
  return `${date || ''} ${time || ''}`.trim();
}

// 讀所有帳戶(名稱 / 起始餘額 / 起始時間 / 目標金額,目標是 0 代表沒設定)
async function getAccounts(auth) {
  const rows = await readRows(auth, ACCOUNT_SHEET);
  return rows
    .filter((r) => r[0])
    .map((r) => ({ name: r[0], startBalance: Number(r[1]) || 0, startDateTime: r[2] || '1970-01-01', goal: Number(r[3]) || 0 }));
}

// 設定/取消某個帳戶的目標金額(存款目標之類),goal 填 0 代表取消目標
async function setAccountGoal(auth, name, goal) {
  const sheets = google.sheets({ version: 'v4', auth });
  const rows = await readRows(auth, ACCOUNT_SHEET);
  const idx = rows.findIndex((r) => r[0] === name);
  if (idx === -1) return false;

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${ACCOUNT_SHEET}!D${idx + 2}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[goal]] },
  });
  return true;
}

// 把使用者打的文字對應到真實帳戶名稱(完全比對優先,再寬鬆比對),找不到回傳 null
async function resolveAccountName(auth, text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const accounts = await getAccounts(auth);
  const exact = accounts.find((a) => a.name === trimmed);
  if (exact) return exact.name;
  const fuzzy = accounts.find((a) => trimmed.includes(a.name) || a.name.includes(trimmed));
  return fuzzy ? fuzzy.name : null;
}

// 新增帳戶
async function addAccount(auth, name, startBalance = 0) {
  const accounts = await getAccounts(auth);
  if (accounts.some((a) => a.name === name)) {
    throw new Error(`帳戶「${name}」已經存在`);
  }
  const { date, time } = taipeiNowParts();
  const startDateTime = dateTimeKey(date, time);
  await appendRow(auth, ACCOUNT_SHEET, [name, startBalance, startDateTime]);
  return { name, startBalance, startDateTime };
}

// 移除帳戶(只是不再追蹤,歷史記帳/轉帳紀錄不會被刪除或改動)
async function removeAccount(auth, name) {
  const sheets = google.sheets({ version: 'v4', auth });
  const rows = await readRows(auth, ACCOUNT_SHEET);
  const idx = rows.findIndex((r) => r[0] === name);
  if (idx === -1) return false;

  const sheetId = await getSheetId(auth, ACCOUNT_SHEET);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: idx + 1, endIndex: idx + 2 } } }],
    },
  });
  return true;
}

// 校正帳戶餘額(手動對過帳、跟現實金額對不上時強制同步):起始時間重設為「現在這一刻」
// (精確到分鐘,不是只到日期),校正之前(含當天稍早)的記帳/轉帳都不會再重複影響餘額
async function setAccountBaseline(auth, name, balance) {
  const sheets = google.sheets({ version: 'v4', auth });
  const rows = await readRows(auth, ACCOUNT_SHEET);
  const idx = rows.findIndex((r) => r[0] === name);
  const { date, time } = taipeiNowParts();
  const startDateTime = dateTimeKey(date, time);

  if (idx === -1) {
    await appendRow(auth, ACCOUNT_SHEET, [name, balance, startDateTime]);
    return;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${ACCOUNT_SHEET}!B${idx + 2}:C${idx + 2}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[balance, startDateTime]] },
  });
}

// 算出所有帳戶目前的餘額
async function getAllAccountBalances(auth) {
  const accounts = await getAccounts(auth);
  if (!accounts.length) return [];

  const [expenseRows, transferRows] = await Promise.all([readRows(auth, EXPENSE_SHEET), readRows(auth, TRANSFER_SHEET)]);

  return accounts.map((account) => {
    const spent = expenseRows
      .filter((r) => dateTimeKey(r[0], r[1]) >= account.startDateTime && r[4] === account.name)
      .reduce((s, r) => s + (Number(r[3]) || 0), 0);
    const transferredOut = transferRows
      .filter((r) => dateTimeKey(r[0], r[1]) >= account.startDateTime && r[2] === account.name)
      .reduce((s, r) => s + (Number(r[4]) || 0), 0);
    const transferredIn = transferRows
      .filter((r) => dateTimeKey(r[0], r[1]) >= account.startDateTime && r[3] === account.name)
      .reduce((s, r) => s + (Number(r[4]) || 0), 0);
    const balance = account.startBalance - spent - transferredOut + transferredIn;
    return { name: account.name, balance, goal: account.goal };
  });
}

// 記一筆轉帳:日期 / 時間 / 從帳戶 / 到帳戶 / 金額 / 備註
async function addTransfer(auth, { from, to, amount, note = '' }) {
  const { date, time } = taipeiNowParts();
  await appendRow(auth, TRANSFER_SHEET, [date, time, from, to, amount, note]);
  return { date, from, to, amount };
}

// 某個帳戶最近的異動明細(記帳支出 + 轉帳進出),依時間新到舊排序
async function getAccountLedger(auth, accountName, limit = 15) {
  const [expenseRows, transferRows] = await Promise.all([readRows(auth, EXPENSE_SHEET), readRows(auth, TRANSFER_SHEET)]);

  const entries = [];
  for (const r of expenseRows) {
    if (r[4] === accountName) {
      entries.push({ date: r[0], time: r[1], desc: r[2], amount: -(Number(r[3]) || 0) });
    }
  }
  for (const r of transferRows) {
    if (r[2] === accountName) entries.push({ date: r[0], time: r[1], desc: `轉出到「${r[3]}」`, amount: -(Number(r[4]) || 0) });
    if (r[3] === accountName) entries.push({ date: r[0], time: r[1], desc: `「${r[2]}」轉入`, amount: Number(r[4]) || 0 });
  }

  entries.sort((a, b) => (dateTimeKey(b.date, b.time) > dateTimeKey(a.date, a.time) ? 1 : -1));
  return entries.slice(0, limit);
}

// 最近的轉帳紀錄(不限帳戶),依時間新到舊排序
async function getRecentTransfers(auth, limit = 15) {
  const rows = await readRows(auth, TRANSFER_SHEET);
  return rows
    .map((r) => ({ date: r[0], time: r[1], from: r[2], to: r[3], amount: Number(r[4]) || 0, note: r[5] || '' }))
    .sort((a, b) => (dateTimeKey(b.date, b.time) > dateTimeKey(a.date, a.time) ? 1 : -1))
    .slice(0, limit);
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

// ── 記憶(使用者教機器人記住的固定事實/偏好,判斷不出來時會餵給 Claude 參考)──

async function addMemory(auth, content) {
  const { date } = taipeiNowParts();
  await appendRow(auth, MEMORY_SHEET, [date, content]);
  return { date, content };
}

async function getMemories(auth) {
  const rows = await readRows(auth, MEMORY_SHEET);
  return rows
    .map((r, idx) => ({ rowIndex: idx + 2, date: r[0], content: r[1] }))
    .filter((m) => m.content);
}

// 整筆刪除記憶,一次可以刪多則(displayIndices 對應 getMemories 的顯示順序,n 從 1 開始)
async function deleteMemories(auth, displayIndices) {
  const all = await getMemories(auth);
  const targets = displayIndices.map((i) => all[i - 1]).filter(Boolean);
  if (!targets.length) return [];

  const sheets = google.sheets({ version: 'v4', auth });
  const sheetId = await getSheetId(auth, MEMORY_SHEET);

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
  getAccounts,
  resolveAccountName,
  addAccount,
  removeAccount,
  setAccountBaseline,
  setAccountGoal,
  getAllAccountBalances,
  addTransfer,
  getAccountLedger,
  getRecentTransfers,
  getCustomCategoryRules,
  addCustomCategoryRule,
  deleteLastExpense,
  updateLastExpenseAmount,
  searchExpenses,
  addNote,
  getPendingNotes,
  completeNotes,
  deleteNotes,
  searchNotes,
  addMemory,
  getMemories,
  deleteMemories,
  EXPENSE_SHEET,
  NOTE_SHEET,
  BUDGET_SHEET,
  ACCOUNT_SHEET,
  TRANSFER_SHEET,
  CATEGORY_RULE_SHEET,
  MEMORY_SHEET,
  DEFAULT_ACCOUNT,
  SETUP_HINT,
};
