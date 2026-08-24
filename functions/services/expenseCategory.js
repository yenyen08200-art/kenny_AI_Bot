// 記帳分類:純關鍵字比對,不呼叫任何 AI
//
// 分類是固定的清單(不是使用者自訂的文字),所以打字打錯字、寫法不一致都不會
// 「多長出一個新分類」——比對不到任何關鍵字,一律歸到「其他」,不會壞掉分類統計。

const CATEGORY_RULES = [
  { name: '房租', pattern: /房租/ },
  { name: '水電網路', pattern: /水電|瓦斯|電話網路|電話費|網路費|電話|網路/ },
  { name: '日用品', pattern: /日常用品|日用品|生活用品/ },
  { name: '交通', pattern: /交通|汽車|機車|加油|停車|過路費|捷運|公車|計程車|高鐵|台鐵|油錢|油費/ },
  { name: '餐飲', pattern: /飲食|早餐|午餐|中餐|晚餐|消夜|宵夜|飲料|咖啡|聚餐|便當|早午餐|下午茶/ },
  { name: '送禮', pattern: /送禮|禮物/ },
  { name: '娛樂交際', pattern: /娛樂|交際|婚禮|禮金|聚會|電影|唱歌|遊戲/ },
  { name: '學習工作', pattern: /學習|深造|課程|辦公|工作用品/ },
  { name: '醫療美容', pattern: /醫療|看病|藥局|藥品|牙醫|美容|理髮/ },
  { name: '代墊還款', pattern: /代墊|代付|還款|墊款|借款/ },
];

const CATEGORY_NAMES = [...CATEGORY_RULES.map((r) => r.name), '其他'];

function classify(item) {
  const text = item || '';
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) return rule.name;
  }
  return '其他';
}

module.exports = { classify, CATEGORY_NAMES };
