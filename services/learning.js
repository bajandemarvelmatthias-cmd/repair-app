const { db } = require('../db/database');

const LEVELS = [
  { name: 'Beginner', min: 0 },
  { name: 'Intermediate', min: 100 },
  { name: 'Advanced', min: 250 },
  { name: 'Expert', min: 500 }
];

function levelFor(points) {
  let current = LEVELS[0];
  for (const l of LEVELS) if (points >= l.min) current = l;
  const next = LEVELS.find((l) => l.min > points) || null;
  return {
    level: current.name,
    next_level: next ? { name: next.name, points_needed: next.min - points } : null
  };
}

function logActivity(userId, type, refId = null) {
  db.prepare('INSERT INTO activity_log (user_id, type, ref_id) VALUES (?, ?, ?)').run(userId, type, refId);
}

// Points come from each simulation's best completed score, so repeats do not farm points.
function recalculateProgress(userId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(best), 0) AS points, COUNT(*) AS completed FROM (
      SELECT MAX(score) AS best FROM simulation_attempts
      WHERE user_id = ? AND status = 'completed' GROUP BY simulation_id
    )`).get(userId);
  const { level } = levelFor(row.points);
  db.prepare(`
    INSERT INTO learning_progress (user_id, total_points, simulations_completed, level, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      total_points = excluded.total_points,
      simulations_completed = excluded.simulations_completed,
      level = excluded.level,
      updated_at = excluded.updated_at
  `).run(userId, row.points, row.completed, level);
  return { total_points: row.points, simulations_completed: row.completed, ...levelFor(row.points) };
}

module.exports = { levelFor, logActivity, recalculateProgress };
