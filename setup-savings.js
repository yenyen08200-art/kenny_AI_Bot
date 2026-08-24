// 一次性設定腳本:建立「存款」工作表
//
// 用法: node setup-savings.js
//
// 存款是獨立一張表,跟「記帳」分開,這樣「這個月花多少」才不會被存進去的錢灌水。
// 重複執行是安全的:分頁已經存在就不會做任何事。

const { google } = require('googleapis');
const { authorize } = require('./services/googleAuth');

const SPREADSHEET_ID = '1qFgfaf2gtTvUF8uVsX0It727QZurDREouD9sm4iR3bQ';
const SAVING_SHEET = '存款';

async function main() {
  const auth = await authorize();
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === SAVING_SHEET);

  if (exists) {
    console.log('「存款」分頁已經存在,不需要重新建立。');
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: SAVING_SHEET } } }] },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SAVING_SHEET}!A1:D1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['日期', '時間', '項目', '金額']] },
  });

  console.log('✅ 已建立「存款」分頁。');
}

main().catch((err) => {
  console.error('發生錯誤:', err.message);
  process.exitCode = 1;
});
