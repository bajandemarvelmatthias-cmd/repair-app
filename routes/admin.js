const express = require('express');
const { db, transaction } = require('../db/database');
const { HttpError, toId, pick } = require('../utils/http');
const { hashPassword } = require('../utils/auth');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- Dashboard stats ----------
router.get('/stats', (req, res) => {
  const n = (sql) => db.prepare(sql).get().n;
  res.json({
    users: {
      total: n('SELECT COUNT(*) AS n FROM users'),
      customers: n("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'"),
      admins: n("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
    },
    content: {
      categories: n('SELECT COUNT(*) AS n FROM device_categories'),
      devices: n('SELECT COUNT(*) AS n FROM devices'),
      symptoms: n('SELECT COUNT(*) AS n FROM symptoms'),
      guides: n('SELECT COUNT(*) AS n FROM repair_guides'),
      simulations: n('SELECT COUNT(*) AS n FROM simulations')
    },
    activity: {
      assessments: n('SELECT COUNT(*) AS n FROM assessments'),
      attempts: n('SELECT COUNT(*) AS n FROM simulation_attempts'),
      completed_attempts: n("SELECT COUNT(*) AS n FROM simulation_attempts WHERE status = 'completed'")
    },
    simulation_performance: db.prepare(`
      SELECT s.id, s.title, COUNT(a.id) AS attempts,
             SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) AS completed,
             ROUND(AVG(CASE WHEN a.status = 'completed' AND a.max_score > 0 THEN a.score * 100.0 / a.max_score END), 1) AS avg_percentage
      FROM simulations s LEFT JOIN simulation_attempts a ON a.simulation_id = s.id
      GROUP BY s.id ORDER BY s.title`).all(),
    level_distribution: db.prepare('SELECT level, COUNT(*) AS users FROM learning_progress GROUP BY level').all()
  });
});

// ---------- Users ----------
router.get('/users', (req, res) => {
  res.json(db.prepare(`
    SELECT u.id, u.full_name, u.email, u.role, u.status, u.created_at,
           COALESCE(p.total_points, 0) AS total_points, COALESCE(p.level, 'Beginner') AS level
    FROM users u LEFT JOIN learning_progress p ON p.user_id = u.id ORDER BY u.id DESC`).all());
});

router.post('/users', (req, res) => {
  const { full_name, email, password, role = 'customer' } = req.body || {};
  if (!full_name || !EMAIL_RE.test(String(email || '')) || !password || String(password).length < 8) {
    throw new HttpError(400, 'full_name, a valid email and a password of at least 8 characters are required.');
  }
  if (!['customer', 'admin'].includes(role)) throw new HttpError(400, 'Invalid role.');
  const info = db.prepare('INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(String(full_name).trim(), String(email).trim().toLowerCase(), hashPassword(String(password)), role);
  res.status(201).json(db.prepare('SELECT id, full_name, email, role, status FROM users WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/users/:id', (req, res) => {
  const id = toId(req.params.id);
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) throw new HttpError(404, 'User not found.');

  const fields = pick(req.body, ['full_name', 'role', 'status']);
  if (id === req.user.id && ((fields.role && fields.role !== 'admin') || (fields.status && fields.status !== 'active'))) {
    throw new HttpError(400, 'You cannot demote or disable your own account.');
  }
  if (req.body?.password) {
    if (String(req.body.password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    fields.password_hash = hashPassword(String(req.body.password));
  }
  const cols = Object.keys(fields);
  if (!cols.length) throw new HttpError(400, 'Nothing to update.');

  db.prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => fields[c]), id);
  res.json(db.prepare('SELECT id, full_name, email, role, status FROM users WHERE id = ?').get(id));
});

// ---------- Generic CRUD for simple tables ----------
function crud(path, table, fields, required, orderBy = 'id') {
  router.get(path, (req, res) => {
    res.json(db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all());
  });

  router.get(`${path}/:id`, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(toId(req.params.id));
    if (!row) throw new HttpError(404, 'Record not found.');
    res.json(row);
  });

  router.post(path, (req, res) => {
    const data = pick(req.body, fields);
    const missing = required.filter((f) => data[f] === undefined || data[f] === null || data[f] === '');
    if (missing.length) throw new HttpError(400, 'Missing required fields.', missing);
    const cols = Object.keys(data);
    const info = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map((c) => data[c]));
    res.status(201).json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid));
  });

  router.put(`${path}/:id`, (req, res) => {
    const id = toId(req.params.id);
    if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)) throw new HttpError(404, 'Record not found.');
    const data = pick(req.body, fields);
    const cols = Object.keys(data);
    if (!cols.length) throw new HttpError(400, 'Nothing to update.');
    db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => data[c]), id);
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
  });

  router.delete(`${path}/:id`, (req, res) => {
    const info = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(toId(req.params.id));
    if (!info.changes) throw new HttpError(404, 'Record not found.');
    res.json({ deleted: true });
  });
}

