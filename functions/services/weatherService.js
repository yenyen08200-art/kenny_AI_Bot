// 天氣服務:串接中央氣象署(CWA)開放資料平台
// API 文件: https://opendata.cwa.gov.tw/dist/opendata-swagger.html
// F-C0032-001(今明36小時天氣預報)+ F-C0032-005(一週縣市天氣預報),都是免費資料集。
const axios = require('axios');

const CWA_ENDPOINT = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001';
// 一週預報是「檔案下載」API,一次回傳全台 22 縣市,不能用 locationName 篩選,要自己找
const WEEKLY_ENDPOINT = 'https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/F-C0032-005';

// 取得今日天氣重點:天氣現象、降雨機率、氣溫範圍
async function getTodayWeather(overrideLocation) {
  const apiKey = process.env.CWA_API_KEY;
  const location = overrideLocation || process.env.CWA_LOCATION || '臺南市';

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

// 取得未來 7 天的每日天氣(天氣現象 + 高低溫 + 降雨機率)。
// 一週預報(F-C0032-005)本身沒有降雨機率——CWA 只在 36 小時內提供 12 小時降雨機率,
// 所以額外查 36 小時預報(F-C0032-001)的 PoP,把有的那 1-2 天併進去;
// 更後面的日子就沒有降雨機率資料,rainChance 會是 null。
async function getWeeklyWeather(overrideLocation) {
  const apiKey = process.env.CWA_API_KEY;
  const location = overrideLocation || process.env.CWA_LOCATION || '臺南市';

  if (!apiKey) {
    throw new Error('缺少 CWA_API_KEY,請至 .env 設定中央氣象署開放資料 API 金鑰。');
  }

  const [weeklyRes, shortRes] = await Promise.all([
    axios.get(WEEKLY_ENDPOINT, { params: { Authorization: apiKey, format: 'JSON' } }),
    axios.get(CWA_ENDPOINT, { params: { Authorization: apiKey, locationName: location } }),
  ]);

  const locations = weeklyRes.data?.cwaopendata?.dataset?.location || [];
  const loc = locations.find((l) => l.locationName === location);
  if (!loc) {
    throw new Error(`查無「${location}」的一週天氣資料,請確認 CWA_LOCATION 是否為正確的縣市名稱。`);
  }

  const elements = {};
  for (const el of loc.weatherElement) elements[el.elementName] = el.time || [];

  // 依日期(台北時區的西元日期)分組,每天 2 個 12 小時時段;Wx 取當天第一個時段的描述,
  // 高低溫取當天所有時段的極值
  const days = new Map();
  for (const t of elements.Wx || []) {
    const date = t.startTime.slice(0, 10);
    if (!days.has(date)) {
      days.set(date, { date, description: t.parameter.parameterName, maxTemp: -Infinity, minTemp: Infinity, rainChance: null });
    }
  }
  for (const t of elements.MaxT || []) {
    const day = days.get(t.startTime.slice(0, 10));
    if (day) day.maxTemp = Math.max(day.maxTemp, Number(t.parameter.parameterName));
  }
  for (const t of elements.MinT || []) {
    const day = days.get(t.startTime.slice(0, 10));
    if (day) day.minTemp = Math.min(day.minTemp, Number(t.parameter.parameterName));
  }

  // 把 36 小時預報裡的降雨機率併進對應日期(同一天取較高的那個時段,保守起見)
  const shortLoc = shortRes.data?.records?.location?.[0];
  const popEl = shortLoc?.weatherElement?.find((e) => e.elementName === 'PoP');
  for (const t of popEl?.time || []) {
    const day = days.get(t.startTime.slice(0, 10));
    const val = Number(t.parameter?.parameterName);
    if (day && Number.isFinite(val)) day.rainChance = day.rainChance === null ? val : Math.max(day.rainChance, val);
  }

  return { location, days: [...days.values()] };
}

module.exports = { getTodayWeather, getWeeklyWeather };
