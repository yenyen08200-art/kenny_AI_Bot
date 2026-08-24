// 台北時區(UTC+8,無日光節約)的日期邊界計算,不依賴伺服器自己所在的時區。
//
// Cloud Functions 預設用 UTC 執行,`new Date(); date.setHours(0,0,0,0)` 這種寫法
// 算出來的是「伺服器本地時區(UTC)的午夜」,跟「台北的午夜」差了整整 8 小時——
// 在台北時間 00:00~08:00 之間查「今天」,會查到錯的區間(漏掉今天下半天、多出昨天早上)。
// 一律透過這裡取得正確的台北日期邊界。

// 回傳「台北時間 today + dayOffset 天,00:00:00」這個瞬間的 Date 物件
function taipeiDayStart(dayOffset = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day') + dayOffset, -8, 0, 0, 0));
}

module.exports = { taipeiDayStart };
