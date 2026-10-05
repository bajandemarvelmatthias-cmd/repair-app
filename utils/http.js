class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function toId(value, label = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `Invalid or missing ${label}.`);
  return n;
}

// Keep only whitelisted fields that were actually sent; make values SQLite-safe.
function pick(body, fields) {
  const out = {};
  for (const f of fields) {
    let v = body?.[f];
    if (v === undefined) continue;
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (typeof v === 'string') v = v.trim();
    if (v !== null && typeof v !== 'string' && typeof v !== 'number') {
      throw new HttpError(400, `Invalid value for "${f}".`);
    }
    out[f] = v;
  }
  return out;
}

module.exports = { HttpError, toId, pick };
