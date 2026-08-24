// 一次性設定腳本:建立記帳分類用的「預算」工作表
//
// 用法: node setup-budget.js
//
// 建立一個新分頁,每一列是一個分類 + 月預算(預設 0,代表不設定,不會觸發超支提醒)。
// 之後要調整預算金額,直接在 Google Sheet 裡改數字就好,不需要重新執行這支腳本。
// 重複執行是安全的:分頁已經存在就不會做任何事。

const { google } = require('googleapis');
const { authorize } = require('./services/googleAuth');
const { CATEGORY_NAMES } = require('./functions/services/expenseCategory');

const SPREADSHEET_ID = '1qFgfaf2gtTvUF8uVsX0It727QZurDREouD9sm4iR3bQ';
const BUDGET_SHEET = '預算';

async function main() {
  const auth = await authorize();
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === BUDGET_SHEET);

  if (exists) {
    console.log('「預算」分頁已經存在,不需要重新建立。');
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: BUDGET_SHEET } } }] },
  });

  const rows = [['分類', '月預算(填0代表不設定)'], ...CATEGORY_NAMES.map((c) => [c, 0])];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${BUDGET_SHEET}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  console.log(`✅ 已建立「預算」分頁,共 ${CATEGORY_NAMES.length} 個分類,預設月預算都是 0(不設定)。`);
  console.log('請到 Google Sheet 把想設定的分類金額改掉,例如「房租」改成 3000、「水電網路」改成 1000。');
}

main().catch((err) => {
  console.error('發生錯誤:', err.message);
  process.exitCode = 1;
});
