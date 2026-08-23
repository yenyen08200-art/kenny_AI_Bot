// LINE Webhook 伺服器 - 接收使用者傳的文字訊息,解析成待辦事項並寫入 Google 日曆
//
// 用法: node webhook.js (或 npm run webhook)
// 這是一個常駐伺服器,需要一直執行才能接收訊息。
// 本機測試需搭配 ngrok 等工具把 PORT 對外開放,並在 LINE Developers Console 設定 Webhook URL
// (Messaging API 分頁 -> Webhook settings -> Webhook URL,填入 https://你的網址/webhook,並開啟 Use webhook)

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const line = require('@line/bot-sdk');

const { authorize } = require('./services/googleAuth');
const { addEvent } = require('./services/calendarService');
const taskManager = require('./modules/taskManager');

// Render 等雲端平台會自動指派 PORT 環境變數,本機開發才會用到 WEBHOOK_PORT
const PORT = process.env.PORT || process.env.WEBHOOK_PORT || 3000;

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

if (!lineConfig.channelAccessToken || !lineConfig.channelSecret) {
  console.error('[webhook] 缺少 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_CHANNEL_SECRET,請至 .env 設定後再啟動。');
  process.exit(1);
}

const client = new line.Client(lineConfig);
const app = express();

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
}

async function handleTextMessage(event) {
  const userId = event.source.userId;
  const text = event.message.text;

  // 僅服務指定的個人使用者,避免其他人亂寫行程進日曆
  if (userId !== process.env.LINE_USER_ID) {
    console.log(`[webhook] 拒絕非本人訊息,userId=${userId}`);
    return client.replyMessage(event.replyToken, { type: 'text', text: '這是私人秘書機器人,暫不提供服務 🙏' });
  }

  console.log(`[webhook] 收到訊息: ${text}`);

  const parsed = await taskManager.parseNaturalLanguageTodo(text);
  if (!parsed.isValid) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `🤔 我沒有抓到明確的待辦資訊(${parsed.reason || '請提供更明確的時間'})\n可以試試「明天下午3點跟設計師開會」這種說法喔`,
    });
  }

  const auth = await authorize();

  // 新增前先查有沒有重疊的既有行程
  const conflicts = await taskManager.checkScheduleConflict(auth, { start: parsed.start, end: parsed.end });

  const created = await addEvent(auth, { summary: parsed.title, start: parsed.start, end: parsed.end });

  const lines = [
    '✅ 已幫你加入行程',
    `📌 ${created.summary}`,
    `🕒 ${formatDateTime(created.start)} - ${formatDateTime(created.end)}`,
  ];

  if (conflicts.length > 0) {
    lines.push('', `⚠️ 這個時段跟「${conflicts[0].summary}」有重疊,記得確認一下喔`);
  }

  return client.replyMessage(event.replyToken, { type: 'text', text: lines.join('\n') });
}

app.post('/webhook', line.middleware(lineConfig), (req, res) => {
  const events = req.body.events || [];

  Promise.all(
    events.map((event) => {
      if (event.type !== 'message' || event.message.type !== 'text') return null;
      return handleTextMessage(event).catch((err) => {
        console.error('[webhook] 處理訊息失敗:', err.message);
        return client
          .replyMessage(event.replyToken, { type: 'text', text: '處理時發生錯誤,請稍後再試 🙇' })
          .catch(() => {});
      });
    })
  )
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error('[webhook] 未預期錯誤:', err.message);
      res.status(200).end(); // LINE 建議一律回 200,避免對方重送
    });
});

app.get('/', (req, res) => res.send('daily-bot webhook is running'));

// LINE middleware 驗證失敗時會丟出這些錯誤,統一處理
app.use((err, req, res, next) => {
  if (err instanceof line.SignatureValidationFailed) {
    res.status(401).send('signature validation failed');
    return;
  }
  if (err instanceof line.JSONParseError) {
    res.status(400).send('invalid json');
    return;
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`[webhook] 伺服器已啟動,監聽埠號 ${PORT}`);
  console.log('[webhook] 記得用 ngrok 等工具把這個埠號對外開放,並在 LINE Developers Console 設定 Webhook URL');
});
