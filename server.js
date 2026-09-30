require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const cron = require('node-cron');

const {
  loadUsers,
  addUser,
  removeUser,
  findUser,
  updateUserProfile,
  getUsersWithProfile,
} = require('./lib/users');
const { getForecast, shouldAlertRain, buildAlertMessage } = require('./lib/weather');
const { getBangkokParts, minutesUntilTapTime } = require('./lib/time');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// userId ของแอดมิน (คนเดียวที่สั่ง /users กับ /setuser ได้) — เอามาจาก LINE ของตัวเอง
// (follow OA ตัวเอง แล้วใช้ /users เพื่อดู userId ของตัวเอง หรือดูจาก log ตอน follow)
const ADMIN_LINE_USER_ID = process.env.ADMIN_LINE_USER_ID;

// ช่วงเวลาก่อนกรีดยางที่ถือว่า "ใกล้ถึงเวลา" พอจะเช็ค/แจ้งเตือน (นาที)
const ALERT_LEAD_MIN_MINUTES = Number(process.env.ALERT_LEAD_MIN_MINUTES || 60); // 1 ชม.
const ALERT_LEAD_MAX_MINUTES = Number(process.env.ALERT_LEAD_MAX_MINUTES || 120); // 2 ชม.

const client = new line.Client(config);
const app = express();

// endpoint สำหรับเช็คว่าเซิร์ฟเวอร์ยังรันอยู่ (Render/uptime monitor เรียกดูได้)
app.get('/', (req, res) => {
  res.send('นาวานบอทกำลังทำงานอยู่ครับ');
});

// webhook ที่ตั้งค่าใน LINE Developers Console ต้องชี้มาที่ /webhook
// line.middleware จะ verify signature ให้อัตโนมัติ (ต้องอยู่ก่อน body parser อื่น)
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    await Promise.all((req.body.events || []).map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error('จัดการ event ไม่สำเร็จ:', err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  // มีคนกดเพิ่มเพื่อน OA -> เก็บ userId ไว้ (โปรไฟล์จังหวัด/พิกัด/เวลา ยังว่าง
  // รอแอดมินคุยกับเขาแล้วกรอกให้ทีหลังผ่าน /setuser)
  if (event.type === 'follow') {
    const profile = await client.getProfile(event.source.userId);
    addUser(event.source.userId, profile.displayName);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `ยินดีต้อนรับเข้าสู่นาวาน ${profile.displayName}! เดี๋ยวแอดมินจะทักไปขอข้อมูลจังหวัด/เวลากรีดยางเพื่อตั้งค่าแจ้งเตือนให้เฉพาะคุณครับ`,
    });
  }

  // มีคนบล็อก/ลบเพื่อน -> เอาออกจากรายชื่อรับแจ้งเตือน
  if (event.type === 'unfollow') {
    removeUser(event.source.userId);
    return;
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.trim();
    const senderId = event.source.userId;

    // ---- คำสั่งเฉพาะแอดมิน ----
    if (ADMIN_LINE_USER_ID && senderId === ADMIN_LINE_USER_ID) {
      const adminReply = await handleAdminCommand(text);
      if (adminReply) {
        return client.replyMessage(event.replyToken, { type: 'text', text: adminReply });
      }
    }

    // ---- คำสั่งทั่วไป: เช็คสภาพอากาศตามโปรไฟล์ของตัวเอง (ถ้ายังไม่มีโปรไฟล์ ใช้ค่ากลาง) ----
    if (text === 'สภาพอากาศ' || text.toLowerCase() === 'weather') {
      const user = findUser(senderId);
      const forecast = await getForecast(user && user.province);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: buildAlertMessage(forecast, { tapTime: user && user.tapTime }),
      });
    }
  }
}

