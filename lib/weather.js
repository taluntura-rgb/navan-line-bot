// ดึงพยากรณ์อากาศจาก TMD API และตัดสินใจว่าควรแจ้งเตือนหรือไม่
//
// หมายเหตุ: ต้องยืนยัน path/parameter ที่แน่นอนของ endpoint อีกครั้งตอนสมัคร
// ที่ data.tmd.go.th เพราะบางหน้าเอกสารบล็อกการดึงข้อมูลอัตโนมัติไว้
// ถ้ายังไม่มี TMD_API_KEY ระบบจะใช้ข้อมูลจำลอง (mock) แทน เพื่อให้ทดสอบ flow ได้ก่อน
//
// ข้อจำกัดที่รู้อยู่แล้ว: endpoint นี้รับพารามิเตอร์เป็น "จังหวัด" เท่านั้น ไม่รองรับ
// lat/lon ตรง ๆ ดังนั้นตอนนี้ระบบ "เฉพาะพื้นที่" จริง ๆ แล้วคือระดับจังหวัดของแต่ละคน
// (พิกัด GPS ที่เก็บไว้ใน users.json ยังไม่ได้ถูกใช้คำนวณสภาพอากาศ — เก็บไว้สำหรับ
// อ้างอิง/อนาคตถ้าเปลี่ยนไปใช้ API ที่รองรับพิกัดจริง ๆ)

const axios = require('axios');

const TMD_BASE_URL = 'https://data.tmd.go.th/nwpapi/v1/forecast/location/daily';

async function getForecast(province) {
  const apiKey = process.env.TMD_API_KEY;
  const targetProvince = province || process.env.TMD_PROVINCE || 'นครพนม';

  if (!apiKey) {
    console.warn('ยังไม่ได้ตั้งค่า TMD_API_KEY — ใช้ข้อมูลจำลองแทนไปก่อน');
    return mockForecast();
  }

  try {
    const res = await axios.get(TMD_BASE_URL, {
      params: { province: targetProvince },
      headers: { authorization: `Bearer ${apiKey}` },
    });
    return normalizeForecast(res.data);
  } catch (err) {
    console.error(`ดึงข้อมูล TMD ไม่สำเร็จ (${targetProvince}):`, err.message);
    return mockForecast();
  }
}

// แปลงรูปแบบข้อมูลจาก TMD ให้เป็นรูปแบบเดียวกับที่โค้ดส่วนอื่นใช้
// (ต้องปรับ field ตรงนี้ให้ตรงกับ response จริงหลังสมัคร API แล้ว)
function normalizeForecast(raw) {
  return {
    rainChance: raw?.rainChance ?? 0,
    condition: raw?.condition ?? 'ไม่ทราบสภาพอากาศ',
  };
}

function mockForecast() {
  return {
    rainChance: 70,
    condition: 'ฝนฟ้าคะนอง (ข้อมูลจำลอง)',
  };
}

function shouldAlertRain(forecast) {
  // เกณฑ์อย่างง่าย: โอกาสฝนตั้งแต่ 60% ขึ้นไป ให้แจ้งเตือนเรื่องกรีดยาง/ใส่ปุ๋ย
  // ปรับตัวเลขนี้ได้ตามประสบการณ์จริงของครอบครัว/ชุมชน
  return (forecast.rainChance || 0) >= 60;
}

// opts.tapTime (optional) — ถ้าใส่มา จะแทรกข้อความเตือนก่อนเวลากรีดยางของคนนั้นด้วย
function buildAlertMessage(forecast, opts = {}) {
  const { tapTime } = opts;
  const timeLine = tapTime ? `\nเตรียมตัวก่อนเวลากรีดยางของคุณ (${tapTime}) นะครับ` : '';
  return (
    `🌧️ แจ้งเตือนสภาพอากาศ (นาวาน)\n` +
    `วันนี้มีโอกาสฝนตก ${forecast.rainChance}% (${forecast.condition})\n` +
    `ควรเลื่อนเวลากรีดยาง/งดใส่ปุ๋ยช่วงนี้ครับ${timeLine}`
  );
}

module.exports = { getForecast, shouldAlertRain, buildAlertMessage };