crud('/categories', 'device_categories', ['name', 'description'], ['name'], 'name');
crud('/devices', 'devices', ['category_id', 'brand', 'model', 'notes'], ['category_id', 'brand', 'model'], 'brand, model');
crud('/symptoms', 'symptoms', ['category_id', 'name', 'description'], ['name'], 'name');
crud('/rules', 'assessment_rules', ['symptom_id', 'area_of_concern', 'severity', 'next_steps', 'priority'],
  ['symptom_id', 'area_of_concern', 'next_steps'], 'symptom_id, priority');

// ---------- Repair guides (with steps) ----------
const GUIDE_FIELDS = ['device_category_id', 'symptom_id', 'title', 'summary', 'difficulty', 'estimated_minutes', 'tools', 'is_published'];

function writeGuideSteps(guideId, steps) {
  if (!Array.isArray(steps)) throw new HttpError(400, '"steps" must be an array.');
  db.prepare('DELETE FROM guide_steps WHERE guide_id = ?').run(guideId);
  steps.forEach((s, i) => {
    if (!s?.title || !s?.instruction) throw new HttpError(400, `Guide step ${i + 1} needs a title and an instruction.`);
    db.prepare('INSERT INTO guide_steps (guide_id, step_number, title, instruction, caution) VALUES (?, ?, ?, ?, ?)')
      .run(guideId, i + 1, s.title, s.instruction, s.caution || null);
  });
}

const getGuide = (id) => {
  const guide = db.prepare('SELECT * FROM repair_guides WHERE id = ?').get(id);
  if (!guide) throw new HttpError(404, 'Guide not found.');
  guide.steps = db.prepare('SELECT * FROM guide_steps WHERE guide_id = ? ORDER BY step_number').all(id);
  return guide;
};

router.get('/guides', (req, res) => {
  res.json(db.prepare(`
    SELECT g.*, c.name AS category, (SELECT COUNT(*) FROM guide_steps s WHERE s.guide_id = g.id) AS step_count
    FROM repair_guides g JOIN device_categories c ON c.id = g.device_category_id ORDER BY g.id DESC`).all());
});
router.get('/guides/:id', (req, res) => res.json(getGuide(toId(req.params.id))));

router.post('/guides', (req, res) => {
  const data = pick(req.body, GUIDE_FIELDS);
  if (!data.device_category_id || !data.title) throw new HttpError(400, 'device_category_id and title are required.');
  const id = transaction(() => {
    const cols = Object.keys(data);
    const info = db.prepare(`INSERT INTO repair_guides (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map((c) => data[c]));
    if (req.body.steps) writeGuideSteps(info.lastInsertRowid, req.body.steps);
    return info.lastInsertRowid;
  });
  res.status(201).json(getGuide(id));
});

router.put('/guides/:id', (req, res) => {
  const id = toId(req.params.id);
  getGuide(id);
  const data = pick(req.body, GUIDE_FIELDS);
  transaction(() => {
    const cols = Object.keys(data);
    if (cols.length) db.prepare(`UPDATE repair_guides SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => data[c]), id);
    if (req.body.steps !== undefined) writeGuideSteps(id, req.body.steps);
  });
  res.json(getGuide(id));
});

