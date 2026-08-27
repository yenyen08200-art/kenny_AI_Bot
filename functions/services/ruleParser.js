// 純規則(不呼叫任何 AI)判斷訊息意圖 + 解析中文時間片語
// 涵蓋日常大部分句型;規則判斷不出來時,回傳 null,交給上層 fallback 給 Claude

const { classify, DEFAULT_CATEGORY } = require('./expenseCategory');

const WEEKDAY_MAP = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

const WEATHER_KEYWORDS = /天氣|會不會下雨|降雨|要不要帶傘|氣溫|會下雨嗎/;
const SCHEDULE_KEYWORDS = /行程|事情|安排|有沒有事|待辦|有什麼事/;

// 縣市別名 → CWA 開放資料使用的正式縣市名稱(一律用「臺」不用「台」)
// 由長到短排序,避免「新竹市」被短的「新竹」提前比對到漏了「市」
const CITY_ALIASES = [
  ['臺北市', '臺北市'], ['台北市', '臺北市'], ['臺北', '臺北市'], ['台北', '臺北市'],
  ['新北市', '新北市'], ['新北', '新北市'],
  ['桃園市', '桃園市'], ['桃園', '桃園市'],
  ['臺中市', '臺中市'], ['台中市', '臺中市'], ['臺中', '臺中市'], ['台中', '臺中市'],
  ['臺南市', '臺南市'], ['台南市', '臺南市'], ['臺南', '臺南市'], ['台南', '臺南市'],
  ['高雄市', '高雄市'], ['高雄', '高雄市'],
  ['基隆市', '基隆市'], ['基隆', '基隆市'],
  ['新竹市', '新竹市'], ['新竹縣', '新竹縣'], ['新竹', '新竹市'],
  ['苗栗縣', '苗栗縣'], ['苗栗', '苗栗縣'],
  ['彰化縣', '彰化縣'], ['彰化', '彰化縣'],
  ['南投縣', '南投縣'], ['南投', '南投縣'],
  ['雲林縣', '雲林縣'], ['雲林', '雲林縣'],
  ['嘉義市', '嘉義市'], ['嘉義縣', '嘉義縣'], ['嘉義', '嘉義市'],
  ['屏東縣', '屏東縣'], ['屏東', '屏東縣'],
  ['宜蘭縣', '宜蘭縣'], ['宜蘭', '宜蘭縣'],
  ['花蓮縣', '花蓮縣'], ['花蓮', '花蓮縣'],
  ['臺東縣', '臺東縣'], ['台東縣', '臺東縣'], ['臺東', '臺東縣'], ['台東', '臺東縣'],
  ['澎湖縣', '澎湖縣'], ['澎湖', '澎湖縣'],
  ['金門縣', '金門縣'], ['金門', '金門縣'],
  ['連江縣', '連江縣'], ['馬祖', '連江縣'],
].sort((a, b) => b[0].length - a[0].length);

// 從訊息裡找有沒有講到縣市名稱,回傳 CWA 格式的縣市名稱,沒講就回傳 null(交給呼叫端用預設值)
function extractCity(text) {
  for (const [alias, official] of CITY_ALIASES) {
    if (text.includes(alias)) return official;
  }
  return null;
}

// 「品項 金額」這種簡短記帳寫法,遇到下列字詞就不當成記帳(避免把時間、行程誤判成金額)
const NOT_EXPENSE_HINTS = /[點時:︰]|行程|天氣|明天|今天|後天|大後天|禮拜|星期|週|號|度|%|會議|提醒/;

