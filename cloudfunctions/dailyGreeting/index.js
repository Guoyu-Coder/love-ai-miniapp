// ── AI 每日问候定时触发器 ──
// 每天 8:00 早安 / 22:00 晚安
// AI 结合天气、纪念日、近况生成定制问候

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY;
const DEEPSEEK_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com') + '/v1/chat/completions';

async function generateGreeting(type, couple) {
  const today = new Date().toISOString().slice(0, 10);

  // 查最近的约会和心动瞬间
  const [recentDates, recentMoments] = await Promise.all([
    db.collection('date_records').where({ openid: couple.openid })
      .orderBy('date', 'desc').limit(3).get(),
    db.collection('moments').where({ openid: couple.openid })
      .orderBy('createdAt', 'desc').limit(5).get()
  ]);

  const prompt = type === 'morning'
    ? `生成一条早安问候。这对情侣是 ${couple.name1} 和 ${couple.name2}，他们在 ${couple.city || '某座城市'}。最近约会：${JSON.stringify(recentDates.data)}。天气好的话提醒他们今天适合约会。30-60字，温暖可爱。`
    : `生成一条晚安问候。情侣：${couple.name1} 和 ${couple.name2}。最近心动瞬间：${JSON.stringify(recentMoments.data)}。温柔地祝他们晚安。30-60字，温暖可爱。`;

  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是小爱，一对情侣的AI伴侣。说话温暖可爱，带1-2个emoji。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.9,
      max_tokens: 200
    })
  });

  const data = await res.json();
  return data.choices[0].message.content;
}

exports.main = async (event, context) => {
  const hour = new Date().getHours();
  const type = hour < 12 ? 'morning' : 'night';

  try {
    // 获取所有情侣档案
    const { data: couples } = await db.collection('couples').limit(100).get();

    for (const couple of couples) {
      const greeting = await generateGreeting(type, couple);

      // 存储问候记录
      await db.collection('greetings').add({
        data: {
          openid: couple.openid,
          type,
          content: greeting,
          date: new Date().toISOString().slice(0, 10),
          createdAt: Date.now()
        }
      });

      // 发订阅消息（需要用户先授权）
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: couple.openid,
          templateId: 'placeholder_template_id',
          data: {
            phrase1: { value: type === 'morning' ? '早安' : '晚安' },
            thing2: { value: greeting },
            date3: { value: new Date().toISOString().slice(0, 10) }
          }
        });
      } catch (e) {
        console.log('订阅消息发送失败（用户可能未授权）:', e.message);
      }
    }

    return { success: true, greeted: couples.length };
  } catch (err) {
    console.error('定时问候失败:', err);
    return { success: false, error: err.message };
  }
};
