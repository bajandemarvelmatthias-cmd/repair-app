const express = require('express');
const { db } = require('../db/database');
const { HttpError, toId } = require('../utils/http');
const { runAssessment } = require('../services/assessment');
const { logActivity } = require('../services/learning');

const router = express.Router();

router.post('/', (req, res) => {
  const symptomId = toId(req.body?.symptom_id, 'symptom_id');
  let categoryId = req.body?.category_id ? toId(req.body.category_id, 'category_id') : null;
  const deviceId = req.body?.device_id ? toId(req.body.device_id, 'device_id') : null;

  if (deviceId) {
    const device = db.prepare('SELECT category_id FROM devices WHERE id = ?').get(deviceId);
    if (!device) throw new HttpError(404, 'Device not found.');
    categoryId = device.category_id;
  }
  if (!categoryId) throw new HttpError(400, 'Provide a device_id or a category_id.');

  const result = runAssessment({ categoryId, symptomId });
  const info = db.prepare(
    'INSERT INTO assessments (user_id, category_id, device_id, symptom_id, severity, result_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, categoryId, deviceId, symptomId, result.severity, JSON.stringify(result));
  logActivity(req.user.id, 'assessment', info.lastInsertRowid);

  res.status(201).json({ id: info.lastInsertRowid, ...result });
});

router.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT a.id, a.severity, a.created_at, s.name AS symptom, c.name AS category,
           d.brand AS device_brand, d.model AS device_model
    FROM assessments a
    LEFT JOIN symptoms s ON s.id = a.symptom_id
    LEFT JOIN device_categories c ON c.id = a.category_id
    LEFT JOIN devices d ON d.id = a.device_id
    WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 50`).all(req.user.id));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT id, created_at, result_json FROM assessments WHERE id = ? AND user_id = ?')
    .get(toId(req.params.id), req.user.id);
  if (!row) throw new HttpError(404, 'Assessment not found.');
  res.json({ id: row.id, created_at: row.created_at, ...JSON.parse(row.result_json) });
});

module.exports = router;
