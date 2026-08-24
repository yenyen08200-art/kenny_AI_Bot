// LINE 推播服務:透過 LINE Messaging API 把訊息推送給使用者
const line = require('@line/bot-sdk');

function getClient() {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelAccessToken) {
    throw new Error('缺少 LINE_CHANNEL_ACCESS_TOKEN,請至 .env 設定 LINE Messaging API 的 Channel Access Token。');
  }
  return new line.Client({ channelAccessToken });
}

// message 可以是純文字字串(轉成 text message),也可以是完整的 LINE 訊息物件(例如 Flex Message)
async function pushMessage(message) {
  const userId = process.env.LINE_USER_ID;
  if (!userId) {
    throw new Error('缺少 LINE_USER_ID,請至 .env 設定要接收推播的 LINE User ID。');
  }
  const client = getClient();
  const payload = typeof message === 'string' ? { type: 'text', text: message } : message;
  await client.pushMessage(userId, payload);
}

module.exports = { pushMessage };
