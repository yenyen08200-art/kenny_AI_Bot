// Google OAuth 共用授權模組
// 由 calendar.js 與 daily-bot.js 共用,避免重複實作登入流程。
//
// 第一次執行時,若找不到 token.json 會自動開啟瀏覽器要求登入 Google 帳號授權,
// 授權完成後會在根目錄產生 token.json,之後就不用再重新登入。

const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');

const ROOT = path.join(__dirname, '..');
const CREDENTIALS_PATH = path.join(ROOT, 'credentials.json');
const TOKEN_PATH = path.join(ROOT, 'token.json');
// 記帳/筆記需要 Sheets 權限;新增 scope 後必須刪掉 token.json 重新授權一次
const SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/spreadsheets'];

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error('找不到 credentials.json,請確認檔案放在專案根目錄。');
  }
  const { installed } = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  if (!installed) {
    throw new Error('credentials.json 格式不符合預期(需要 "installed" 類型的 OAuth Client)。');
  }
  return installed;
}

function saveToken(token) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
}

function loadSavedToken() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
}

// 開一個本地伺服器接收 Google OAuth 的 redirect,拿到 code 後換 token
function getNewToken(oAuth2Client) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, 'http://localhost');
        const code = reqUrl.searchParams.get('code');
        if (!code) {
          res.end('授權失敗,請關閉此分頁後重試。');
          return;
        }
        res.end('授權成功!可以關閉這個分頁,回到終端機繼續。');
        server.close();

        const { tokens } = await oAuth2Client.getToken({
          code,
          redirect_uri: redirectUri,
        });
        oAuth2Client.setCredentials(tokens);
        saveToken(tokens);
        resolve(oAuth2Client);
      } catch (err) {
        reject(err);
      }
    });

    let redirectUri;
    server.listen(0, 'localhost', () => {
      const port = server.address().port;
      redirectUri = `http://localhost:${port}`;
      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        redirect_uri: redirectUri,
      });
      console.log('請在瀏覽器中開啟以下網址並登入授權:\n');
      console.log(authUrl);
      console.log('\n等待授權中...');
    });

    server.on('error', reject);
  });
}

async function authorize() {
  const { client_id, client_secret } = loadCredentials();
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);

  const saved = loadSavedToken();
  if (saved) {
    oAuth2Client.setCredentials(saved);
    return oAuth2Client;
  }
  return getNewToken(oAuth2Client);
}

module.exports = { authorize };
