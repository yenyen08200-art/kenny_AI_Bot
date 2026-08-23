// 階段二預留模組:商務輔助(尚未實作)
//
// 規劃功能:
// - filterImportantEmails: 透過 Gmail API 依規則(寄件者/關鍵字)篩選重要信件,
//   摘要後轉發或推播通知
// - recordReceiptToSheet: 辨識收據內容(OCR 或 Gemini Vision),
//   將結構化資料寫入 Google Sheets API 完成自動記帳

async function filterImportantEmails(auth) {
  throw new Error('尚未實作:filterImportantEmails');
}

async function recordReceiptToSheet(auth, receiptData) {
  throw new Error('尚未實作:recordReceiptToSheet');
}

module.exports = { filterImportantEmails, recordReceiptToSheet };
