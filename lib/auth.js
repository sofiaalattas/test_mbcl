const crypto = require('crypto');

// Proteksi password sederhana (bukan sistem login penuh): satu password bersama,
// sesi berupa token bertanda-tangan (HMAC) yang disimpan di sessionStorage browser.
const SESSION_HOURS = 12;

const APP_PASSWORD = process.env.APP_PASSWORD || 'dashboard123';
const APP_SECRET = process.env.APP_SECRET || 'ganti-secret-ini-di-production';

if (!process.env.APP_PASSWORD) {
  console.warn('[auth] APP_PASSWORD belum di-set, memakai password default "dashboard123". Set env var ini di production!');
}
if (!process.env.APP_SECRET) {
  console.warn('[auth] APP_SECRET belum di-set, memakai nilai default (tidak aman untuk production).');
}

function sign(payloadBase64) {
  return crypto.createHmac('sha256', APP_SECRET).update(payloadBase64).digest('base64url');
}

function checkPassword(candidate) {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(APP_PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createToken() {
  const expiresAt = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payloadBase64 = Buffer.from(JSON.stringify({ exp: expiresAt })).toString('base64url');
  const signature = sign(payloadBase64);
  return { token: `${payloadBase64}.${signature}`, expiresAt };
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payloadBase64, signature] = token.split('.');
  const expectedSignature = sign(payloadBase64);
  const sigBuf = Buffer.from(signature || '');
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch (err) {
    return false;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Sesi tidak valid atau sudah kedaluwarsa. Silakan login ulang.' });
  }
  next();
}

module.exports = { checkPassword, createToken, verifyToken, requireAuth };
