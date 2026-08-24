// 一次性設定腳本:重新授權 Google 帳號(加上 Sheets 權限)並建立記帳/筆記用的試算表
//
// 用法: node setup-sheets.js
//
// 這支腳本會:
//   1. 刪除舊的 token.json(舊的只有 Calendar 權限,沒有 Sheets)
//   2. 開啟瀏覽器要求重新授權(Calendar + Sheets)
//   3. 建立一份含「記帳」「筆記」兩個工作表的試算表
//   4. 印出接下來要執行的 firebase 指令

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { authorize } = require('./services/googleAuth');

const TOKEN_PATH = path.join(__dirname, 'token.json');

async function createSpreadsheet(auth) {
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: '個人 AI 秘書 - 記帳與筆記' },
      sheets: [
        { properties: { title: '記帳' } },
        { properties: { title: '筆記' } },
      ],
    },
  });

  const spreadsheetId = res.data.spreadsheetId;

  // 寫入標題列
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: '記帳!A1:D1', values: [['日期', '時間', '品項', '金額']] },
        { range: '筆記!A1:D1', values: [['日期', '時間', '內容', '狀態']] },
      ],
    },
  });

  return { spreadsheetId, url: res.data.spreadsheetUrl };
}

// 目前的 token.json 是否已經有 Sheets 權限(有的話就不用再授權一次)
function tokenHasSheetsScope() {
  if (!fs.existsSync(TOKEN_PATH)) return false;
  try {
    const { scope } = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    return (scope || '').includes('spreadsheets');
  } catch {
    return false;
  }
}

async function main() {
  // 舊 token 只有 Calendar 權限,必須重新授權才能拿到 Sheets 權限
  if (!tokenHasSheetsScope() && fs.existsSync(TOKEN_PATH)) {
    const backup = `${TOKEN_PATH}.bak`;
    fs.copyFileSync(TOKEN_PATH, backup);
    fs.unlinkSync(TOKEN_PATH);
    console.log(`已備份舊的 token.json 到 ${path.basename(backup)},接下來要重新授權。\n`);
  } else if (tokenHasSheetsScope()) {
    console.log('現有的 token.json 已經有 Sheets 權限,不需要重新授權。\n');
  }

  const auth = await authorize();
  console.log('\n授權完成,正在建立試算表...\n');

  const { spreadsheetId, url } = await createSpreadsheet(auth);

  console.log('✅ 試算表建立完成!');
  console.log(`   網址: ${url}`);
  console.log(`   ID:   ${spreadsheetId}\n`);
  console.log('接下來請依序執行這三個指令,把新的授權與試算表 ID 上傳到雲端:\n');
  console.log('  firebase functions:secrets:set GOOGLE_TOKEN_JSON --data-file=token.json');
  console.log(`  firebase functions:secrets:set GOOGLE_SHEETS_ID --data-file=-   # 然後貼上: ${spreadsheetId}`);
  console.log('  firebase deploy --only functions\n');
}

main().catch((err) => {
  console.error('發生錯誤:', err.message);
  process.exitCode = 1;
});
