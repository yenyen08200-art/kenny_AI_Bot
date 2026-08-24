// 一次性設定腳本:建立/更新 LINE 圖文選單(Rich Menu)並設為預設
//
// 用法: node setup-richmenu.js
//
// 這支腳本會:
//   1. 刪除帳號上所有既有的圖文選單(避免疊加、混淆)
//   2. 用 richmenu/richmenu.png 建立新的圖文選單
//   3. 設為所有使用者的預設選單
//
// 選單上的 6 個按鈕都是直接送出對應的文字訊息,跟原本 Quick Reply 是同一組指令,
// 所以不用額外寫任何解析邏輯,重複執行也是安全的(舊選單會先被清掉)。

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const line = require('@line/bot-sdk');

const IMAGE_PATH = path.join(__dirname, 'richmenu', 'richmenu.png');

const RICH_MENU = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: '個人秘書主選單',
  chatBarText: '選單',
  areas: [
    { bounds: { x: 0, y: 0, width: 834, height: 843 }, action: { type: 'message', text: '今天狀況' } },
    { bounds: { x: 834, y: 0, width: 833, height: 843 }, action: { type: 'message', text: '這週行程' } },
    { bounds: { x: 1667, y: 0, width: 833, height: 843 }, action: { type: 'message', text: '這週哪天有空' } },
    { bounds: { x: 0, y: 843, width: 834, height: 843 }, action: { type: 'message', text: '我的筆記' } },
    { bounds: { x: 834, y: 843, width: 833, height: 843 }, action: { type: 'message', text: '這個月花多少' } },
    { bounds: { x: 1667, y: 843, width: 833, height: 843 }, action: { type: 'message', text: '指令' } },
  ],
};

async function main() {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelAccessToken) {
    throw new Error('缺少 LINE_CHANNEL_ACCESS_TOKEN,請確認 .env 有設定。');
  }
  if (!fs.existsSync(IMAGE_PATH)) {
    throw new Error(`找不到選單圖片:${IMAGE_PATH},請先執行 richmenu/generate-image.ps1`);
  }

  const client = new line.Client({ channelAccessToken });

  const existing = await client.getRichMenuList();
  for (const menu of existing) {
    await client.deleteRichMenu(menu.richMenuId);
    console.log(`已刪除舊選單:${menu.richMenuId}(${menu.name}）`);
  }

  const richMenuId = await client.createRichMenu(RICH_MENU);
  console.log(`已建立選單:${richMenuId}`);

  const imageBuffer = fs.readFileSync(IMAGE_PATH);
  await client.setRichMenuImage(richMenuId, imageBuffer, 'image/png');
  console.log('已上傳選單圖片');

  await client.setDefaultRichMenu(richMenuId);
  console.log('✅ 已設為預設選單,重新開啟 LINE 聊天室就會看到(手機可能需要切換分頁刷新)');
}

main().catch((err) => {
  console.error('發生錯誤:', err.message);
  process.exitCode = 1;
});
