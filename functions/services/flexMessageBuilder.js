// 建立 LINE Flex Message(卡片訊息)樣板 - 早安簡報專用
// 版面:Header(標題/日期) -> Body(天氣預警區 + 今日行程重點區 + 總結) -> Footer(提醒小語)

const RAIN_HIGH = 70;
const RAIN_MID = 40;

const COLOR = {
  primary: '#2D9CDB',
  primaryLight: '#EAF6FF',
  cardBg: '#F7F9FA',
  textDark: '#333333',
  textMid: '#4F4F4F',
  textLight: '#828282',
  rainHigh: '#EB5757',
  rainMid: '#F2994A',
  rainLow: '#27AE60',
};

function rainColor(rainChance) {
  const v = Number(rainChance);
  if (Number.isNaN(v)) return COLOR.textLight;
  if (v >= RAIN_HIGH) return COLOR.rainHigh;
  if (v >= RAIN_MID) return COLOR.rainMid;
  return COLOR.rainLow;
}

function buildEventRows(events) {
  if (!events || !events.length) {
    return [
      {
        type: 'text',
        text: '今天沒有安排行程,好好休息一下吧！',
        size: 'sm',
        color: COLOR.textLight,
        wrap: true,
      },
    ];
  }

  return events.map((e) => ({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents: [
      { type: 'text', text: e.time || '-', size: 'sm', weight: 'bold', color: COLOR.primary, flex: 2 },
      { type: 'text', text: e.title || '(無標題)', size: 'sm', color: COLOR.textDark, flex: 5, wrap: true },
    ],
  }));
}

