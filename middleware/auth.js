const { db } = require('../db/database');
const { verifyToken } = require('../utils/auth');

function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });

  const user = db.prepare('SELECT id, full_name, email, role, status FROM users WHERE id = ?').get(payload.sub);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: 'Account not available.' });
  }
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
