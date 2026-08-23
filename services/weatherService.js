// 天氣服務:串接中央氣象署(CWA)開放資料平台 - 一般天氣預報(36小時)
// API 文件: https://opendata.cwa.gov.tw/dist/opendata-swagger.html
// 資料集代碼 F-C0032-001,免費申請 API 授權碼即可使用。
const axios = require('axios');

const CWA_ENDPOINT = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001';

// 取得今日天氣重點:天氣現象、降雨機率、氣溫範圍
async function getTodayWeather() {
  const apiKey = process.env.CWA_API_KEY;
  const location = process.env.CWA_LOCATION || '臺南市';

  if (!apiKey) {
    throw new Error('缺少 CWA_API_KEY,請至 .env 設定中央氣象署開放資料 API 金鑰。');
  }

  const res = await axios.get(CWA_ENDPOINT, {
    params: {
      Authorization: apiKey,
      locationName: location,
    },
  });

  const loc = res.data?.records?.location?.[0];
  if (!loc) {
    throw new Error(`查無「${location}」的天氣資料,請確認 CWA_LOCATION 是否為正確的縣市名稱。`);
  }

  // 每個氣象要素(Wx/PoP/MinT/MaxT...)取最近一個時段的預報值
  const elements = {};
  for (const el of loc.weatherElement) {
    elements[el.elementName] = el.time?.[0]?.parameter?.parameterName;
  }

  return {
    location,
    description: elements.Wx || '無資料',
    rainChance: elements.PoP ?? '無資料',
    minTemp: elements.MinT ?? '無資料',
    maxTemp: elements.MaxT ?? '無資料',
  };
}

module.exports = { getTodayWeather };
