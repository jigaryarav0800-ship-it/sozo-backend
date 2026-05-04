/**
 * Admin yaratish uchun bir martalik script.
 *
 * Ishlatish:
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD=StrongPass123! node scripts/seedAdmin.js
 *
 * Yoki .env faylidagi qiymatlar orqali:
 *   node scripts/seedAdmin.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const Admin    = require('../src/models/Admin');

async function seed() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.error('Xato: ADMIN_PASSWORD env o\'zgaruvchisi o\'rnatilmagan.');
    console.error('Misol: ADMIN_PASSWORD=StrongPass123! node scripts/seedAdmin.js');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Xato: Parol kamida 8 ta belgidan iborat bo\'lishi kerak.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB ga ulandi.');

  const existing = await Admin.findOne({ username });
  if (existing) {
    console.log(`Admin "${username}" allaqachon mavjud. Yangi admin yaratilmadi.`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await Admin.create({ username, password: passwordHash });

  console.log(`✓ Admin "${username}" muvaffaqiyatli yaratildi.`);
  console.log('Endi bu ma\'lumotlar bilan /api/admin/auth/login orqali kirishingiz mumkin.');
  process.exit(0);
}

seed().catch(e => {
  console.error('Seed xatosi:', e.message);
  process.exit(1);
});
