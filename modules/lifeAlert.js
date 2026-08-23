// 階段二預留模組:即時生活感知(尚未實作)
//
// 規劃功能:
// - checkRainAlert: 定時輪詢 CWA 短時預報(如逐三小時預報),
//   降雨機率超過設定門檻時主動觸發 LINE 推播提醒
// - checkTyphoonClosureNotice: 抓取人事行政總處停班停課 API,
//   颱風或天災公告發布時自動通知使用者

async function checkRainAlert() {
  throw new Error('尚未實作:checkRainAlert');
}

async function checkTyphoonClosureNotice() {
  throw new Error('尚未實作:checkTyphoonClosureNotice');
}

module.exports = { checkRainAlert, checkTyphoonClosureNotice };
