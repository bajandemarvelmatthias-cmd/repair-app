const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, transaction } = require('../db/database');
const { HttpError, toId, pick } = require('../utils/http');
const { hashPassword } = require('../utils/auth');

const router = express.Router();
const UPLOADS = path.join(__dirname, '..', 'uploads');
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
const jarr = (v) => { try { return JSON.parse(v || '[]'); } catch { return []; } };
const log = (req, msg) => db.prepare('INSERT INTO cms_activity (user_id, message) VALUES (?, ?)').run(req.user.id, msg);
const need = (v, label) => { if (!v || !String(v).trim()) throw new HttpError(400, `${label} is required.`, { [label.toLowerCase()]: 'Required.' }); };

// ---- Roles: super_admin (all), content_admin (all content), editor (create/edit, no delete, no users/settings)
const role = (req) => req.user.admin_role || 'editor';
function can(...allowed) {
  return (req, res, next) => allowed.includes(role(req)) ? next() : next(new HttpError(403, 'Your role does not allow this action.'));
}
const noEditorDelete = can('super_admin', 'content_admin');
const superOnly = can('super_admin');

function uniqueSlug(table, base, scope = {}, ignoreId = 0) {
  let slug = slugify(base), n = 1;
  const where = Object.keys(scope).map((k) => ` AND ${k} = ?`).join('');
  while (db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?${where}`).get(slug, ignoreId, ...Object.values(scope))) {
    slug = `${slugify(base)}-${++n}`;
  }
  return slug;
}

// Generic CRUD builder
function crud(name, table, fields, opts = {}) {
  const base = `/${name}`;
  router.get(base, (req, res) => res.json(opts.list ? opts.list(req) : db.prepare(`SELECT * FROM ${table} ORDER BY ${opts.order || 'id DESC'}`).all()));
  router.get(`${base}/:id`, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(toId(req.params.id));
    if (!row) throw new HttpError(404, 'Not found.');
    res.json(opts.detail ? opts.detail(row) : row);
  });
  router.post(base, (req, res) => {
    const d = pick(req.body, fields);
    opts.validate?.(d, req);
    if (opts.slug) d.slug = uniqueSlug(table, d.slug || d[opts.slug], opts.scope ? { [opts.scope]: d[opts.scope] } : {});
    opts.before?.(d, null);
    const cols = Object.keys(d);
    const id = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(d)).lastInsertRowid;
    opts.after?.(id, req);
    log(req, `${req.user.full_name} added ${opts.label || name}: ${d[opts.slug] || d.name || d.title || id}`);
    res.status(201).json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
  });
  router.put(`${base}/:id`, (req, res) => {
    const id = toId(req.params.id);
    const cur = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!cur) throw new HttpError(404, 'Not found.');
    const d = pick(req.body, fields);
    opts.validate?.({ ...cur, ...d }, req);
    if (opts.slug && (d.slug || d[opts.slug])) d.slug = uniqueSlug(table, d.slug || d[opts.slug], opts.scope ? { [opts.scope]: d[opts.scope] ?? cur[opts.scope] } : {}, id);
    if (Object.keys(d).length) {
      db.prepare(`UPDATE ${table} SET ${Object.keys(d).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(d), id);
    }
    opts.after?.(id, req);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    const verb = d.status === 'published' && cur.status !== 'published' ? 'published' : 'updated';
    log(req, `${req.user.full_name} ${verb} ${opts.label || name}: ${row.name || row.title}`);
    res.json(row);
  });
  router.delete(`${base}/:id`, noEditorDelete, (req, res) => {
    const id = toId(req.params.id);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw new HttpError(404, 'Not found.');
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    log(req, `${req.user.full_name} deleted ${opts.label || name}: ${row.name || row.title}`);
    res.json({ deleted: true });
  });
  // Reorder: body { ids: [3,1,2] }
  if (opts.reorder) router.post(`${base}/reorder`, (req, res) => {
    const ids = (req.body?.ids || []).map((i) => toId(i));
    transaction(() => ids.forEach((id, i) => db.prepare(`UPDATE ${table} SET ${opts.reorder} = ? WHERE id = ?`).run(i + 1, id)));
    res.json({ ok: true });
  });
}

