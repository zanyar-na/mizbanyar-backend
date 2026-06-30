// routes/alerts.js
const { Router } = require('../lib/micro-router');
const { isValidEnum, errorResponse } = require('../lib/helpers');

function buildRouter(db) {
  const router = new Router();

  // GET /api/alerts?workspace_id=...&status=open
  router.get('/api/alerts', (req, res) => {
    const { workspace_id, status, priority } = req.query;
    if (!workspace_id) return errorResponse(res, 400, 'workspace_id الزامی است');
    let sql = `SELECT * FROM alerts WHERE workspace_id = ?`;
    const params = [workspace_id];
    if (status) { sql += ` AND status = ?`; params.push(status); }
    if (priority) { sql += ` AND priority = ?`; params.push(priority); }
    sql += ` ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at DESC`;
    res.json(db.prepare(sql).all(...params));
  });

  // PATCH /api/alerts/:id  (e.g. { status: 'resolved' })
  router.patch('/api/alerts/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM alerts WHERE id = ?`).get(req.params.id);
    if (!existing) return errorResponse(res, 404, 'هشدار یافت نشد');
    const status = req.body.status ?? existing.status;
    if (!isValidEnum('alert_status', status)) {
      return errorResponse(res, 400, 'وضعیت هشدار نامعتبر است');
    }
    db.prepare(`UPDATE alerts SET status = ? WHERE id = ?`).run(status, req.params.id);
    res.json(db.prepare(`SELECT * FROM alerts WHERE id = ?`).get(req.params.id));
  });

  return router;
}

module.exports = buildRouter;
