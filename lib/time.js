// helper เกี่ยวกับเวลา แยกออกมาจาก server.js เพื่อให้ test ได้ง่าย ๆ โดยไม่ต้องบูต express

// เวลาปัจจุบันในโซนไทย (Asia/Bangkok) — ใช้แทน new Date() ตรง ๆ เพราะเซิร์ฟเวอร์บน
// Render อาจตั้ง timezone เป็น UTC
function getBangkokParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

// จำนวนนาทีที่เหลือก่อนถึง tapTime ("HH:mm") นับจาก now ({hour, minute})
// ถ้าเวลานั้นผ่านไปแล้ววันนี้ จะนับเป็นรอบพรุ่งนี้แทน (ค่าที่ได้จะมาก แปลว่ายังไม่ถึงเวลาเช็ค)
function minutesUntilTapTime(tapTime, now) {
  const [h, m] = tapTime.split(':').map(Number);
  const nowMinutes = now.hour * 60 + now.minute;
  const tapMinutes = h * 60 + m;
  let diff = tapMinutes - nowMinutes;
  if (diff < 0) diff += 24 * 60;
  return diff;
}

module.exports = { getBangkokParts, minutesUntilTapTime };