const STATUS_ERR = (d) => { if (d.status && !['draft', 'published', 'archived'].includes(d.status)) throw new HttpError(400, 'Invalid status.'); };

// ---- Categories / Brands
crud('categories', 'cms_categories', ['name', 'slug', 'description', 'image', 'status', 'sort_order'], {
  slug: 'name', order: 'sort_order, id', reorder: 'sort_order', label: 'category',
  validate: (d) => { need(d.name, 'Name'); STATUS_ERR(d); }
});
crud('brands', 'cms_brands', ['category_id', 'name', 'slug', 'logo', 'description', 'status', 'sort_order'], {
  slug: 'name', scope: 'category_id', reorder: 'sort_order', label: 'brand',
  validate: (d) => { need(d.name, 'Name'); toId(d.category_id, 'category'); STATUS_ERR(d); },
  list: () => db.prepare(`SELECT b.*, c.name AS category FROM cms_brands b JOIN cms_categories c ON c.id=b.category_id ORDER BY c.sort_order, b.sort_order, b.name`).all()
});

// ---- Devices
const DEV = ['brand_id', 'category_id', 'name', 'slug', 'model_number', 'release_year', 'description', 'image', 'gallery', 'specs', 'status'];
const asJson = (v, fallback) => (typeof v === 'string' ? v : JSON.stringify(v ?? fallback));
router.use('/devices', (req, res, next) => { // accept arrays/objects for gallery/specs
  if (req.body) {
    if (req.body.gallery !== undefined) req.body.gallery = asJson(req.body.gallery, []);
    if (req.body.specs !== undefined) req.body.specs = asJson(req.body.specs, {});
  }
  next();
});
crud('devices', 'cms_devices', DEV, {
  slug: 'name', scope: 'brand_id', label: 'device',
  validate: (d) => {
    need(d.name, 'Name'); STATUS_ERR(d);
    const b = db.prepare('SELECT category_id FROM cms_brands WHERE id = ?').get(toId(d.brand_id, 'brand'));
    if (!b) throw new HttpError(400, 'Brand not found.');
    d.category_id = b.category_id; // device category always follows its brand
  },
  list: (req) => {
    const { q, brand_id, category_id, status, year } = req.query;
    let sql = `SELECT d.*, b.name AS brand, c.name AS category,
      (SELECT COUNT(*) FROM cms_guides g WHERE g.device_id = d.id) AS guide_count
      FROM cms_devices d JOIN cms_brands b ON b.id=d.brand_id JOIN cms_categories c ON c.id=d.category_id WHERE 1=1`;
    const p = [];
    if (q) { sql += ' AND (d.name LIKE ? OR d.model_number LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
    if (brand_id) { sql += ' AND d.brand_id = ?'; p.push(toId(brand_id)); }
    if (category_id) { sql += ' AND d.category_id = ?'; p.push(toId(category_id)); }
    if (status) { sql += ' AND d.status = ?'; p.push(status); }
    if (year) { sql += ' AND d.release_year = ?'; p.push(Number(year)); }
    return db.prepare(sql + ' ORDER BY d.created_at DESC, d.id DESC').all(...p);
  },
  detail: (d) => ({
    ...d, gallery: jarr(d.gallery), specs: (() => { try { return JSON.parse(d.specs || '{}'); } catch { return {}; } })(),
    brand: db.prepare('SELECT id, name FROM cms_brands WHERE id=?').get(d.brand_id),
    guides: db.prepare('SELECT * FROM cms_guides WHERE device_id=? ORDER BY sort_order, id').all(d.id),
    parts: db.prepare('SELECT * FROM cms_parts WHERE device_id=? ORDER BY name').all(d.id),
    tools: db.prepare(`SELECT DISTINCT t.* FROM cms_tools t JOIN cms_guide_tools gt ON gt.tool_id=t.id
                       JOIN cms_guides g ON g.id=gt.guide_id WHERE g.device_id=? ORDER BY t.name`).all(d.id)
  })
});
router.post('/devices/:id/duplicate', (req, res) => {
  const d = db.prepare('SELECT * FROM cms_devices WHERE id=?').get(toId(req.params.id));
  if (!d) throw new HttpError(404, 'Not found.');
  const name = `${d.name} (Copy)`;
  const id = db.prepare(`INSERT INTO cms_devices (brand_id,category_id,name,slug,model_number,release_year,description,image,gallery,specs,status)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'draft')`).run(d.brand_id, d.category_id, name, uniqueSlug('cms_devices', name, { brand_id: d.brand_id }),
    d.model_number, d.release_year, d.description, d.image, d.gallery, d.specs).lastInsertRowid;
  log(req, `${req.user.full_name} duplicated device: ${d.name}`);
  res.status(201).json(db.prepare('SELECT * FROM cms_devices WHERE id=?').get(id));
});
router.post('/devices/:id/status', (req, res) => {
  const id = toId(req.params.id), status = req.body?.status;
  STATUS_ERR({ status }); if (!status) throw new HttpError(400, 'Status required.');
  db.prepare('UPDATE cms_devices SET status=? WHERE id=?').run(status, id);
  const d = db.prepare('SELECT name FROM cms_devices WHERE id=?').get(id);
  log(req, `${req.user.full_name} set ${d?.name} to ${status}`);
  res.json({ ok: true, status });
});

// ---- Tools / Parts
crud('tools', 'cms_tools', ['name', 'description', 'image', 'brand', 'link', 'status'], {
  validate: (d) => { need(d.name, 'Name'); STATUS_ERR(d); }, order: 'name', label: 'tool',
  list: () => db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM cms_guide_tools gt WHERE gt.tool_id=t.id) AS guide_count FROM cms_tools t ORDER BY t.name`).all()
});
crud('parts', 'cms_parts', ['device_id', 'name', 'part_type', 'description', 'image', 'link', 'compatibility', 'status'], {
  validate: (d) => { need(d.name, 'Name'); STATUS_ERR(d); }, label: 'part',
  list: () => db.prepare(`SELECT p.*, d.name AS device FROM cms_parts p LEFT JOIN cms_devices d ON d.id=p.device_id ORDER BY p.name`).all()
});

// ---- Guides (with builder: steps + attached tools/parts saved in one call)
const GUIDE = ['device_id', 'title', 'slug', 'repair_category', 'short_description', 'difficulty', 'estimated_minutes', 'cover_image', 'status', 'sort_order'];
const stepsOf = (gid) => db.prepare('SELECT * FROM cms_steps WHERE guide_id=? ORDER BY step_number').all(gid).map((s) => ({
  ...s, images: jarr(s.images),
  tool_ids: db.prepare('SELECT tool_id FROM cms_step_tools WHERE step_id=?').all(s.id).map((r) => r.tool_id),
  part_ids: db.prepare('SELECT part_id FROM cms_step_parts WHERE step_id=?').all(s.id).map((r) => r.part_id)
}));
crud('guides', 'cms_guides', GUIDE, {
  slug: 'title', scope: 'device_id', reorder: 'sort_order', label: 'repair guide',
  validate: (d) => { need(d.title, 'Title'); toId(d.device_id, 'device'); STATUS_ERR(d);
    if (d.difficulty && !['easy', 'moderate', 'difficult'].includes(d.difficulty)) throw new HttpError(400, 'Invalid difficulty.'); },
  list: (req) => {
    let sql = `SELECT g.*, d.name AS device, (SELECT COUNT(*) FROM cms_steps s WHERE s.guide_id=g.id) AS step_count
               FROM cms_guides g JOIN cms_devices d ON d.id=g.device_id WHERE 1=1`;
    const p = [];
    if (req.query.device_id) { sql += ' AND g.device_id=?'; p.push(toId(req.query.device_id)); }
    if (req.query.status) { sql += ' AND g.status=?'; p.push(req.query.status); }
    return db.prepare(sql + ' ORDER BY g.device_id, g.sort_order, g.id').all(...p);
  },
  detail: (g) => ({
    ...g, steps: stepsOf(g.id),
    tool_ids: db.prepare('SELECT tool_id FROM cms_guide_tools WHERE guide_id=?').all(g.id).map((r) => r.tool_id),
    part_ids: db.prepare('SELECT part_id FROM cms_guide_parts WHERE guide_id=?').all(g.id).map((r) => r.part_id)
  }),
  after: (id, req) => {
    const b = req.body || {};
    transaction(() => {
      if (Array.isArray(b.tool_ids)) {
        db.prepare('DELETE FROM cms_guide_tools WHERE guide_id=?').run(id);
        b.tool_ids.forEach((t) => db.prepare('INSERT OR IGNORE INTO cms_guide_tools VALUES (?,?)').run(id, toId(t)));
      }
      if (Array.isArray(b.part_ids)) {
        db.prepare('DELETE FROM cms_guide_parts WHERE guide_id=?').run(id);
        b.part_ids.forEach((p) => db.prepare('INSERT OR IGNORE INTO cms_guide_parts VALUES (?,?)').run(id, toId(p)));
      }
      if (Array.isArray(b.steps)) { // full replace, array order = step order (drag-and-drop result)
        db.prepare('DELETE FROM cms_steps WHERE guide_id=?').run(id);
        b.steps.forEach((s, i) => {
          need(s.title, `Step ${i + 1} title`);
          const sid = db.prepare('INSERT INTO cms_steps (guide_id,step_number,title,instructions,images,video,warning,tip) VALUES (?,?,?,?,?,?,?,?)')
            .run(id, i + 1, String(s.title).trim(), s.instructions || '', JSON.stringify(s.images || []), s.video || null, s.warning || null, s.tip || null).lastInsertRowid;
          (s.tool_ids || []).forEach((t) => db.prepare('INSERT OR IGNORE INTO cms_step_tools VALUES (?,?)').run(sid, toId(t)));
          (s.part_ids || []).forEach((p) => db.prepare('INSERT OR IGNORE INTO cms_step_parts VALUES (?,?)').run(sid, toId(p)));
        });
      }
    });
  }
});
router.post('/guides/:id/status', (req, res) => {
  const id = toId(req.params.id), status = req.body?.status;
  if (!['draft', 'published'].includes(status)) throw new HttpError(400, 'Invalid status.');
  db.prepare('UPDATE cms_guides SET status=? WHERE id=?').run(status, id);
  const g = db.prepare('SELECT title FROM cms_guides WHERE id=?').get(id);
  log(req, `${g?.title} guide ${status === 'published' ? 'published' : 'unpublished'}`);
  res.json({ ok: true, status });
});

// ---- Media library (JSON base64 upload: no extra dependencies)
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm' };
router.get('/media', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : '%';
  res.json(db.prepare('SELECT * FROM media WHERE original_name LIKE ? ORDER BY id DESC').all(q).map((m) => ({ ...m, url: `/uploads/${m.filename}` })));
});
router.post('/media', express.json({ limit: '30mb' }), (req, res) => {
  const { name, data } = req.body || {};
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(data || ''));
  if (!m || !TYPES[m[1]]) throw new HttpError(400, 'Upload a PNG, JPG, WEBP, GIF, SVG, MP4 or WEBM file.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 20 * 1024 * 1024) throw new HttpError(400, 'File is larger than 20 MB.');
  const filename = `${crypto.randomBytes(8).toString('hex')}.${TYPES[m[1]]}`;
  fs.mkdirSync(UPLOADS, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS, filename), buf);
  const kind = m[1].startsWith('video') ? 'video' : 'image';
  const id = db.prepare('INSERT INTO media (filename, original_name, mime, size, kind) VALUES (?,?,?,?,?)')
    .run(filename, String(name || filename).slice(0, 120), m[1], buf.length, kind).lastInsertRowid;
  res.status(201).json({ id, url: `/uploads/${filename}`, kind, original_name: name });
});
router.delete('/media/:id', noEditorDelete, (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id=?').get(toId(req.params.id));
  if (!m) throw new HttpError(404, 'Not found.');
  try { fs.unlinkSync(path.join(UPLOADS, m.filename)); } catch {}
  db.prepare('DELETE FROM media WHERE id=?').run(m.id);
  res.json({ deleted: true });
});

// ---- Dashboard
router.get('/stats', (req, res) => {
  const n = (sql) => db.prepare(sql).get().n;
  res.json({
    categories: n('SELECT COUNT(*) n FROM cms_categories'), brands: n('SELECT COUNT(*) n FROM cms_brands'),
    devices: n('SELECT COUNT(*) n FROM cms_devices'), guides: n('SELECT COUNT(*) n FROM cms_guides'),
    published_guides: n("SELECT COUNT(*) n FROM cms_guides WHERE status='published'"),
    draft_guides: n("SELECT COUNT(*) n FROM cms_guides WHERE status='draft'"),
    activity: db.prepare('SELECT message, created_at FROM cms_activity ORDER BY id DESC LIMIT 10').all()
  });
});

// ---- Admins (super admin only)
const ROLES = ['super_admin', 'content_admin', 'editor'];
router.get('/admins', superOnly, (req, res) => res.json(db.prepare("SELECT id, full_name, email, admin_role, status, created_at FROM users WHERE role='admin' ORDER BY id").all()));
router.post('/admins', superOnly, (req, res) => {
  const { full_name, email, password, admin_role } = req.body || {};
  if (!ROLES.includes(admin_role)) throw new HttpError(400, 'Choose a valid role.');
  if (!full_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) throw new HttpError(400, 'Name and a valid email are required.');
  if (!password || String(password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  const id = db.prepare("INSERT INTO users (full_name,email,password_hash,role,admin_role) VALUES (?,?,?,'admin',?)")
    .run(String(full_name).trim(), String(email).trim().toLowerCase(), hashPassword(String(password)), admin_role).lastInsertRowid;
  log(req, `${req.user.full_name} added admin: ${full_name} (${admin_role})`);
  res.status(201).json({ id });
});
router.put('/admins/:id', superOnly, (req, res) => {
  const id = toId(req.params.id), { admin_role, status } = req.body || {};
  if (id === req.user.id) throw new HttpError(400, 'You cannot change your own role or status.');
  if (admin_role && !ROLES.includes(admin_role)) throw new HttpError(400, 'Invalid role.');
  if (admin_role) db.prepare("UPDATE users SET admin_role=? WHERE id=? AND role='admin'").run(admin_role, id);
  if (status) db.prepare("UPDATE users SET status=? WHERE id=? AND role='admin'").run(status === 'disabled' ? 'disabled' : 'active', id);
  res.json({ ok: true });
});
router.delete('/admins/:id', superOnly, (req, res) => {
  const id = toId(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'You cannot delete your own account.');
  db.prepare("DELETE FROM users WHERE id=? AND role='admin'").run(id);
  res.json({ deleted: true });
});

// ---- Settings (super admin only)
router.get('/settings', superOnly, (req, res) => res.json(Object.fromEntries(db.prepare('SELECT key,value FROM cms_settings').all().map((r) => [r.key, r.value]))));
router.put('/settings', superOnly, (req, res) => {
  for (const k of ['site_name', 'tagline', 'support_email']) {
    if (typeof req.body?.[k] === 'string') db.prepare('INSERT INTO cms_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, req.body[k].trim().slice(0, 200));
  }
  res.json({ ok: true });
});

module.exports = router;
