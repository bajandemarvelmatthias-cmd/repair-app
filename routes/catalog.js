const express = require('express');
const { db } = require('../db/database');
const { toId } = require('../utils/http');

const router = express.Router();

router.get('/categories', (req, res) => {
  res.json(db.prepare('SELECT id, name, description FROM device_categories ORDER BY name').all());
});

router.get('/devices', (req, res) => {
  let sql = `SELECT d.id, d.category_id, c.name AS category, d.brand, d.model
             FROM devices d JOIN device_categories c ON c.id = d.category_id`;
  const params = [];
  if (req.query.category_id) {
    sql += ' WHERE d.category_id = ?';
    params.push(toId(req.query.category_id, 'category_id'));
  }
  sql += ' ORDER BY d.brand, d.model';
  res.json(db.prepare(sql).all(...params));
});

// Symptoms for a category, plus general symptoms that apply to every category.
router.get('/symptoms', (req, res) => {
  let sql = 'SELECT id, category_id, name, description FROM symptoms';
  const params = [];
  if (req.query.category_id) {
    sql += ' WHERE category_id = ? OR category_id IS NULL';
    params.push(toId(req.query.category_id, 'category_id'));
  }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params));
});

module.exports = router;
