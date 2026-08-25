// 一次性設定腳本:建立「帳戶」「轉帳」工作表,把「記帳」加上帳戶欄位,並淘汰舊的「存款」表
//
// 用法: node setup-accounts.js
//
// 帳戶餘額的算法是「起始餘額 + 起始日期之後的異動」即時加總,不是維護一個容易跑掉的
// 累計數字。這支腳本:
//   1. 建立「帳戶」分頁,用你目前天天記帳裡的真實餘額當起始值(現金486、錢袋5000、
//      存款9000、妹妹欠款10000),起始日期是今天——代表今天以前的記帳都不會重複扣款
//   2. 建立「轉帳」分頁(日期/時間/從帳戶/到帳戶/金額/備註)
//   3. 「記帳」分頁加上第 5 欄「帳戶」,把已經匯入的歷史紀錄全部標記成「現金」
//   4. 刪除舊的「存款」分頁(已確認是空的,功能被「帳戶」+「轉帳」取代)
//
// 重複執行是安全的:已經存在的分頁不會被重建。

const { google } = require('googleapis');
const { authorize } = require('./services/googleAuth');

const SPREADSHEET_ID = '1qFgfaf2gtTvUF8uVsX0It727QZurDREouD9sm4iR3bQ';
const ACCOUNT_SHEET = '帳戶';
const TRANSFER_SHEET = '轉帳';
const EXPENSE_SHEET = '記帳';
const SAVING_SHEET = '存款';
const DEFAULT_ACCOUNT = '現金';

const SEED_ACCOUNTS = [
  { name: '現金', balance: 486 },
  { name: '錢袋', balance: 5000 },
  { name: '存款', balance: 9000 },
  { name: '妹妹欠款', balance: 10000 },
];

function todayStr() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function sheetExists(sheets, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return (meta.data.sheets || []).find((s) => s.properties.title === title) || null;
}

async function main() {
  const auth = await authorize();
  const sheets = google.sheets({ version: 'v4', auth });
  const today = todayStr();

  // 1) 帳戶
  if (await sheetExists(sheets, ACCOUNT_SHEET)) {
    console.log('「帳戶」分頁已經存在,不重建。');
  } else {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: ACCOUNT_SHEET } } }] },
    });
    const rows = [
      ['帳戶名稱', '起始餘額', '起始日期'],
      ...SEED_ACCOUNTS.map((a) => [a.name, a.balance, today]),
    ];
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ACCOUNT_SHEET}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
    console.log(`✅ 已建立「帳戶」分頁,${SEED_ACCOUNTS.length} 個帳戶,起始日期 ${today}`);
  }

  // 2) 轉帳
  if (await sheetExists(sheets, TRANSFER_SHEET)) {
    console.log('「轉帳」分頁已經存在,不重建。');
  } else {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TRANSFER_SHEET } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TRANSFER_SHEET}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['日期', '時間', '從帳戶', '到帳戶', '金額', '備註']] },
    });
    console.log('✅ 已建立「轉帳」分頁');
  }

  // 3) 記帳加上帳戶欄位
  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${EXPENSE_SHEET}!A1:E1` });
  const header = (headerRes.data.values || [[]])[0];
  if (header[4] === '帳戶') {
    console.log('「記帳」分頁已經有帳戶欄位,不重複處理。');
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${EXPENSE_SHEET}!E1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['帳戶']] },
    });

    const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${EXPENSE_SHEET}!A2:D` });
    const rows = dataRes.data.values || [];
    if (rows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${EXPENSE_SHEET}!E2:E${rows.length + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows.map(() => [DEFAULT_ACCOUNT]) },
      });
    }
    console.log(`✅ 「記帳」分頁已加上帳戶欄位,${rows.length} 筆舊紀錄標記為「${DEFAULT_ACCOUNT}」`);
  }

  // 4) 刪除舊的「存款」分頁(功能被帳戶+轉帳取代)
  const savingSheet = await sheetExists(sheets, SAVING_SHEET);
  if (!savingSheet) {
    console.log('「存款」分頁不存在或已經刪除。');
  } else {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ deleteSheet: { sheetId: savingSheet.properties.sheetId } }] },
    });
    console.log('✅ 已刪除舊的「存款」分頁(功能已由帳戶+轉帳取代)');
  }

  console.log('\n全部完成!');
}

main().catch((err) => {
  console.error('發生錯誤:', err.message);
  process.exitCode = 1;
});
