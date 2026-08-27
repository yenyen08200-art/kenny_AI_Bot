// 一次性設定腳本:建立「記憶」工作表(教機器人記住的固定事實/偏好)
//
// 用法: node setup-memory.js
//
// 重複執行是安全的:已經存在的分頁不會被重建。

const { google } = require('googleapis');
const { authorize } = require('./services/googleAuth');

const SPREADSHEET_ID = '1qFgfaf2gtTvUF8uVsX0It727QZurDREouD9sm4iR3bQ';
const MEMORY_SHEET = '記憶';

async function sheetExists(sheets, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return (meta.data.sheets || []).find((s) => s.properties.title === title) || null;
}

async function main() {
  const auth = await authorize();
  const sheets = google.sheets({ version: 'v4', auth });

  if (await sheetExists(sheets, MEMORY_SHEET)) {
    console.log('「記憶」分頁已經存在,不重建。');
  } else {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: MEMORY_SHEET } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MEMORY_SHEET}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['日期', '內容']] },
    });
    console.log('✅ 已建立「記憶」分頁');
  }

  console.log('\n全部完成!');
}

main().catch((err) => {
  console.error('發生錯誤:', err.message);
  process.exitCode = 1;
});
