const crypto = require('node:crypto');

function secret() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set in .env');
  return process.env.JWT_SECRET;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

function signToken(payload, hoursOverride) {
  const now = Math.floor(Date.now() / 1000);
  const hours = hoursOverride || Number(process.env.JWT_EXPIRES_HOURS) || 12;
  const body = { ...payload, iat: now, exp: now + hours * 3600 };
  const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(body)}`;
  return `${data}.${sign(data)}`;
}

function verifyToken(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const given = Buffer.from(s);
  const expected = Buffer.from(sign(`${h}.${b}`));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
