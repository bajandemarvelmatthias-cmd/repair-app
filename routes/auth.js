const express = require('express');
const { db } = require('../db/database');
const { hashPassword, verifyPassword, signToken } = require('../utils/auth');
const { authenticate } = require('../middleware/auth');
const { HttpError } = require('../utils/http');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const strongEnough = (pw) => typeof pw === 'string' && pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
const publicUser = (u) => ({ id: u.id, full_name: u.full_name, email: u.email, role: u.role });
const homeFor = (role) => (role === 'admin' ? '/admin/' : '/customer/');

router.post('/register', (req, res) => {
  const { full_name, email, password, confirm_password } = req.body || {};
  const errors = {};
  if (!full_name || String(full_name).trim().length < 2) errors.full_name = 'Enter your full name.';
  if (!EMAIL_RE.test(String(email || '').trim())) errors.email = 'Enter a valid email address.';
  if (!strongEnough(password)) errors.password = 'Password must be at least 8 characters with a letter and a number.';
  if (password !== confirm_password) errors.confirm_password = 'Passwords do not match.';
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);

  const cleanEmail = String(email).trim().toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail)) {
    throw new HttpError(409, 'An account with this email already exists.', { email: 'Email already in use.' });
  }

  // Public signup always creates a customer.
  const info = db.prepare(
    "INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'customer')"
  ).run(String(full_name).trim(), cleanEmail, hashPassword(password));

  const user = db.prepare('SELECT id, full_name, email, role FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: signToken({ sub: user.id, role: user.role }), user: publicUser(user), redirect: homeFor(user.role) });
});

router.post('/login', (req, res) => {
  const { email, password, remember } = req.body || {};
  if (!email || !password) throw new HttpError(400, 'Email and password are required.');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    throw new HttpError(401, 'Invalid email or password.');
  }
  if (user.status !== 'active') throw new HttpError(403, 'This account has been disabled.');

  // "Keep me signed in" lasts 30 days; otherwise the default session length applies.
  const token = signToken({ sub: user.id, role: user.role }, remember === true ? 24 * 30 : undefined);
  res.json({ token, user: publicUser(user), redirect: homeFor(user.role) });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// Update the signed-in user's display name.
router.patch('/profile', authenticate, (req, res) => {
  const name = String(req.body?.full_name ?? '').trim();
  if (name.length < 2 || name.length > 80) {
    throw new HttpError(400, 'Please fix the highlighted fields.', { full_name: 'Enter a name between 2 and 80 characters.' });
  }
  db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(name, req.user.id);
  const user = db.prepare('SELECT id, full_name, email, role FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

// Change the signed-in user's password (requires the current one).
router.post('/password', authenticate, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  const errors = {};
  if (!current_password || !verifyPassword(String(current_password), row.password_hash)) errors.current_password = 'Current password is incorrect.';
  if (!strongEnough(new_password)) errors.new_password = 'Password must be at least 8 characters with a letter and a number.';
  else if (new_password === current_password) errors.new_password = 'Choose a password different from your current one.';
  if (new_password !== confirm_password) errors.confirm_password = 'Passwords do not match.';
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
