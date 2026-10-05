const express = require('express');
const { db } = require('../db/database');
const { HttpError, toId } = require('../utils/http');
const { logActivity } = require('../services/learning');

const router = express.Router();

const withSaved = (rows) => rows.map((r) => ({ ...r, is_saved: !!r.is_saved }));

router.get('/', (req, res) => {
  const { category_id, symptom_id, q } = req.query;
  let sql = `
    SELECT g.id, g.title, g.summary, g.difficulty, g.estimated_minutes,
           g.device_category_id, g.symptom_id, c.name AS category,
           (SELECT COUNT(*) FROM guide_steps st WHERE st.guide_id = g.id) AS step_count,
           EXISTS(SELECT 1 FROM saved_guides s WHERE s.guide_id = g.id AND s.user_id = ?) AS is_saved
    FROM repair_guides g JOIN device_categories c ON c.id = g.device_category_id
    WHERE g.is_published = 1`;
  const params = [req.user.id];
  if (category_id) { sql += ' AND g.device_category_id = ?'; params.push(toId(category_id, 'category_id')); }
  if (symptom_id) { sql += ' AND g.symptom_id = ?'; params.push(toId(symptom_id, 'symptom_id')); }
  if (q) { sql += ' AND (g.title LIKE ? OR g.summary LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY g.title';
  res.json(withSaved(db.prepare(sql).all(...params)));
});

router.get('/saved', (req, res) => {
  res.json(db.prepare(`
    SELECT g.id, g.title, g.summary, g.difficulty, g.estimated_minutes, c.name AS category, s.created_at AS saved_at,
           (SELECT COUNT(*) FROM guide_steps st WHERE st.guide_id = g.id) AS step_count, 1 AS is_saved
    FROM saved_guides s
    JOIN repair_guides g ON g.id = s.guide_id
    JOIN device_categories c ON c.id = g.device_category_id
    WHERE s.user_id = ? AND g.is_published = 1 ORDER BY s.created_at DESC`).all(req.user.id));
});

router.get('/:id', (req, res) => {
  const id = toId(req.params.id);
  const guide = db.prepare(`
    SELECT g.*, c.name AS category,
           EXISTS(SELECT 1 FROM saved_guides s WHERE s.guide_id = g.id AND s.user_id = ?) AS is_saved
    FROM repair_guides g JOIN device_categories c ON c.id = g.device_category_id
    WHERE g.id = ? AND g.is_published = 1`).get(req.user.id, id);
  if (!guide) throw new HttpError(404, 'Guide not found.');

  const steps = db.prepare(
    'SELECT step_number, title, instruction, caution FROM guide_steps WHERE guide_id = ? ORDER BY step_number'
  ).all(id);
  const simulations = db.prepare(
    'SELECT id, title, difficulty FROM simulations WHERE guide_id = ? AND is_published = 1'
  ).all(id);

  logActivity(req.user.id, 'guide_view', id);
  res.json({ ...guide, is_saved: !!guide.is_saved, steps, simulations });
});

router.post('/:id/save', (req, res) => {
  const id = toId(req.params.id);
  if (!db.prepare('SELECT id FROM repair_guides WHERE id = ? AND is_published = 1').get(id)) {
    throw new HttpError(404, 'Guide not found.');
  }
  db.prepare('INSERT OR IGNORE INTO saved_guides (user_id, guide_id) VALUES (?, ?)').run(req.user.id, id);
  res.status(201).json({ saved: true });
});

router.delete('/:id/save', (req, res) => {
  db.prepare('DELETE FROM saved_guides WHERE user_id = ? AND guide_id = ?').run(req.user.id, toId(req.params.id));
  res.json({ saved: false });
});

module.exports = router;
