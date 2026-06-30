// routes/pricing.js
const { Router } = require('../lib/micro-router');
const { newId, isValidEnum, isValidDate, errorResponse } = require('../lib/helpers');

function buildRouter(db) {
  const router = new Router();

  // GET /api/pricing-recommendations?workspace_id=...&property_id=...&status=pending
  router.get('/api/pricing-recommendations', (req, res) => {
    const { workspace_id, property_id, status } = req.query;
    if (!workspace_id) return errorResponse(res, 400, 'workspace_id الزامی است');
    let sql = `SELECT * FROM pricing_recommendations WHERE workspace_id = ?`;
    const params = [workspace_id];
    if (property_id) { sql += ` AND property_id = ?`; params.push(property_id); }
    if (status) { sql += ` AND status = ?`; params.push(status); }
    sql += ` ORDER BY target_date ASC`;
    res.json(db.prepare(sql).all(...params));
  });

  // POST /api/pricing-recommendations  (manual create, normally an AI/cron job would insert these)
  router.post('/api/pricing-recommendations', (req, res) => {
    const b = req.body;
    const required = ['workspace_id', 'property_id', 'target_date', 'current_price', 'recommended_price', 'reason'];
    for (const f of required) {
      if (b[f] === undefined || b[f] === null || b[f] === '') {
        return errorResponse(res, 400, `فیلد ${f} الزامی است`);
      }
    }
    if (!isValidDate(b.target_date)) return errorResponse(res, 400, 'target_date نامعتبر است');

    const changePct = ((b.recommended_price - b.current_price) / b.current_price) * 100;
    const id = newId();
    db.prepare(`
      INSERT INTO pricing_recommendations
        (id, workspace_id, property_id, target_date, current_price, recommended_price, change_percentage, reason, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(id, b.workspace_id, b.property_id, b.target_date, b.current_price, b.recommended_price, changePct, b.reason);

    res.status(201).json(db.prepare(`SELECT * FROM pricing_recommendations WHERE id = ?`).get(id));
  });

  // PATCH /api/pricing-recommendations/:id  — accept/reject
  router.patch('/api/pricing-recommendations/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM pricing_recommendations WHERE id = ?`).get(req.params.id);
    if (!existing) return errorResponse(res, 404, 'پیشنهاد قیمتی یافت نشد');
    const status = req.body.status ?? existing.status;
    if (!isValidEnum('recommendation_status', status)) {
      return errorResponse(res, 400, 'وضعیت نامعتبر است');
    }
    db.prepare(`UPDATE pricing_recommendations SET status = ? WHERE id = ?`).run(status, req.params.id);

    // if accepted, optionally bump the property's base_price (simple effect)
    if (status === 'accepted' && req.body.applyToProperty) {
      db.prepare(`UPDATE properties SET base_price = ? WHERE id = ?`)
        .run(existing.recommended_price, existing.property_id);
    }

    res.json(db.prepare(`SELECT * FROM pricing_recommendations WHERE id = ?`).get(req.params.id));
  });

  return router;
}

module.exports = buildRouter;