// จัดการคำสั่งแอดมิน คืนค่าข้อความตอบกลับ หรือ null ถ้าไม่ตรงคำสั่งไหนเลย
// (null แปลว่าปล่อยให้ handleEvent เช็คคำสั่งทั่วไปต่อ)
async function handleAdminCommand(text) {
  if (text === '/help') {
    return (
      'คำสั่งแอดมิน:\n' +
      '/users - ดูรายชื่อ + userId + โปรไฟล์ปัจจุบันของทุกคน\n' +
      '/setuser <userId> <จังหวัด> <lat,lon> <HH:mm> - บันทึกโปรไฟล์ให้ user คนนั้น\n' +
      'ตัวอย่าง: /setuser Uxxxxxxxx นครพนม 17.401,104.779 04:00'
    );
  }

  if (text === '/users') {
    const users = loadUsers();
    if (users.length === 0) {
      return 'ยังไม่มีใคร follow OA เลยครับ';
    }
    return users
      .map((u, i) => {
        const profile = u.province
          ? `จังหวัด ${u.province} | เวลากรีดยาง ${u.tapTime || '-'} | GPS ${u.lat ?? '-'},${u.lon ?? '-'}`
          : 'ยังไม่ได้กรอกโปรไฟล์ — ใช้ /setuser เพื่อตั้งค่าให้';
        return `${i + 1}. ${u.displayName}\nuserId: ${u.userId}\n${profile}`;
      })
      .join('\n\n');
  }

  if (text.startsWith('/setuser')) {
    // รูปแบบ: /setuser <userId> <จังหวัด> <lat,lon> <HH:mm>
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length !== 5) {
      return (
        'รูปแบบไม่ถูกต้อง ต้องเป็น:\n' +
        '/setuser <userId> <จังหวัด> <lat,lon> <HH:mm>\n' +
        'ตัวอย่าง: /setuser Uxxxxxxxx นครพนม 17.401,104.779 04:00'
      );
    }
    const [, userId, province, latlon, tapTime] = parts;
    const [latStr, lonStr] = latlon.split(',');
    const lat = Number(latStr);
    const lon = Number(lonStr);
    const validTime = /^([01]?\d|2[0-3]):[0-5]\d$/.test(tapTime);

    if (Number.isNaN(lat) || Number.isNaN(lon) || !validTime) {
      return 'พิกัดหรือเวลาไม่ถูกรูปแบบ — ตรวจ lat,lon ให้เป็นตัวเลข และเวลาแบบ HH:mm เช่น 04:00';
    }

    const updated = updateUserProfile(userId, {
      province,
      lat,
      lon,
      tapTime,
      lastAlertDate: null, // เริ่มนับใหม่ เผื่อวันนี้ยังไม่เคยเช็คช่วงเวลานี้มาก่อน
    });

    if (!updated) {
      return `ไม่พบ userId นี้ในระบบ (ต้องให้เขากดเพิ่มเพื่อน OA ก่อน) — พิมพ์ /users เพื่อดู userId ที่มีอยู่`;
    }

    return `บันทึกโปรไฟล์ของ ${updated.displayName} แล้วครับ: จังหวัด ${province}, เวลากรีดยาง ${tapTime}`;
  }

  return null;
}

// เช็ค + แจ้งเตือน "เฉพาะคน เฉพาะพื้นที่ เฉพาะเวลา" — เรียกจาก cron ด้านล่าง
// วนทุกคนที่กรอกโปรไฟล์ครบ ถ้าใกล้เวลากรีดยางของเขา (1-2 ชม.ก่อน ปรับได้ผ่าน env)
// และโอกาสฝนในจังหวัดเขา >= 60% ถึงจะ push แจ้งเตือนเฉพาะคนนั้นคนเดียว
async function checkAndAlertUsers() {
  const now = getBangkokParts();
  const users = getUsersWithProfile();

  if (users.length === 0) {
    console.log('ยังไม่มีใครกรอกโปรไฟล์ครบเลย — ข้ามรอบนี้');
    return;
  }

  for (const user of users) {
    const diff = minutesUntilTapTime(user.tapTime, now);
    const inWindow = diff >= ALERT_LEAD_MIN_MINUTES && diff <= ALERT_LEAD_MAX_MINUTES;
    const alreadyAlertedToday = user.lastAlertDate === now.dateStr;

    if (!inWindow || alreadyAlertedToday) continue;

    try {
      const forecast = await getForecast(user.province);
      if (shouldAlertRain(forecast)) {
        await client.pushMessage(user.userId, {
          type: 'text',
          text: buildAlertMessage(forecast, { tapTime: user.tapTime }),
        });
        updateUserProfile(user.userId, { lastAlertDate: now.dateStr });
        console.log(`ส่งแจ้งเตือนให้ ${user.displayName} (${user.province}) แล้ว`);
      }
    } catch (err) {
      console.error(`เช็ค/แจ้งเตือน ${user.displayName} ไม่สำเร็จ:`, err.message);
    }
  }
}

// รันถี่ขึ้นกว่าเดิม (ทุก 30 นาที) เพราะแต่ละคนมีเวลากรีดยางไม่เหมือนกัน
// (แก้เป็น '*/2 * * * *' ชั่วคราวเพื่อทดสอบเร็ว ๆ ได้)
cron.schedule('*/30 * * * *', () => {
  console.log('กำลังเช็คแจ้งเตือนเฉพาะคน...');
  checkAndAlertUsers().catch((err) => console.error('checkAndAlertUsers พัง:', err));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`นาวานบอทรันอยู่ที่พอร์ต ${port}`);
});

module.exports = {
  handleAdminCommand,
  checkAndAlertUsers,
};
