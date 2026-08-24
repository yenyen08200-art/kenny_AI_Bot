// 一次性匯入腳本:把「天天記帳」App 匯出的 CSV 舊資料搬進記帳試算表
//
// 用法: node import-tiantian-csv.js <收支 CSV 路徑>
//
// 只匯入「支」(支出)的紀錄,忽略「收」(收入)跟轉帳(轉帳本來就不是支出)。
// 品項欄位組合方式:類別・標籤・備註(有值的才接起來)。
// 時間欄位用 CSV 裡的「上次更新」時間戳記當作記錄時間的近似值(CSV 本身沒有更精確的欄位)。

const fs = require('fs');
const { google } = require('googleapis');
const { authorize } = require('./services/googleAuth');

const SPREADSHEET_ID = '1qFgfaf2gtTvUF8uVsX0It727QZurDREouD9sm4iR3bQ';
const EXPENSE_SHEET = '記帳';

// 簡易 CSV parser,支援雙引號欄位(含逗號、換行、"" 轉義)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toDate(yyyymmdd) {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function toTime(lastUpdate) {
  const match = /\d{2}:\d{2}/.exec(lastUpdate || '');
  return match ? match[0] : '00:00';
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    throw new Error('用法: node import-tiantian-csv.js <收支 CSV 路徑>');
  }

  const raw = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(raw);
  const header = rows[0];
  console.log('欄位:', header.join(' | '));

  const idx = {
    date: header.indexOf('日期'),
    category: header.indexOf('類別'),
    amount: header.indexOf('金額'),
    tag: header.indexOf('標籤'),
    note: header.indexOf('備註'),
    type: header.indexOf('收支區分'),
    lastUpdate: header.indexOf('上次更新'),
  };

  const entries = [];
  let skippedIncome = 0;
  let skippedInvalid = 0;

  for (const r of rows.slice(1)) {
    if (!r[idx.date]) continue;
    if (r[idx.type] !== '支') {
      skippedIncome++;
      continue;
    }
    const amount = Number(r[idx.amount]);
    if (!Number.isFinite(amount) || amount <= 0) {
      skippedInvalid++;
      continue;
    }
    const parts = [r[idx.category], r[idx.tag], r[idx.note]]
      .map((s) => (s || '').trim().replace(/\s*[\r\n]+\s*/g, ' / '))
      .filter(Boolean);
    entries.push({
      date: toDate(r[idx.date]),
      time: toTime(r[idx.lastUpdate]),
      item: parts.join('・') || '未分類',
      amount,
    });
  }

  // CSV 是新到舊排列,匯入時間軸由舊到新比較直覺
  entries.reverse();

  console.log(`\n共 ${rows.length - 1} 筆原始紀錄,其中支出 ${entries.length} 筆(跳過收入/轉帳 ${skippedIncome} 筆,無效 ${skippedInvalid} 筆)`);
  console.log('前 5 筆預覽:');
  entries.slice(0, 5).forEach((e) => console.log(`  ${e.date} ${e.time}  ${e.item}  $${e.amount}`));
  console.log('後 5 筆預覽:');
  entries.slice(-5).forEach((e) => console.log(`  ${e.date} ${e.time}  ${e.item}  $${e.amount}`));

  const total = entries.reduce((s, e) => s + e.amount, 0);
  console.log(`\n總金額:$${total.toLocaleString()}`);

  if (process.argv[3] !== '--commit') {
    console.log('\n(僅預覽,尚未寫入。確認沒問題後執行: node import-tiantian-csv.js <CSV路徑> --commit)');
    return;
  }

  const auth = await authorize();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${EXPENSE_SHEET}!A:D`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: entries.map((e) => [e.date, e.time, e.item, e.amount]) },
  });
  console.log(`\n✅ 已寫入 ${entries.length} 筆到試算表`);
}

main().catch((err) => {
  console.error('發生錯誤:', err.message);
  process.exitCode = 1;
});
