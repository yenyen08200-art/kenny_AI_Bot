// 一次性設定腳本:建立「自訂分類」工作表,並在「帳戶」分頁加上「目標」欄位
//
// 用法: node setup-more-features.js
//
// 重複執行是安全的:已經存在的分頁/欄位不會被重建。

const { google } = require('googleapis');
const { authorize } = require('./services/googleAuth');

const SPREADSHEET_ID = '1qFgfaf2gtTvUF8uVsX0It727QZurDREouD9sm4iR3bQ';
const ACCOUNT_SHEET = '帳戶';
const CATEGORY_RULE_SHEET = '自訂分類';

async function sheetExists(sheets, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return (meta.data.sheets || []).find((s) => s.properties.title === title) || null;
}

async function main() {
  const auth = await authorize();
  const sheets = google.sheets({ version: 'v4', auth });

  // 1) 自訂分類
  if (await sheetExists(sheets, CATEGORY_RULE_SHEET)) {
    console.log('「自訂分類」分頁已經存在,不重建。');
  } else {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: CATEGORY_RULE_SHEET } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${CATEGORY_RULE_SHEET}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['關鍵字', '分類']] },
    });
    console.log('✅ 已建立「自訂分類」分頁');
  }

  // 2) 帳戶加上「目標」欄位
  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${ACCOUNT_SHEET}!A1:D1` });
  const header = (headerRes.data.values || [[]])[0];
  if (header[3] === '目標') {
    console.log('「帳戶」分頁已經有目標欄位,不重複處理。');
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ACCOUNT_SHEET}!D1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['目標']] },
    });
    console.log('✅ 「帳戶」分頁已加上目標欄位(填 0 或留空代表不設定)');
  }

  console.log('\n全部完成!');
}

main().catch((err) => {
  console.error('發生錯誤:', err.message);
  process.exitCode = 1;
});
