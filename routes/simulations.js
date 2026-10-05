const express = require('express');
const { db, transaction } = require('../db/database');
const { HttpError, toId } = require('../utils/http');
const { logActivity, recalculateProgress } = require('../services/learning');

const router = express.Router();

// ----- Attempts (defined first) -----
router.get('/attempts/mine', (req, res) => {
  res.json(db.prepare(`
    SELECT a.id, a.simulation_id, s.title, a.status, a.score, a.max_score, a.started_at, a.completed_at
    FROM simulation_attempts a JOIN simulations s ON s.id = a.simulation_id
    WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 100`).all(req.user.id));
});

router.get('/attempts/:attemptId', (req, res) => {
  const attempt = db.prepare(`
    SELECT a.*, s.title FROM simulation_attempts a JOIN simulations s ON s.id = a.simulation_id
    WHERE a.id = ? AND a.user_id = ?`).get(toId(req.params.attemptId), req.user.id);
  if (!attempt) throw new HttpError(404, 'Attempt not found.');

  const responses = db.prepare(`
    SELECT st.step_number, st.question, st.options, r.selected_index, r.is_correct, r.points_awarded,
           CASE WHEN r.is_correct = 1 THEN st.feedback_correct ELSE st.feedback_incorrect END AS feedback,
           st.correct_index
    FROM attempt_responses r JOIN simulation_steps st ON st.id = r.step_id
    WHERE r.attempt_id = ? ORDER BY st.step_number`).all(attempt.id)
    .map((r) => ({ ...r, options: JSON.parse(r.options), is_correct: !!r.is_correct }));

  res.json({ ...attempt, responses });
});

router.post('/attempts/:attemptId/respond', (req, res) => {
  const attemptId = toId(req.params.attemptId);
  const stepId = toId(req.body?.step_id, 'step_id');
  const selected = req.body?.selected_index;

  const attempt = db.prepare('SELECT * FROM simulation_attempts WHERE id = ? AND user_id = ?').get(attemptId, req.user.id);
  if (!attempt) throw new HttpError(404, 'Attempt not found.');
  if (attempt.status !== 'in_progress') throw new HttpError(409, 'This attempt is already completed.');

  const step = db.prepare('SELECT * FROM simulation_steps WHERE id = ? AND simulation_id = ?').get(stepId, attempt.simulation_id);
  if (!step) throw new HttpError(404, 'Step not found in this simulation.');

  const options = JSON.parse(step.options);
  if (!Number.isInteger(selected) || selected < 0 || selected >= options.length) {
    throw new HttpError(400, 'selected_index is out of range.');
  }
  if (db.prepare('SELECT id FROM attempt_responses WHERE attempt_id = ? AND step_id = ?').get(attemptId, stepId)) {
    throw new HttpError(409, 'This step was already answered.');
  }

  const isCorrect = selected === step.correct_index;
  const points = isCorrect ? step.points : 0;

  const outcome = transaction(() => {
    db.prepare(
      'INSERT INTO attempt_responses (attempt_id, step_id, selected_index, is_correct, points_awarded) VALUES (?, ?, ?, ?, ?)'
    ).run(attemptId, stepId, selected, isCorrect ? 1 : 0, points);
    db.prepare('UPDATE simulation_attempts SET score = score + ? WHERE id = ?').run(points, attemptId);

    const total = db.prepare('SELECT COUNT(*) AS n FROM simulation_steps WHERE simulation_id = ?').get(attempt.simulation_id).n;
    const answered = db.prepare('SELECT COUNT(*) AS n FROM attempt_responses WHERE attempt_id = ?').get(attemptId).n;
    const current = db.prepare('SELECT score, max_score FROM simulation_attempts WHERE id = ?').get(attemptId);

    let progress = null;
    const completed = answered >= total;
    if (completed) {
      db.prepare("UPDATE simulation_attempts SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(attemptId);
      logActivity(req.user.id, 'simulation_completed', attempt.simulation_id);
      progress = recalculateProgress(req.user.id);
    }
    return { total, answered, current, completed, progress };
  });

  res.json({
    is_correct: isCorrect,
    correct_index: step.correct_index,
    feedback: isCorrect ? step.feedback_correct : step.feedback_incorrect,
    points_awarded: points,
    score: outcome.current.score,
    max_score: outcome.current.max_score,
    answered: outcome.answered,
    total_steps: outcome.total,
    completed: outcome.completed,
    result: outcome.completed
      ? { percentage: outcome.current.max_score ? Math.round((outcome.current.score / outcome.current.max_score) * 100) : 0 }
      : undefined,
    progress: outcome.progress || undefined
  });
});

// ----- Simulations -----
router.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT s.id, s.title, s.description, s.difficulty, s.guide_id,
      (SELECT COUNT(*) FROM simulation_steps st WHERE st.simulation_id = s.id) AS step_count,
      (SELECT COALESCE(SUM(points), 0) FROM simulation_steps st WHERE st.simulation_id = s.id) AS max_score,
      (SELECT MAX(score) FROM simulation_attempts a
         WHERE a.simulation_id = s.id AND a.user_id = ? AND a.status = 'completed') AS best_score
    FROM simulations s WHERE s.is_published = 1 ORDER BY s.title`).all(req.user.id));
});

router.get('/:id', (req, res) => {
  const id = toId(req.params.id);
  const sim = db.prepare('SELECT id, guide_id, title, description, difficulty FROM simulations WHERE id = ? AND is_published = 1').get(id);
  if (!sim) throw new HttpError(404, 'Simulation not found.');
  // Correct answers and feedback are NOT sent here. They arrive after each response.
  const steps = db.prepare(
    'SELECT id, step_number, scenario, question, options, points FROM simulation_steps WHERE simulation_id = ? ORDER BY step_number'
  ).all(id).map((s) => ({ ...s, options: JSON.parse(s.options) }));
  res.json({ ...sim, steps });
});

router.post('/:id/start', (req, res) => {
  const id = toId(req.params.id);
  const sim = db.prepare('SELECT id FROM simulations WHERE id = ? AND is_published = 1').get(id);
  if (!sim) throw new HttpError(404, 'Simulation not found.');

  const existing = db.prepare(
    "SELECT * FROM simulation_attempts WHERE user_id = ? AND simulation_id = ? AND status = 'in_progress'"
  ).get(req.user.id, id);
  if (existing) {
    const answered = db.prepare('SELECT step_id FROM attempt_responses WHERE attempt_id = ?').all(existing.id).map((r) => r.step_id);
    return res.json({ attempt: existing, answered_step_ids: answered, resumed: true });
  }

  const max = db.prepare('SELECT COALESCE(SUM(points), 0) AS m, COUNT(*) AS n FROM simulation_steps WHERE simulation_id = ?').get(id);
  if (max.n === 0) throw new HttpError(400, 'This simulation has no steps yet.');

  const info = db.prepare('INSERT INTO simulation_attempts (user_id, simulation_id, max_score) VALUES (?, ?, ?)').run(req.user.id, id, max.m);
  const attempt = db.prepare('SELECT * FROM simulation_attempts WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ attempt, answered_step_ids: [], resumed: false });
});

module.exports = router;
