const express = require('express');
const { db } = require('../db/database');
const { recalculateProgress } = require('../services/learning');

const router = express.Router();

router.get('/', (req, res) => {
  const uid = req.user.id;
  const progress = recalculateProgress(uid);
  const count = (sql) => db.prepare(sql).get(uid).n;

  res.json({
    ...progress,
    guides_viewed: count("SELECT COUNT(DISTINCT ref_id) AS n FROM activity_log WHERE user_id = ? AND type = 'guide_view'"),
    saved_guides: count('SELECT COUNT(*) AS n FROM saved_guides WHERE user_id = ?'),
    assessments_done: count('SELECT COUNT(*) AS n FROM assessments WHERE user_id = ?'),
    recent_activity: db.prepare(
      'SELECT type, ref_id, created_at FROM activity_log WHERE user_id = ? ORDER BY id DESC LIMIT 10'
    ).all(uid)
  });
});

module.exports = router;