function buildMorningBriefingFlex(data) {
  const { weather, summary, reminder, highlightEvents } = data;

  const dateStr = new Date().toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  const bubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: COLOR.primary,
      paddingAll: '20px',
      contents: [
        { type: 'text', text: '☀️ 早安簡報', color: '#FFFFFF', size: 'xl', weight: 'bold' },
        { type: 'text', text: dateStr, color: COLOR.primaryLight, size: 'sm', margin: 'sm' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '20px',
      spacing: 'lg',
      contents: [
        // ── 天氣預警區 ──
        {
          type: 'box',
          layout: 'vertical',
          backgroundColor: COLOR.cardBg,
          cornerRadius: '12px',
          paddingAll: '16px',
          spacing: 'sm',
          contents: [
            { type: 'text', text: '🌧 天氣預警', weight: 'bold', size: 'md', color: COLOR.textDark },
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'md',
              contents: [
                {
                  type: 'text',
                  text: weather.description,
                  size: 'sm',
                  color: COLOR.textMid,
                  flex: 3,
                  wrap: true,
                  gravity: 'center',
                },
                {
                  type: 'text',
                  text: `${weather.rainChance}%`,
                  size: 'xxl',
                  weight: 'bold',
                  color: rainColor(weather.rainChance),
                  flex: 2,
                  align: 'end',
                },
              ],
            },
            {
              type: 'text',
              text: `降雨機率 ・ 氣溫 ${weather.minTemp}°C - ${weather.maxTemp}°C`,
              size: 'xs',
              color: COLOR.textLight,
              margin: 'sm',
            },
          ],
        },
        { type: 'separator' },
        // ── 今日行程重點區 ──
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            { type: 'text', text: '📅 今日行程重點', weight: 'bold', size: 'md', color: COLOR.textDark },
            ...buildEventRows(highlightEvents),
          ],
        },
        { type: 'separator' },
        {
          type: 'text',
          text: summary || '今日簡報',
          size: 'sm',
          weight: 'bold',
          color: COLOR.primary,
          wrap: true,
          align: 'center',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [
        {
          type: 'text',
          text: reminder ? `☂️ ${reminder}` : '祝你今天順利！',
          size: 'xs',
          color: COLOR.textLight,
          wrap: true,
          align: 'center',
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: summary ? `早安簡報:${summary}` : '早安簡報',
    contents: bubble,
  };
}

// ── 通用清單卡片 ──
// 讓各種清單類回覆(整週行程、搜尋結果、空檔、月結、指令表)共用同一套版面,
// 不用每張卡各自手刻一大坨 Flex JSON。
//
// sections: [{ heading?, rows: [{ left, right?, leftColor?, bold? }], emptyText? }]
// hero: { value, label } — 想放一個醒目大數字時使用(例如月支出總額)

function buildRow(row) {
  const contents = [
    {
      type: 'text',
      text: row.left || '-',
      size: 'sm',
      weight: 'bold',
      color: row.leftColor || COLOR.primary,
      flex: row.right ? 3 : 0,
      wrap: !row.right,
    },
  ];

  if (row.right) {
    contents.push({
      type: 'text',
      text: row.right,
      size: 'sm',
      color: COLOR.textDark,
      weight: row.bold ? 'bold' : 'regular',
      flex: 6,
      wrap: true,
    });
  }

  return { type: 'box', layout: 'horizontal', spacing: 'sm', contents };
}

function buildSection(section) {
  const contents = [];

  if (section.heading) {
    contents.push({
      type: 'text',
      text: section.heading,
      size: 'sm',
      weight: 'bold',
      color: COLOR.textDark,
    });
  }

  if (section.rows && section.rows.length) {
    contents.push(...section.rows.map(buildRow));
  } else if (section.emptyText) {
    contents.push({ type: 'text', text: section.emptyText, size: 'sm', color: COLOR.textLight, wrap: true });
  }

  return { type: 'box', layout: 'vertical', spacing: 'sm', contents };
}

// 分類佔比圓餅圖:用 QuickChart(免費、不用金鑰,個人用量遠低於每月 1000 張的免費額度)
// 把 chart.js 設定丟進 URL 換一張圖片網址,直接當 Flex Message 的 image 區塊用
const CHART_PALETTE = ['#4A90D9', '#50B87C', '#F2A93B', '#9B6FD1', '#E1615B', '#6B7684', '#2FA0A0', '#D67AB1', '#8FA83C', '#C97A3D'];

function buildCategoryPieChartUrl(byCategory) {
  if (!byCategory || !byCategory.length) return null;

  const config = {
    type: 'pie',
    data: {
      labels: byCategory.map((c) => c.category),
      datasets: [{ data: byCategory.map((c) => c.total), backgroundColor: CHART_PALETTE }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 13 } } },
        datalabels: { display: false },
      },
    },
  };

  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(config))}&backgroundColor=white&width=500&height=420`;
}

function buildListCard({ title, subtitle, sections = [], hero = null, footerText = null, accent = COLOR.primary, imageUrl = null }) {
  const bodyContents = [];

  if (hero) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: COLOR.cardBg,
      cornerRadius: '12px',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: hero.value, size: 'xxl', weight: 'bold', color: accent, align: 'center' },
        { type: 'text', text: hero.label, size: 'xs', color: COLOR.textLight, align: 'center', margin: 'sm', wrap: true },
      ],
    });
  }

  if (imageUrl) {
    bodyContents.push({ type: 'image', url: imageUrl, size: 'full', aspectRatio: '5:4', aspectMode: 'fit' });
  }

  sections.forEach((section, idx) => {
    if (idx > 0 || hero || imageUrl) bodyContents.push({ type: 'separator', margin: 'md' });
    bodyContents.push(buildSection(section));
  });

  if (!bodyContents.length) {
    bodyContents.push({ type: 'text', text: '(沒有資料)', size: 'sm', color: COLOR.textLight });
  }

  const bubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: accent,
      paddingAll: '16px',
      contents: [
        { type: 'text', text: title, color: '#FFFFFF', size: 'lg', weight: 'bold', wrap: true },
        ...(subtitle
          ? [{ type: 'text', text: subtitle, color: COLOR.primaryLight, size: 'xs', margin: 'sm', wrap: true }]
          : []),
      ],
    },
    body: { type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'md', contents: bodyContents },
    ...(footerText
      ? {
          footer: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            contents: [
              { type: 'text', text: footerText, size: 'xs', color: COLOR.textLight, wrap: true, align: 'center' },
            ],
          },
        }
      : {}),
  };

  return { type: 'flex', altText: title, contents: bubble };
}

module.exports = { buildMorningBriefingFlex, buildListCard, buildCategoryPieChartUrl, COLOR, rainColor };
