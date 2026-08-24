// Google OAuth 授權(Firebase Functions 版)
//
// Cloud Functions 沒有互動式瀏覽器,無法像本機版一樣跳出登入畫面,
// 所以這裡不做「取得新 token」的流程,只使用本機已經授權好、
// 透過 Firebase Secret 注入的 credentials.json / token.json 內容來還原授權。
// (refresh_token 存在的話,googleapis 會在 access_token 過期時自動刷新)
const { google } = require('googleapis');

function authorize() {
  const credentialsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
  const tokenRaw = process.env.GOOGLE_TOKEN_JSON;

  if (!credentialsRaw || !tokenRaw) {
    throw new Error('缺少 GOOGLE_CREDENTIALS_JSON 或 GOOGLE_TOKEN_JSON,請確認 Firebase Secret 是否已設定。');
  }

  const { client_id, client_secret } = JSON.parse(credentialsRaw).installed;
  const token = JSON.parse(tokenRaw);

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

module.exports = { authorize };
