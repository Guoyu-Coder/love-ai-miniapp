// ── AI 恋爱周报自动生成 ──
// 每周日 10:00 自动生成

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY;
const DEEPSEEK_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com') + '/v1/chat/completions';

exports.main = async (event, context) => {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now - 7 * 864e5).toISOString().slice(0, 10);

  try {
    const { data: couples } = await db.collection('couples').limit(100).get();

    for (const couple of couples) {
      const openid = couple.openid;

      const [dates, moments, promises, greetings] = await Promise.all([
        db.collection('date_records').where({ openid, date: db.cmd.gte(start).and(db.cmd.lte(end)) }).orderBy('date', 'asc').get(),
        db.collection('moments').where({ openid, date: db.cmd.gte(start).and(db.cmd.lte(end)) }).orderBy('date', 'asc').get(),
        db.collection('promises').where({ openid, status: 'active' }).get(),
        db.collection('greetings').where({ openid, date: db.cmd.gte(start).and(db.cmd.lte(end)) }).get()
      ]);

      const reportPrompt = `你是一对情侣的AI伴侣「小爱」。请根据以下数据生成一份本周恋爱周报：

情侣：${couple.name1} & ${couple.name2}
本周约会：${dates.data.length}次 - ${JSON.stringify(dates.data.map(d => ({ date: d.date, location: d.location, activity: d.activity, mood: d.mood })))}
心动瞬间：${moments.data.length}条 - ${JSON.stringify(moments.data.map(m => m.content))}
进行中的约定：${JSON.stringify(promises.data.map(p => ({ title: p.title, frequency: p.frequency })))}

请生成一份温暖的周报，包含：
1. 📸 本周回顾（约会概览）
2. 💕 心动集锦（甜蜜瞬间串成一段话）
3. 🤝 约定执行情况
4. 🌸 小爱的观察和建议
5. 📅 下周约会灵感（基于他们的偏好推荐）

总共300-500字，温暖可爱的语气，2-3个emoji点缀。`;

      const res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: reportPrompt }],
          temperature: 0.8,
          max_tokens: 1500
        })
      });

      const data = await res.json();
      const report = data.choices[0].message.content;

      await db.collection('reports').add({
        data: {
          openid,
          type: 'week',
          startDate: start,
          endDate: end,
          content: report,
          stats: {
            dateCount: dates.data.length,
            momentCount: moments.data.length,
            promiseCount: promises.data.length
          },
          createdAt: Date.now()
        }
      });

      console.log(`✅ 周报已为 ${couple.name1}&${couple.name2} 生成`);
    }

    return { success: true, reported: couples.length };
  } catch (err) {
    console.error('周报生成失败:', err);
    return { success: false, error: err.message };
  }
};
