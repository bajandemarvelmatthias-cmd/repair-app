const { HttpError } = require('../utils/http');

module.exports = (err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.code === 'ERR_SQLITE_ERROR' && /constraint/i.test(err.message)) {
    return res.status(409).json({
      error: 'This change conflicts with existing data or breaks a rule (duplicate, invalid value, or record in use).'
    });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
};
