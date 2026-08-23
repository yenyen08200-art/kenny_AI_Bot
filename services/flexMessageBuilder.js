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

module.exports = { buildMorningBriefingFlex };
