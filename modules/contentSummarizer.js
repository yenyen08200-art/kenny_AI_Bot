// 階段二預留模組:內容彙整(尚未實作)
//
// 規劃功能:
// - transcribeVoiceMessage: 接收 LINE 語音訊息內容,呼叫語音轉文字 API
//   (例如 Google Speech-to-Text)轉成文字後再交給 AI 摘要
// - summarizeUrl: 偵測訊息中的網址(長文/影片連結),抓取內容後
//   交給 Gemini 產生摘要

async function transcribeVoiceMessage(audioBuffer) {
  throw new Error('尚未實作:transcribeVoiceMessage');
}

async function summarizeUrl(url) {
  throw new Error('尚未實作:summarizeUrl');
}

module.exports = { transcribeVoiceMessage, summarizeUrl };
