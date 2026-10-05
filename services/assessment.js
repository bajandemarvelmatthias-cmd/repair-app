const { db } = require('../db/database');
const { HttpError } = require('../utils/http');

const RANK = { low: 1, medium: 2, high: 3 };

function runAssessment({ categoryId, symptomId }) {
  const symptom = db.prepare('SELECT * FROM symptoms WHERE id = ?').get(symptomId);
  if (!symptom) throw new HttpError(404, 'Symptom not found.');
  if (symptom.category_id && symptom.category_id !== categoryId) {
    throw new HttpError(400, 'This symptom does not belong to the selected device category.');
  }

  const rules = db.prepare(
    'SELECT area_of_concern, severity, next_steps FROM assessment_rules WHERE symptom_id = ? ORDER BY priority, id'
  ).all(symptomId);

  const guides = db.prepare(`
    SELECT id, title, summary, difficulty, estimated_minutes FROM repair_guides
    WHERE is_published = 1 AND device_category_id = ? AND (symptom_id = ? OR symptom_id IS NULL)
    ORDER BY (symptom_id IS NULL), title`).all(categoryId, symptomId);

  let severity = 'low';
  for (const r of rules) if (RANK[r.severity] > RANK[severity]) severity = r.severity;

  const advice = {
    low: 'This is likely a minor issue that you can try to resolve by following the suggested steps.',
    medium: 'This may need careful troubleshooting. Follow the guide and practice in a simulation first.',
    high: 'This may involve a serious fault. Consider professional inspection before attempting repairs.'
  }[severity];

  return {
    symptom: { id: symptom.id, name: symptom.name },
    severity,
    advice,
    areas_of_concern: rules.map((r) => ({ area: r.area_of_concern, severity: r.severity })),
    suggested_next_steps: rules.map((r) => r.next_steps),
    relevant_guides: guides,
    disclaimer: 'Educational guidance only. It is not a substitute for a professional diagnosis.'
  };
}

module.exports = { runAssessment };