router.delete('/guides/:id', (req, res) => {
  const info = db.prepare('DELETE FROM repair_guides WHERE id = ?').run(toId(req.params.id));
  if (!info.changes) throw new HttpError(404, 'Guide not found.');
  res.json({ deleted: true });
});

// ---------- Simulations (with steps) ----------
const SIM_FIELDS = ['guide_id', 'title', 'description', 'difficulty', 'is_published'];

function writeSimSteps(simId, steps) {
  if (!Array.isArray(steps)) throw new HttpError(400, '"steps" must be an array.');
  db.prepare('DELETE FROM simulation_steps WHERE simulation_id = ?').run(simId);
  steps.forEach((s, i) => {
    const n = i + 1;
    if (!s?.scenario || !s?.question) throw new HttpError(400, `Simulation step ${n} needs a scenario and a question.`);
    if (!Array.isArray(s.options) || s.options.length < 2 || s.options.some((o) => typeof o !== 'string' || !o.trim())) {
      throw new HttpError(400, `Simulation step ${n} needs at least 2 text options.`);
    }
    if (!Number.isInteger(s.correct_index) || s.correct_index < 0 || s.correct_index >= s.options.length) {
      throw new HttpError(400, `Simulation step ${n} has an invalid correct_index.`);
    }
    db.prepare(`INSERT INTO simulation_steps
      (simulation_id, step_number, scenario, question, options, correct_index, feedback_correct, feedback_incorrect, points)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(simId, n, s.scenario, s.question, JSON.stringify(s.options), s.correct_index,
        s.feedback_correct || null, s.feedback_incorrect || null, Number.isInteger(s.points) ? s.points : 10);
  });
}

const getSim = (id) => {
  const sim = db.prepare('SELECT * FROM simulations WHERE id = ?').get(id);
  if (!sim) throw new HttpError(404, 'Simulation not found.');
  sim.steps = db.prepare('SELECT * FROM simulation_steps WHERE simulation_id = ? ORDER BY step_number').all(id)
    .map((s) => ({ ...s, options: JSON.parse(s.options) }));
  return sim;
};

router.get('/simulations', (req, res) => {
  res.json(db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM simulation_steps st WHERE st.simulation_id = s.id) AS step_count
    FROM simulations s ORDER BY s.id DESC`).all());
});
router.get('/simulations/:id', (req, res) => res.json(getSim(toId(req.params.id))));

router.post('/simulations', (req, res) => {
  const data = pick(req.body, SIM_FIELDS);
  if (!data.title) throw new HttpError(400, 'title is required.');
  const id = transaction(() => {
    const cols = Object.keys(data);
    const info = db.prepare(`INSERT INTO simulations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map((c) => data[c]));
    if (req.body.steps) writeSimSteps(info.lastInsertRowid, req.body.steps);
    return info.lastInsertRowid;
  });
  res.status(201).json(getSim(id));
});

router.put('/simulations/:id', (req, res) => {
  const id = toId(req.params.id);
  getSim(id);
  const data = pick(req.body, SIM_FIELDS);
  transaction(() => {
    const cols = Object.keys(data);
    if (cols.length) db.prepare(`UPDATE simulations SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => data[c]), id);
    if (req.body.steps !== undefined) writeSimSteps(id, req.body.steps);
  });
  res.json(getSim(id));
});

router.delete('/simulations/:id', (req, res) => {
  const info = db.prepare('DELETE FROM simulations WHERE id = ?').run(toId(req.params.id));
  if (!info.changes) throw new HttpError(404, 'Simulation not found.');
  res.json({ deleted: true });
});

module.exports = router;
