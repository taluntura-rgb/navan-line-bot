// เก็บรายชื่อผู้ใช้ที่กดเพิ่มเพื่อน OA ไว้ในไฟล์ JSON ง่าย ๆ
// (เหมาะกับสเกลครอบครัว/ชุมชนเล็ก ๆ ตอนเริ่มต้น — ถ้าจะขยายในอนาคต ค่อยย้ายไปใช้ฐานข้อมูลจริง)
//
// แต่ละ user มีโปรไฟล์เฉพาะคนด้วย (province, lat, lon, tapTime) ที่แอดมินเป็นคน
// กรอกให้ทีหลังผ่านคำสั่ง /setuser (ดู server.js) หลังจากคุยกับเขาโดยตรงแล้วรู้
// จังหวัด/พิกัดสวนยาง/เวลากรีดยางปกติ — ตอน follow ใหม่ ๆ ฟิลด์พวกนี้จะยังว่างอยู่

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'users.json');

function loadUsers() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return [];
  }
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

function addUser(userId, displayName) {
  const users = loadUsers();
  if (!users.find((u) => u.userId === userId)) {
    users.push({
      userId,
      displayName,
      joinedAt: new Date().toISOString(),
      // โปรไฟล์เฉพาะคน — แอดมินกรอกทีหลังผ่าน /setuser
      province: null,
      lat: null,
      lon: null,
      tapTime: null, // เวลากรีดยางปกติ รูปแบบ "HH:mm" เช่น "04:00"
      lastAlertDate: null, // กันไม่ให้แจ้งเตือนซ้ำในวันเดียวกัน
    });
    saveUsers(users);
    console.log(`เพิ่มผู้ใช้ใหม่: ${displayName} (${userId})`);
  }
  return users;
}

function removeUser(userId) {
  const users = loadUsers().filter((u) => u.userId !== userId);
  saveUsers(users);
  return users;
}

function findUser(userId) {
  return loadUsers().find((u) => u.userId === userId) || null;
}

// แอดมินใช้บันทึก/แก้ไขโปรไฟล์ของ user คนหนึ่ง (จังหวัด, พิกัด GPS, เวลากรีดยาง)
// คืนค่า user ที่อัปเดตแล้ว หรือ null ถ้าไม่พบ userId นี้ (ต้อง follow OA ก่อนถึงจะตั้งโปรไฟล์ได้)
function updateUserProfile(userId, patch) {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.userId === userId);
  if (idx === -1) return null;
  users[idx] = { ...users[idx], ...patch };
  saveUsers(users);
  return users[idx];
}

// user ที่กรอกโปรไฟล์ครบแล้ว (มีจังหวัด + เวลากรีดยาง) พร้อมเข้าเงื่อนไขแจ้งเตือนเฉพาะคน
function getUsersWithProfile() {
  return loadUsers().filter((u) => u.province && u.tapTime);
}

module.exports = {
  loadUsers,
  saveUsers,
  addUser,
  removeUser,
  findUser,
  updateUserProfile,
  getUsersWithProfile,
};