// 把「1,2,3」「1 2 3」「1、2、3」這類字串轉成整數陣列
function parseIndexList(raw) {
  return raw
    .split(/[,、\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function getTaipeiNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function addDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + n);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function taipeiDateToISO({ year, month, day, hour, minute }) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+08:00`;
}

// 解析「今天/明天/後天/大後天/禮拜X/下禮拜X」,回傳 {year, month, day} 或 null
function parseDateOffset(text, now) {
  if (/大後天/.test(text)) return addDays(now, 3);
  if (/後天/.test(text)) return addDays(now, 2);
  if (/明天|明日/.test(text)) return addDays(now, 1);
  if (/今天|今日|今晚|今早/.test(text)) return addDays(now, 0);
  if (/前天/.test(text)) return addDays(now, -2);
  if (/昨天|昨日/.test(text)) return addDays(now, -1);

  const weekdayMatch = text.match(/(下)?(?:禮拜|週|星期)([一二三四五六日天])/);
  if (weekdayMatch) {
    const isNextWeek = !!weekdayMatch[1];
    const targetDow = WEEKDAY_MAP[weekdayMatch[2]];
    const nowDate = new Date(Date.UTC(now.year, now.month - 1, now.day));
    const currentDow = nowDate.getUTCDay();
    let diff = (targetDow - currentDow + 7) % 7;
    if (isNextWeek) diff += 7;
    return addDays(now, diff);
  }

  return null;
}

// 解析「上午/下午/晚上/凌晨 + X點(半)?」,回傳 {hour, minute} 或 null
function parseTimeOfDay(text) {
  const periodMatch = text.match(/(上午|中午|下午|晚上|凌晨|早上)/);
  const timeMatch = text.match(/(\d{1,2})[點:](\d{1,2})?(半)?/);
  if (!timeMatch) return null;

  let hour = Number(timeMatch[1]);
  const minute = timeMatch[3] ? 30 : timeMatch[2] ? Number(timeMatch[2]) : 0;

  const period = periodMatch ? periodMatch[1] : null;
  if (period === '下午' || period === '晚上') {
    if (hour < 12) hour += 12;
  } else if (period === '中午') {
    if (hour < 12) hour += 12;
  } else if (period === '凌晨') {
    if (hour === 12) hour = 0;
  }

  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

// 把句子裡的時間詞挖掉,回傳剩下的內容(可能是空字串)
function stripTimeWords(text) {
  return text
    .replace(/大後天|後天|明天|明日|今天|今日|今晚|今早/g, '')
    .replace(/(下)?(?:禮拜|週|星期)[一二三四五六日天]/g, '')
    .replace(/(上午|中午|下午|晚上|凌晨|早上)/g, '')
    .replace(/\d{1,2}[點:]\d{0,2}半?/g, '')
    .replace(/[,,、]/g, ' ')
    .replace(/^要|^跟|^去/, '')
    .trim();
}

// 從句子裡挖掉時間詞,剩下的當標題;整句都是時間詞時退回原句,避免標題空白
function extractTitle(text) {
  return (stripTimeWords(text) || text).slice(0, 100);
}

// 嘗試用規則解析出「新增行程」:日期詞跟時間詞都要偵測到,才有信心用規則直接解析
function tryParseAddEvent(text, now) {
  const dateOffset = parseDateOffset(text, now);
  const time = parseTimeOfDay(text);
  if (!dateOffset || !time) return null;

  const start = new Date(taipeiDateToISO({ ...dateOffset, hour: time.hour, minute: time.minute })).toISOString();
  const end = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();

  return { intent: 'add_event', title: extractTitle(text), start, end };
}

// 嘗試用關鍵字判斷「查天氣 / 查行程」
function tryParseQuery(text, now) {
  if (WEATHER_KEYWORDS.test(text)) {
    const dateParts = parseDateOffset(text, now);
    let dayOffset = 0;
    if (dateParts) {
      const nowUTC = Date.UTC(now.year, now.month - 1, now.day);
      const targetUTC = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day);
      dayOffset = Math.round((targetUTC - nowUTC) / 86400000);
    }
    return { intent: 'query_weather', dayOffset, location: extractCity(text) };
  }

  if (SCHEDULE_KEYWORDS.test(text)) {
    const dateParts = parseDateOffset(text, now);
    let dateOffset = 0;
    if (dateParts) {
      const nowUTC = Date.UTC(now.year, now.month - 1, now.day);
      const targetUTC = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day);
      dateOffset = Math.round((targetUTC - nowUTC) / 86400000);
    }

    let period = 'all';
    if (/上午|早上/.test(text)) period = 'morning';
    else if (/下午/.test(text)) period = 'afternoon';
    else if (/晚上/.test(text)) period = 'evening';

    let specificTime = null;
    if (/有沒有|有無|有嗎/.test(text)) {
      const time = parseTimeOfDay(text);
      if (time) {
        const base = dateParts || now;
        specificTime = new Date(taipeiDateToISO({ ...base, hour: time.hour, minute: time.minute })).toISOString();
      }
    }

    return { intent: 'query_schedule', dateOffset, period, specificTime };
  }

  return null;
}

// ── 筆記 ──

function tryParseNote(text) {
  // 刪除/完成要放在「新增筆記」之前判斷,不然會被 add 規則的寬鬆比對搶走
  // 支援兩種語序:「刪除第1則筆記」(數字在前)跟「刪除筆記 1」(數字在後)
  const deleteNote =
    text.match(/^(?:刪除|刪掉|移除)\s*(?:第)?\s*([\d,、\s]+)\s*則?\s*筆記/) ||
    text.match(/^(?:刪除|刪掉|移除)\s*筆記\s*(?:第)?\s*([\d,、\s]+)\s*則?/);
  if (deleteNote) {
    const indices = parseIndexList(deleteNote[1]);
    if (indices.length) return { intent: 'delete_note', indices };
  }

  const complete = text.match(/^(?:完成|做完|搞定)\s*(?:筆記|第)?\s*([\d,、\s]+)\s*則?/);
  if (complete) {
    const indices = parseIndexList(complete[1]);
    if (indices.length) return { intent: 'complete_note', indices };
  }

  const searchNote = text.match(/^(?:找|搜尋|查詢)筆記\s*[::]?\s*(.+)/) || text.match(/^筆記(?:找|搜尋|查詢)\s*[::]?\s*(.+)/);
  if (searchNote && searchNote[1].trim()) {
    return { intent: 'search_note', keyword: searchNote[1].trim().slice(0, 50) };
  }

  const add = text.match(/^(?:記一下|記得|備忘|筆記|記錄一下|提醒我)\s*[::]?\s*(.+)/);
  if (add && add[1].trim()) return { intent: 'add_note', content: add[1].trim().slice(0, 200) };

  if (/有什麼要記|我的筆記|備忘錄|記了什麼|筆記清單|待辦清單|看筆記/.test(text)) {
    return { intent: 'query_notes' };
  }

  return null;
}

// ── 記憶(教機器人記住固定事實/偏好,用「記住」跟筆記用的「記得/記一下」區分)──

function tryParseMemory(text) {
  const del = text.match(/^(?:刪除|刪掉|移除)\s*記憶\s*(?:第)?\s*([\d,、\s]+)\s*則?/);
  if (del) {
    const indices = parseIndexList(del[1]);
    if (indices.length) return { intent: 'delete_memory', indices };
  }

  if (/我的記憶|查看記憶|記憶清單|記憶列表|你記得什麼/.test(text)) {
    return { intent: 'query_memory' };
  }

  const add = text.match(/^(?:請)?(?:幫我)?記住\s*[::]?\s*(.+)/);
  if (add && add[1].trim()) return { intent: 'add_memory', content: add[1].trim().slice(0, 200) };

  return null;
}

// ── 記帳 ──

// 月度比較要排在一般查詢前面(兩者都含「花多少」)
function tryParseExpenseCompare(text) {
  if (/比上(?:個)?月|跟上(?:個)?月|上月比較|比上個月/.test(text)) {
    return { intent: 'query_expense_compare' };
  }
  return null;
}

// 從句子裡判斷要查哪個月份,回傳 'YYYY-MM';沒指定則回傳 null(代表本月)
function parseTargetMonth(text, now) {
  const pad = (n) => String(n).padStart(2, '0');

  if (/上(?:個)?月/.test(text)) {
    return now.month === 1 ? `${now.year - 1}-12` : `${now.year}-${pad(now.month - 1)}`;
  }

  const explicit = text.match(/(\d{1,2})\s*月/);
  if (explicit) {
    const m = Number(explicit[1]);
    if (m >= 1 && m <= 12) {
      // 指定的月份還沒到,視為去年的那個月(例如 8 月時問「12月花多少」)
      const year = m > now.month ? now.year - 1 : now.year;
      return `${year}-${pad(m)}`;
    }
  }

  return null;
}

function tryParseExpenseQuery(text, now) {
  if (/花了多少|花多少|支出|花費|記帳統計|開銷/.test(text) && !/^\s*(?:記帳|花費|支出)\s*\S+\s*\d+/.test(text)) {
    return { intent: 'query_expense', yearMonth: parseTargetMonth(text, now) };
  }
  return null;
}

// 算出「m/d 這個日期」對應的西元年(還沒到就當去年),回傳 'YYYY-MM-DD'
function resolveYearForDate(month, day, now) {
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${now.year}-${pad(now.month)}-${pad(now.day)}`;
  let dateStr = `${now.year}-${pad(month)}-${pad(day)}`;
  if (dateStr > todayStr) dateStr = `${now.year - 1}-${pad(month)}-${pad(day)}`;
  return dateStr;
}

// 單日/區間記帳查詢:「今天花多少」「昨天花多少」「8月20日花多少」「8/1到8/15花多少」
// 要放在 tryParseExpenseQuery 前面判斷,不然「8月20日花多少」裡的「8月」會先被當成整月查詢搶走
function tryParseExpenseDateQuery(text, now) {
  if (!/花了多少|花多少|花費|消費|支出/.test(text)) return null;

  // 區間:「8/1到8/15」「8月1號到8月15號」「8/1~8/15」
  const range = text.match(/(\d{1,2})[\/月]\s*(\d{1,2})\s*[日號]?\s*(?:到|至|[~-])\s*(\d{1,2})[\/月]\s*(\d{1,2})\s*[日號]?/);
  if (range) {
    const [m1, d1, m2, d2] = range.slice(1).map(Number);
    if (m1 >= 1 && m1 <= 12 && m2 >= 1 && m2 <= 12 && d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) {
      const startDate = resolveYearForDate(m1, d1, now);
      const startYear = Number(startDate.slice(0, 4));
      const endYearBumped = m2 < m1 || (m2 === m1 && d2 < d1) ? startYear + 1 : startYear;
      const pad = (n) => String(n).padStart(2, '0');
      const endDate = `${endYearBumped}-${pad(m2)}-${pad(d2)}`;
      return { intent: 'query_expense_range', startDate, endDate, label: `${m1}/${d1} - ${m2}/${d2}` };
    }
  }

  // 相對日期:今天/昨天/前天/明天...
  const dateParts = parseDateOffset(text, now);
  if (dateParts) {
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${dateParts.year}-${pad(dateParts.month)}-${pad(dateParts.day)}`;
    return { intent: 'query_expense_range', startDate: dateStr, endDate: dateStr, label: dateStr };
  }

  // 特定單一日期:「8月20日花多少」「8/20花多少」
  const single = text.match(/(\d{1,2})[\/月]\s*(\d{1,2})\s*[日號]?/);
  if (single) {
    const [m, d] = single.slice(1).map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dateStr = resolveYearForDate(m, d, now);
      return { intent: 'query_expense_range', startDate: dateStr, endDate: dateStr, label: dateStr };
    }
  }

  return null;
}

// 搜尋記帳歷史(要放在 tryParseExpenseQuery 前面判斷,避免被「花多少」搶走)
function tryParseExpenseSearch(text) {
  const m = text.match(/^(?:找|搜尋|查詢)記帳\s*[::]?\s*(.+)/) || text.match(/^記帳(?:找|搜尋|查詢)\s*[::]?\s*(.+)/);
  if (m && m[1].trim()) return { intent: 'search_expense', keyword: m[1].trim().slice(0, 50) };
  return null;
}

// 查剩餘預算(要放在記帳統計判斷附近,「預算」不會跟「花多少」等關鍵字衝突)
function tryParseBudget(text) {
  if (/^(剩餘預算|預算查詢|預算|查預算|還有多少錢可以花|還剩多少錢)$/.test(text)) {
    return { intent: 'query_budget' };
  }
  return null;
}

// 查這個月存了多少(存款是獨立一張表,不算進「這個月花多少」)
function tryParseSavingsQuery(text) {
  if (/存了多少|存款統計|存多少|本月存款/.test(text)) {
    return { intent: 'query_savings' };
  }
  return null;
}

// 對帳:把支出/分類/預算/存款整合成一張卡片
function tryParseReconcile(text) {
  if (/^(對帳|財務對帳|財務總覽|收支總覽)$/.test(text)) {
    return { intent: 'reconcile' };
  }
  return null;
}

// 設定分類的月預算:「設定預算 房租 3000」。類別文字直接丟給 classify() 正規化,
// 打錯字/寫法不同也會落到固定分類上,不會多開一個新分類
function tryParseSetBudget(text) {
  const m = text.match(/^(?:設定預算|預算設定|設預算)\s*(.+?)\s*(\d{1,7})\s*(?:元|塊)?$/);
  if (!m) return null;
  return { intent: 'set_budget', categoryText: m[1].trim(), amount: Number(m[2]) };
}

// 薪水入帳後一次分配到多個項目:「薪水32000 扣3000房租 扣2000水電 扣5000存款」
// 「存款/儲蓄/存錢/定存」歸類成存款(不算支出),其餘歸類成一般支出
function tryParseAllocation(text) {
  if (!/^(?:薪水|收入|入帳)/.test(text)) return null;
  const matches = [...text.matchAll(/扣\s*(\d{1,7})\s*(?:元|塊)?\s*([^\s\d,、]{1,12})/g)];
  if (!matches.length) return null;

  const expenses = [];
  const savings = [];
  for (const m of matches) {
    const amount = Number(m[1]);
    const item = m[2].trim();
    if (!item || !amount) continue;
    if (/存款|儲蓄|存錢|定存/.test(item)) {
      savings.push({ item, amount });
    } else {
      expenses.push({ item, amount });
    }
  }
  if (!expenses.length && !savings.length) return null;

  return { intent: 'add_allocation', expenses, savings };
}

// 陳述式帳戶餘額校正:「現金是488」「現金現在是488」——要放在記帳規則前面判斷,
// 不然「XX是NNN」會被 tryParseExpenseImplicit 誤判成「品項=XX是,金額=NNN」的支出。
// strict:true 表示比對不到真正的帳戶就不亂建帳戶,回覆請使用者確認,而不是靜默記錯
function tryParseAccountBalanceStatement(text) {
  const m = text.match(/^(.{1,10}?)(?:現在)?是\s*(\d{1,9})\s*(?:元|塊)?$/);
  if (!m) return null;
  return { intent: 'set_account_balance', name: m[1].trim(), balance: Number(m[2]), strict: true };
}

// ── 帳戶 / 轉帳 ──

// 轉帳:「我從錢袋拿1000放現金」「從錢袋轉1000到現金」「錢袋轉帳1000給現金」
// fromText/toText 是不是真的帳戶名稱,交給 handler 用當下的帳戶清單驗證
function tryParseTransfer(text) {
  const m = text.match(
    /^(?:我)?(?:從)?(.{1,10}?)(?:拿|轉帳|轉|挪)\s*(\d{1,7})\s*(?:元|塊)?(?:放到|放|轉到|存到|轉入|給|到)\s*(.{1,10})$/
  );
  if (!m) return null;
  const fromText = m[1].trim();
  const amount = Number(m[2]);
  const toText = m[3].trim();
  if (!fromText || !toText || !amount) return null;
  return { intent: 'transfer', fromText, toText, amount };
}

// 新增帳戶:「新增帳戶 錢包」「新增帳戶 錢包 500」(500 是起始餘額,不寫就是 0)
function tryParseAddAccount(text) {
  const m = text.match(/^(?:新增|建立)帳戶\s*(.{1,10}?)(?:\s+(\d{1,9}))?$/);
  if (!m || !m[1].trim()) return null;
  return { intent: 'add_account', name: m[1].trim(), startBalance: m[2] ? Number(m[2]) : 0 };
}

// 移除帳戶:「移除帳戶 錢包」「刪除帳戶 錢包」
function tryParseRemoveAccount(text) {
  const m = text.match(/^(?:移除|刪除|刪掉)帳戶\s*(.{1,10})$/);
  if (!m || !m[1].trim()) return null;
  return { intent: 'remove_account', name: m[1].trim() };
}

// 校正帳戶餘額(跟現實金額對不上時強制同步):「設定帳戶 現金 500」
function tryParseSetAccountBalance(text) {
  const m = text.match(/^設定帳戶\s*(.{1,10}?)\s*(\d{1,9})$/);
  if (!m) return null;
  return { intent: 'set_account_balance', name: m[1].trim(), balance: Number(m[2]) };
}

// 查所有帳戶餘額:「帳戶餘額」「查帳戶」
function tryParseAccountBalanceQuery(text) {
  if (/^(帳戶餘額|查帳戶|帳戶查詢|所有帳戶|淨資產)$/.test(text)) {
    return { intent: 'query_accounts' };
  }
  return null;
}

// 設定帳戶目標(存款目標之類):「設定目標 存款 50000」「存款目標 50000」
function tryParseSetAccountGoal(text) {
  const m =
    text.match(/^設定目標\s*(.{1,10}?)\s*(\d{1,9})$/) || text.match(/^(.{1,10}?)目標\s*(\d{1,9})$/);
  if (!m) return null;
  return { intent: 'set_account_goal', name: m[1].trim(), goal: Number(m[2]) };
}

// 某個帳戶的異動明細:「現金明細」「錢袋明細」
function tryParseAccountLedger(text) {
  const m = text.match(/^(.{1,10}?)明細$/);
  if (!m || !m[1].trim()) return null;
  return { intent: 'account_ledger', accountText: m[1].trim() };
}

// 全部轉帳紀錄(不限帳戶):「查轉帳」「轉帳紀錄」「轉帳明細」
function tryParseTransferHistory(text) {
  if (/^(查轉帳|轉帳紀錄|轉帳明細|轉帳查詢)$/.test(text)) {
    return { intent: 'query_transfers' };
  }
  return null;
}

// 教分類關鍵字:「星巴克算學習工作」——類別文字丟給 classify() 正規化,
// 只能對應到既有的固定分類,不會憑空生出新分類。
// 「算」是日常對話也會用到的字(這樣算貴、不划算…),所以這裡先用同步版的
// classify() 檢查類別文字是不是真的對應到某個固定分類,對不到就直接放棄比對、
// 讓這句話繼續往下走其他規則或 Claude,而不是把閒聊誤判成教學指令
function tryParseTeachCategory(text) {
  const m = text.match(/^(.{1,15}?)算(.{1,10})$/);
  if (!m) return null;
  const keyword = m[1].trim();
  const categoryText = m[2].trim();
  if (!keyword || !categoryText) return null;
  if (classify(categoryText) === DEFAULT_CATEGORY) return null;
  return { intent: 'teach_category', keyword, categoryText };
}

// 一週天氣:「這週天氣」「一週天氣」「未來天氣」
function tryParseWeeklyWeather(text) {
  if (/這週天氣|一週天氣|未來天氣|七天天氣|一週預報/.test(text)) {
    return { intent: 'query_weekly_weather', location: extractCity(text) };
  }
  return null;
}

// 刪除/修正最後一筆記帳
function tryParseExpenseFix(text) {
  if (/^(?:刪掉|刪除|取消)\s*(?:剛剛|剛才|最後|上)(?:那|一)?筆/.test(text)) {
    return { intent: 'delete_last_expense' };
  }

  // 金額後面可以再接一句備註,例如「改成70 然後備注全家涼麵」
  const amend = text.match(new RegExp(`^(?:改成|改為|更正為|應該是)\\s*(\\d{1,7})\\s*(?:元|塊)?(?:\\s*然後)?${NOTE_CLAUSE}$`));
  if (amend) {
    return { intent: 'update_last_expense', amount: Number(amend[1]), note: amend[2] ? amend[2].trim().slice(0, 50) : null };
  }

  return null;
}

// 一次記多筆:「早餐50 午餐120 晚餐200」
function tryParseMultiExpense(text) {
  if (NOT_EXPENSE_HINTS.test(text)) return null;

  const body = text.replace(/^(?:記帳|花費|支出)\s*[::]?\s*/, '');
  const pairs = [...body.matchAll(/([^\s\d]{1,12}?)\s*(\d{1,7})\s*(?:元|塊)?(?=\s|$)/g)];
  if (pairs.length < 2) return null;

  // 確認整句幾乎都被這些「品項+金額」組合吃掉,避免把一般句子誤判成記帳
  const consumed = pairs.reduce((n, p) => n + p[0].trim().length, 0);
  if (consumed < body.replace(/\s/g, '').length * 0.8) return null;

  const entries = pairs.map((p) => ({ item: p[1].trim().slice(0, 50), amount: Number(p[2]) }));
  if (entries.some((e) => !e.item || !e.amount)) return null;

  return { intent: 'add_expenses', entries };
}

// 備註子句:「... 備註正宗排骨飯」放在品項後面,補充是花在哪(方便之後用「找記帳」查回來)
const NOTE_CLAUSE = '(?:\\s*(?:備註|備注|註記)\\s*[::]?\\s*(.{1,50}))?';

// 帳戶子句:「... 現金」放在金額後面(備註之前),是不是真的帳戶名稱交給 handler
// 用當下的帳戶清單驗證,ruleParser 這裡只負責抓出候選文字,維持同步、不查表
const ACCOUNT_CLAUSE = '(?:\\s+([^\\s,、]{1,6}))?';

function withNote(item, note) {
  const cleanItem = item.trim().slice(0, 50);
  const cleanNote = note ? note.trim().slice(0, 50) : '';
  return cleanNote ? `${cleanItem}・${cleanNote}` : cleanItem;
}

// 明確寫法:「記帳 午餐 120」,可加帳戶跟「備註」補充細節:「記帳 午餐 120 現金 備註全家涼麵」
function tryParseExpenseExplicit(text) {
  const m = text.match(
    new RegExp(`^(?:記帳|花費|支出)\\s*[::]?\\s*(.+?)\\s*(\\d{1,7})\\s*(?:元|塊)?${ACCOUNT_CLAUSE}${NOTE_CLAUSE}$`)
  );
  if (!m) return null;
  return { intent: 'add_expense', item: withNote(m[1], m[4]), amount: Number(m[2]), accountText: m[3] || null };
}

// 簡短寫法:「午餐 120」— 放在最後判斷,並排除看起來像時間/行程的句子
// 可加帳戶跟「備註」補充細節:「午餐120 現金 備註全家涼麵」,不寫帳戶就交給 handler 預設現金
function tryParseExpenseImplicit(text) {
  if (NOT_EXPENSE_HINTS.test(text)) return null;
  const m = text.match(new RegExp(`^(.{1,12}?)\\s*(\\d{1,7})\\s*(?:元|塊)?${ACCOUNT_CLAUSE}${NOTE_CLAUSE}$`));
  if (!m) return null;
  const item = m[1].trim();
  if (!item) return null;
  return { intent: 'add_expense', item: withNote(item, m[4]), amount: Number(m[2]), accountText: m[3] || null };
}

// ── 指令說明 ──

function tryParseHelp(text) {
  if (/^(指令|說明|help|幫助|功能|選單|你會什麼|能做什麼|使用說明)$/i.test(text)) {
    return { intent: 'help' };
  }
  return null;
}

// ── 查空檔 ──

function tryParseFreeSlots(text, now) {
  if (!/有空|空檔|空堂|有沒有時間|哪天有空|哪個時段/.test(text)) return null;

  let period = 'all';
  if (/上午|早上/.test(text)) period = 'morning';
  else if (/下午/.test(text)) period = 'afternoon';
  else if (/晚上/.test(text)) period = 'evening';

  // 「這週哪天有空」→ 查一整週;有指定某天則只查那天
  const isWeek = /(這|本|下)(?:週|周|禮拜|星期)/.test(text) && !/(?:週|周|禮拜|星期)[一二三四五六日天]/.test(text);
  if (isWeek) {
    const isNextWeek = /^下|下(?:週|周|禮拜|星期)/.test(text);
    return { intent: 'query_free_slots', dayOffset: isNextWeek ? 7 : 0, days: 7, period };
  }

  const dateParts = parseDateOffset(text, now);
  let dayOffset = 0;
  if (dateParts) {
    const nowUTC = Date.UTC(now.year, now.month - 1, now.day);
    const targetUTC = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day);
    dayOffset = Math.round((targetUTC - nowUTC) / 86400000);
  }
  return { intent: 'query_free_slots', dayOffset, days: 1, period };
}

// ── 改期 ──

function tryParseReschedule(text, now) {
  const m = text.match(/^(?:把|將)?(.+?)(?:改|延|挪|移)(?:期)?到(.+)$/);
  if (!m) return null;

  const sourceRaw = m[1].replace(/的?(行程|活動|會議|事情|安排)$/, '').trim();
  const targetRaw = m[2].trim();
  if (!sourceRaw || !targetRaw) return null;

  // 目標時間:至少要有日期或時間其中之一,否則無法改期
  const targetDate = parseDateOffset(targetRaw, now);
  const targetTime = parseTimeOfDay(targetRaw);
  if (!targetDate && !targetTime) return null;

  // 來源:用日期或關鍵字定位要改哪一筆
  const sourceDate = parseDateOffset(sourceRaw, now);
  const sourceKeyword = stripTimeWords(sourceRaw);

  let sourceDayOffset = null;
  if (sourceDate) {
    const nowUTC = Date.UTC(now.year, now.month - 1, now.day);
    const targetUTC = Date.UTC(sourceDate.year, sourceDate.month - 1, sourceDate.day);
    sourceDayOffset = Math.round((targetUTC - nowUTC) / 86400000);
  }

  let newDayOffset = null;
  if (targetDate) {
    const nowUTC = Date.UTC(now.year, now.month - 1, now.day);
    const tUTC = Date.UTC(targetDate.year, targetDate.month - 1, targetDate.day);
    newDayOffset = Math.round((tUTC - nowUTC) / 86400000);
  }

  return {
    intent: 'reschedule_event',
    sourceDayOffset,
    sourceKeyword: sourceKeyword || null,
    sourceTime: parseTimeOfDay(sourceRaw)
      ? new Date(
          taipeiDateToISO({
            ...(sourceDate || now),
            hour: parseTimeOfDay(sourceRaw).hour,
            minute: parseTimeOfDay(sourceRaw).minute,
          })
        ).toISOString()
      : null,
    newDayOffset,
    newHour: targetTime ? targetTime.hour : null,
    newMinute: targetTime ? targetTime.minute : null,
  };
}

// 改標題:例「更改 屏科大活動 改成 屏科大活動企劃」「把牙醫改名為牙醫回診」
// 用「改成/改為/改名為/改名成」跟改期(用「到」)區分,避免互相誤判
function tryParseRenameEvent(text) {
  const m = text.match(/^(?:更改|修改|把|將)?(.+?)(?:的)?(?:標題|名稱)?改(?:成|為|名為|名成)(.+)$/);
  if (!m) return null;

  const sourceKeyword = m[1].trim().replace(/(的)?(行程|活動|會議|事情|安排)$/, '').trim();
  const newTitle = m[2].trim();
  if (!sourceKeyword || !newTitle) return null;

  return { intent: 'rename_event', sourceKeyword, newTitle };
}

// ── 循環行程 ──

function tryParseRecurring(text, now) {
  const time = parseTimeOfDay(text);
  if (!time) return null;

  const RRULE_WEEKDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  // 每週三 / 每禮拜三
  const weekly = text.match(/每(?:週|周|禮拜|星期)([一二三四五六日天])/);
  if (weekly) {
    const dow = WEEKDAY_MAP[weekly[1]];
    const nowDate = new Date(Date.UTC(now.year, now.month - 1, now.day));
    const diff = (dow - nowDate.getUTCDay() + 7) % 7;
    const first = addDays(now, diff);
    return {
      intent: 'add_recurring_event',
      title: extractTitle(text.replace(/每(?:週|周|禮拜|星期)[一二三四五六日天]/g, '')),
      firstStart: new Date(taipeiDateToISO({ ...first, hour: time.hour, minute: time.minute })).toISOString(),
      recurrence: `RRULE:FREQ=WEEKLY;BYDAY=${RRULE_WEEKDAY[dow]}`,
      description: `每週${weekly[1]}`,
    };
  }

  // 每天
  if (/每天|每日/.test(text)) {
    return {
      intent: 'add_recurring_event',
      title: extractTitle(text.replace(/每天|每日/g, '')),
      firstStart: new Date(taipeiDateToISO({ ...now, hour: time.hour, minute: time.minute })).toISOString(),
      recurrence: 'RRULE:FREQ=DAILY',
      description: '每天',
    };
  }

  // 每月 X 號
  const monthly = text.match(/每(?:個)?月\s*(\d{1,2})\s*號/);
  if (monthly) {
    const day = Number(monthly[1]);
    if (day >= 1 && day <= 31) {
      const first = day >= now.day ? { ...now, day } : addDays({ ...now, day: 1 }, 31);
      return {
        intent: 'add_recurring_event',
        title: extractTitle(text.replace(/每(?:個)?月\s*\d{1,2}\s*號/g, '')),
        firstStart: new Date(
          taipeiDateToISO({ ...first, day, hour: time.hour, minute: time.minute })
        ).toISOString(),
        recurrence: `RRULE:FREQ=MONTHLY;BYMONTHDAY=${day}`,
        description: `每月 ${day} 號`,
      };
    }
  }

  return null;
}

// ── 行程:刪除 / 搜尋 / 整週 / 今日總覽 ──

function tryParseDeleteEvent(text, now) {
  const m = text.match(/^(?:取消|刪除|刪掉|移除)\s*(?:掉)?\s*(.+)/);
  if (!m) return null;

  const body = m[1].replace(/的?(行程|活動|會議|事情|安排)$/, '').trim();
  if (!body) return null;

  // 若句子裡帶有日期(例如「取消明天下午3點的會議」),用日期定位比關鍵字搜尋準確
  const dateParts = parseDateOffset(body, now);
  const time = parseTimeOfDay(body);
  const keyword = stripTimeWords(body); // 刪除情境允許為空(代表只用日期/時間定位)

  if (dateParts) {
    const nowUTC = Date.UTC(now.year, now.month - 1, now.day);
    const targetUTC = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day);
    return {
      intent: 'delete_event',
      dateOffset: Math.round((targetUTC - nowUTC) / 86400000),
      targetTime: time
        ? new Date(taipeiDateToISO({ ...dateParts, hour: time.hour, minute: time.minute })).toISOString()
        : null,
      keyword: keyword || null,
    };
  }

  return { intent: 'delete_event', dateOffset: null, targetTime: null, keyword: body.slice(0, 50) };
}

function tryParseSearchEvent(text) {
  const whenMatch = text.match(/^(.+?)\s*(?:是)?(?:什麼時候|何時|在哪天)/);
  if (whenMatch && whenMatch[1].trim()) {
    return { intent: 'search_event', keyword: whenMatch[1].trim().slice(0, 50) };
  }

  const findMatch = text.match(/^(?:找|搜尋|查詢)\s*[::]?\s*(.+)/);
  if (findMatch && findMatch[1].trim()) {
    const keyword = findMatch[1].replace(/的?(行程|活動|紀錄)$/, '').trim();
    if (keyword) return { intent: 'search_event', keyword: keyword.slice(0, 50) };
  }

  return null;
}

function tryParseOverview(text) {
  if (/今天狀況|今日總覽|今天總覽|今日概況|今天如何|今天怎樣|今日狀況|總覽/.test(text)) {
    return { intent: 'query_overview' };
  }
  return null;
}

function tryParseWeek(text) {
  if (/(這|本|下)(?:週|周|禮拜|星期)/.test(text) && /行程|安排|事情|待辦|有什麼/.test(text)) {
    // 「下週」從 7 天後起算,「這週」從今天起算
    const isNextWeek = /^下|下(?:週|周|禮拜|星期)/.test(text);
    return { intent: 'query_week', dayOffset: isNextWeek ? 7 : 0, days: 7 };
  }
  return null;
}

// 主入口:回傳解析結果物件,或 null(代表規則判斷不出來,交給 Claude fallback)
// 順序由「明確」到「模糊」,避免短句被前面的規則誤判
function parseWithRules(text) {
  const now = getTaipeiNow();
  const trimmed = text.trim();

  return (
    tryParseHelp(trimmed) ||
    tryParseNote(trimmed) ||
    tryParseMemory(trimmed) ||
    tryParseExpenseFix(trimmed) ||
    tryParseExpenseSearch(trimmed) ||
    tryParseBudget(trimmed) ||
    tryParseSavingsQuery(trimmed) ||
    tryParseReconcile(trimmed) ||
    tryParseSetBudget(trimmed) ||
    tryParseAddAccount(trimmed) ||
    tryParseRemoveAccount(trimmed) ||
    tryParseSetAccountBalance(trimmed) ||
    tryParseAccountBalanceStatement(trimmed) ||
    tryParseSetAccountGoal(trimmed) ||
    tryParseAccountBalanceQuery(trimmed) ||
    tryParseAccountLedger(trimmed) ||
    tryParseTransferHistory(trimmed) ||
    tryParseTransfer(trimmed) ||
    tryParseAllocation(trimmed) ||
    tryParseExpenseCompare(trimmed) ||
    tryParseExpenseDateQuery(trimmed, now) ||
    tryParseExpenseQuery(trimmed, now) ||
    tryParseExpenseExplicit(trimmed) ||
    tryParseWeeklyWeather(trimmed) ||
    tryParseFreeSlots(trimmed, now) ||
    tryParseReschedule(trimmed, now) ||
    tryParseRenameEvent(trimmed) ||
    tryParseDeleteEvent(trimmed, now) ||
    tryParseOverview(trimmed) ||
    tryParseWeek(trimmed) ||
    tryParseQuery(trimmed, now) ||
    tryParseRecurring(trimmed, now) ||
    tryParseSearchEvent(trimmed) ||
    tryParseAddEvent(trimmed, now) ||
    tryParseTeachCategory(trimmed) ||
    tryParseMultiExpense(trimmed) ||
    tryParseExpenseImplicit(trimmed)
  );
}

module.exports = { parseWithRules, extractCity };
