// Claude fallback:只有規則解析器判斷不出來時才會呼叫,頻率很低
const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = `你是一位個人秘書機器人,負責判斷使用者傳來的訊息屬於哪一種意圖,只輸出一個 JSON 物件,不要有其他文字、不要加 markdown code fence。

意圖只能是以下其中一種:
- "add_event": 想新增一筆行程/待辦(訊息裡有明確或可換算的時間)
- "delete_event": 想取消/刪除某筆行程
- "search_event": 想搜尋某個行程何時發生(例如「牙醫什麼時候」)
- "query_weather": 在問天氣
- "query_schedule": 在問某一天的行程
- "query_week": 在問整週的行程
- "query_overview": 想一次看今天的天氣加行程總覽
- "query_free_slots": 在問哪些時段有空(例如「這週哪天有空」)
- "help": 想知道這個機器人能做什麼
- "add_expense": 想記一筆支出(有品項與金額)
- "update_last_expense": 想修改最後一筆記帳的金額和/或加上備註(例如「把剛剛午餐的金額改成70,備註全家涼麵」)
- "delete_last_expense": 想刪除最後一筆記帳
- "query_expense": 在問這個月/上個月/某月花了多少錢
- "query_expense_range": 在問某一天或某個日期區間花了多少錢(例如「今天花多少」「8/1到8/15花多少」)
- "query_budget": 在問還剩多少預算/錢可以花
- "set_budget": 想設定/修改某個分類的月預算(例如「設定預算 房租 3000」)
- "query_savings": 在問這個月存了多少錢
- "reconcile": 想看整合的財務總覽/對帳(支出+分類+預算+存款)
- "add_allocation": 薪水入帳後一次分配到多個項目,同時有支出跟存款(例如「薪水32000 扣3000房租 扣5000存款」)
- "add_note": 想記一則不綁時間的筆記/備忘
- "query_notes": 想看目前的待辦筆記
- "complete_note": 想把某幾則筆記標記為完成
- "delete_note": 想整筆刪除某幾則筆記(不是標記完成)
- "search_note": 想搜尋筆記(例如「找筆記 隨身碟」)
- "search_expense": 想搜尋記帳歷史(例如「找記帳 隨身碟」)
- "chitchat": 以上皆非(閒聊、問候,或訊息不足以判斷)

輸出格式(只填該意圖需要的欄位,其餘省略):
{
  "intent": "上面其中一個",
  "title": "add_event:行程標題,簡潔、去除時間詞",
  "startTime": "add_event:ISO 8601 時間字串,含時區",
  "endTime": "add_event:ISO 8601 時間字串",
  "keyword": "delete_event / search_event / search_note / search_expense:要比對的關鍵字",
  "dateOffset": "query_schedule / delete_event:整數,0=今天,1=明天,以此類推",
  "period": "query_schedule:all / morning / afternoon / evening",
  "specificTime": "query_schedule 問特定時間點時:ISO 8601 時間字串,否則 null",
  "dayOffset": "query_week:0=這週,7=下週",
  "days": "query_week:通常填 7",
  "item": "add_expense:支出品項,如果使用者有額外備註/說明,用「品項・備註」的格式合併成一個字串",
  "amount": "add_expense / set_budget:金額,純數字。update_last_expense:新金額,沒提到要改金額就填 null",
  "note": "update_last_expense:要加上的備註文字,沒提到就填 null",
  "categoryText": "set_budget:分類文字(不用是精確分類名稱,系統會自動正規化)",
  "startDate": "query_expense_range:ISO 日期字串 YYYY-MM-DD",
  "endDate": "query_expense_range:ISO 日期字串 YYYY-MM-DD,單日查詢就跟 startDate 相同",
  "expenses": "add_allocation:支出項目陣列,每個是 {item, amount}",
  "savings": "add_allocation:存款項目陣列,每個是 {item, amount}",
  "content": "add_note:筆記內容",
  "indices": "complete_note / delete_note:第幾則的整數陣列,例如 [1] 或 [1,2]",
  "reason": "chitchat:簡短說明為什麼判斷成閒聊"
}

規則:
- add_event:若只提到日期沒提到明確時間,開始時間預設當天 09:00;沒說結束時間,endTime 填開始時間 + 1 小時
- query_schedule:沒提到上午/下午/晚上就填 "all";沒問特定時間點 specificTime 填 null;沒提到哪一天 dateOffset 填 0
- delete_event:若使用者是用日期指定(例如「取消明天的會議」),填 dateOffset;若是用名稱指定,填 keyword
- 直接輸出 JSON 物件本身,不要加任何說明文字或 \`\`\``;

function extractJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '');
  return JSON.parse(cleaned);
}

// 解析一則規則判斷不出來的訊息,回傳跟 ruleParser 一致形狀的物件
async function parseWithClaude(text) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 ANTHROPIC_API_KEY,請至 .env 設定 Claude API 金鑰。');
  }

  const client = new Anthropic({ apiKey });
  const nowStr = new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'long',
  });

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `現在時間:${nowStr}(台灣時區 UTC+8)\n使用者訊息:「${text}」` }],
  });

  const rawText = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let parsed;
  try {
    parsed = extractJson(rawText);
  } catch (err) {
    console.error('[claudeService] JSON 解析失敗,原始內容:', rawText);
    return { intent: 'chitchat', reason: 'AI 解析失敗,請換個說法試試' };
  }

  if (parsed.intent === 'add_event') {
    if (!parsed.startTime) return { intent: 'chitchat', reason: '沒有偵測到明確時間' };
    const start = new Date(parsed.startTime);
    if (Number.isNaN(start.getTime())) return { intent: 'chitchat', reason: '時間格式無法辨識' };

    let end = parsed.endTime ? new Date(parsed.endTime) : null;
    if (!end || Number.isNaN(end.getTime()) || end <= start) {
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }

    return {
      intent: 'add_event',
      title: String(parsed.title || text).slice(0, 100),
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }

  if (['query_weather', 'query_overview', 'query_expense', 'query_budget', 'reconcile', 'help'].includes(parsed.intent)) {
    return { intent: parsed.intent };
  }

  if (parsed.intent === 'query_free_slots') {
    return {
      intent: 'query_free_slots',
      dayOffset: Number.isInteger(parsed.dayOffset) ? parsed.dayOffset : 0,
      days: Number.isInteger(parsed.days) && parsed.days > 0 ? Math.min(parsed.days, 14) : 1,
      period: ['morning', 'afternoon', 'evening', 'all'].includes(parsed.period) ? parsed.period : 'all',
    };
  }

  if (parsed.intent === 'query_notes') {
    return { intent: 'query_notes' };
  }

  if (parsed.intent === 'query_schedule') {
    const dateOffset = Number.isInteger(parsed.dateOffset) ? parsed.dateOffset : 0;
    const period = ['morning', 'afternoon', 'evening', 'all'].includes(parsed.period) ? parsed.period : 'all';
    let specificTime = null;
    if (parsed.specificTime) {
      const t = new Date(parsed.specificTime);
      if (!Number.isNaN(t.getTime())) specificTime = t.toISOString();
    }
    return { intent: 'query_schedule', dateOffset, period, specificTime };
  }

  if (parsed.intent === 'query_week') {
    return {
      intent: 'query_week',
      dayOffset: Number.isInteger(parsed.dayOffset) ? parsed.dayOffset : 0,
      days: Number.isInteger(parsed.days) && parsed.days > 0 ? Math.min(parsed.days, 31) : 7,
    };
  }

  if (parsed.intent === 'delete_event') {
    const keyword = parsed.keyword ? String(parsed.keyword).slice(0, 50) : null;
    const dateOffset = Number.isInteger(parsed.dateOffset) ? parsed.dateOffset : null;
    if (!keyword && dateOffset === null) {
      return { intent: 'chitchat', reason: '沒有指明要取消哪一筆行程' };
    }
    let targetTime = null;
    if (parsed.specificTime) {
      const t = new Date(parsed.specificTime);
      if (!Number.isNaN(t.getTime())) targetTime = t.toISOString();
    }
    return { intent: 'delete_event', keyword, dateOffset, targetTime };
  }

  if (parsed.intent === 'search_event') {
    if (!parsed.keyword) return { intent: 'chitchat', reason: '沒有指明要搜尋什麼' };
    return { intent: 'search_event', keyword: String(parsed.keyword).slice(0, 50) };
  }

  if (parsed.intent === 'add_expense') {
    const amount = Number(parsed.amount);
    if (!parsed.item || !Number.isFinite(amount) || amount <= 0) {
      return { intent: 'chitchat', reason: '沒有辨識出品項或金額' };
    }
    return { intent: 'add_expense', item: String(parsed.item).slice(0, 50), amount };
  }

  if (parsed.intent === 'delete_last_expense') {
    return { intent: 'delete_last_expense' };
  }

  if (parsed.intent === 'update_last_expense') {
    const amount = parsed.amount !== null && parsed.amount !== undefined ? Number(parsed.amount) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
      return { intent: 'chitchat', reason: '金額格式無法辨識' };
    }
    const note = parsed.note ? String(parsed.note).slice(0, 50) : null;
    if (amount === null && !note) {
      return { intent: 'chitchat', reason: '沒有辨識出要改金額還是備註' };
    }
    return { intent: 'update_last_expense', amount, note };
  }

  if (parsed.intent === 'add_note') {
    if (!parsed.content) return { intent: 'chitchat', reason: '沒有辨識出要記的內容' };
    return { intent: 'add_note', content: String(parsed.content).slice(0, 200) };
  }

  if (parsed.intent === 'complete_note' || parsed.intent === 'delete_note') {
    const indices = Array.isArray(parsed.indices)
      ? parsed.indices.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    if (!indices.length) {
      return { intent: 'chitchat', reason: '沒有指明要處理第幾則筆記' };
    }
    return { intent: parsed.intent, indices };
  }

  if (parsed.intent === 'search_note' || parsed.intent === 'search_expense') {
    if (!parsed.keyword) return { intent: 'chitchat', reason: '沒有指明要搜尋什麼' };
    return { intent: parsed.intent, keyword: String(parsed.keyword).slice(0, 50) };
  }

  if (parsed.intent === 'query_savings') {
    return { intent: 'query_savings' };
  }

  if (parsed.intent === 'query_expense_range') {
    const isValidDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!isValidDate(parsed.startDate)) {
      return { intent: 'chitchat', reason: '沒有辨識出明確的日期' };
    }
    const startDate = parsed.startDate;
    const endDate = isValidDate(parsed.endDate) ? parsed.endDate : startDate;
    return { intent: 'query_expense_range', startDate, endDate, label: startDate === endDate ? startDate : `${startDate} ~ ${endDate}` };
  }

  if (parsed.intent === 'set_budget') {
    const amount = Number(parsed.amount);
    if (!parsed.categoryText || !Number.isFinite(amount) || amount <= 0) {
      return { intent: 'chitchat', reason: '沒有辨識出分類或金額' };
    }
    return { intent: 'set_budget', categoryText: String(parsed.categoryText).slice(0, 50), amount };
  }

  if (parsed.intent === 'add_allocation') {
    const toEntries = (arr) =>
      Array.isArray(arr)
        ? arr
            .map((e) => ({ item: String((e && e.item) || '').slice(0, 50), amount: Number(e && e.amount) }))
            .filter((e) => e.item && Number.isFinite(e.amount) && e.amount > 0)
        : [];
    const expenses = toEntries(parsed.expenses);
    const savings = toEntries(parsed.savings);
    if (!expenses.length && !savings.length) {
      return { intent: 'chitchat', reason: '沒有解析出任何分配項目' };
    }
    return { intent: 'add_allocation', expenses, savings };
  }

  return { intent: 'chitchat', reason: parsed.reason || '無法辨識意圖' };
}

module.exports = { parseWithClaude };
