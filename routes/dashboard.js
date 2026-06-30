// routes/dashboard.js
const { Router } = require('../lib/micro-router');
const { errorResponse } = require('../lib/helpers');

function buildRouter(db) {
  const router = new Router();

  // GET /api/dashboard/summary?workspace_id=...
  router.get('/api/dashboard/summary', (req, res) => {
    const { workspace_id } = req.query;
    if (!workspace_id) return errorResponse(res, 400, 'workspace_id الزامی است');

    const today = new Date().toISOString().slice(0, 10);
    const in30 = addDays(today, 30);

    const revenueThisMonth = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) AS total
      FROM bookings
      WHERE workspace_id = ?
        AND booking_status IN ('confirmed','completed')
        AND strftime('%Y-%m', check_in_date) = strftime('%Y-%m', ?)
    `).get(workspace_id, today).total;

    const upcomingBookings = db.prepare(`
      SELECT COUNT(*) AS c FROM bookings
      WHERE workspace_id = ? AND booking_status='confirmed'
        AND check_in_date >= ? AND check_in_date <= ?
    `).get(workspace_id, today, in30).c;

    const totalProperties = db.prepare(
      `SELECT COUNT(*) AS c FROM properties WHERE workspace_id = ? AND status = 1`
    ).get(workspace_id).c;

    // crude occupancy: booked nights / (properties * 30) over next 30 days
    const bookedNights = db.prepare(`
      SELECT check_in_date, check_out_date FROM bookings
      WHERE workspace_id = ? AND booking_status IN ('confirmed','completed')
        AND check_out_date > ? AND check_in_date < ?
    `).all(workspace_id, today, in30);

    let nights = 0;
    for (const b of bookedNights) {
      const start = b.check_in_date < today ? today : b.check_in_date;
      const end = b.check_out_date > in30 ? in30 : b.check_out_date;
      nights += Math.max(0, daysBetween(start, end));
    }
    const occupancyRate = totalProperties > 0
      ? Math.round((nights / (totalProperties * 30)) * 100)
      : 0;

    const openAlerts = db.prepare(
      `SELECT COUNT(*) AS c FROM alerts WHERE workspace_id = ? AND status = 'open'`
    ).get(workspace_id).c;

    const pendingRecs = db.prepare(
      `SELECT COUNT(*) AS c FROM pricing_recommendations WHERE workspace_id = ? AND status = 'pending'`
    ).get(workspace_id).c;

    res.json({
      revenueThisMonth,
      upcomingBookings,
      totalProperties,
      occupancyRate,
      openAlerts,
      pendingRecommendations: pendingRecs,
    });
  });

  // GET /api/dashboard/revenue-by-channel?workspace_id=...
  router.get('/api/dashboard/revenue-by-channel', (req, res) => {
    const { workspace_id } = req.query;
    if (!workspace_id) return errorResponse(res, 400, 'workspace_id الزامی است');
    const rows = db.prepare(`
      SELECT channel, COUNT(*) AS booking_count, COALESCE(SUM(total_amount), 0) AS revenue
      FROM bookings
      WHERE workspace_id = ? AND booking_status IN ('confirmed','completed')
      GROUP BY channel
      ORDER BY revenue DESC
    `).all(workspace_id);
    const total = rows.reduce((s, r) => s + r.revenue, 0);
    res.json(rows.map(r => ({ ...r, percentage: total > 0 ? Math.round((r.revenue / total) * 100) : 0 })));
  });

  // GET /api/dashboard/revenue-by-month?workspace_id=...&months=6
  router.get('/api/dashboard/revenue-by-month', (req, res) => {
    const { workspace_id, months = 6 } = req.query;
    if (!workspace_id) return errorResponse(res, 400, 'workspace_id الزامی است');
    const rows = db.prepare(`
      SELECT strftime('%Y-%m', check_in_date) AS month,
             COALESCE(SUM(total_amount), 0) AS revenue,
             COUNT(*) AS booking_count
      FROM bookings
      WHERE workspace_id = ? AND booking_status IN ('confirmed','completed')
      GROUP BY month
      ORDER BY month DESC
      LIMIT ?
    `).all(workspace_id, Number(months));
    res.json(rows.reverse());
  });

  // GET /api/dashboard/calendar?workspace_id=...&property_id=...&month=2026-07
  router.get('/api/dashboard/calendar', (req, res) => {
    const { workspace_id, property_id, month } = req.query;
    if (!workspace_id || !month) return errorResponse(res, 400, 'workspace_id و month الزامی است');

    let sql = `
      SELECT id, property_id, guest_name, channel, booking_status, check_in_date, check_out_date
      FROM bookings
      WHERE workspace_id = ? AND strftime('%Y-%m', check_in_date) <= ? AND strftime('%Y-%m', check_out_date) >= ?
    `;
    const params = [workspace_id, month, month];
    if (property_id) { sql += ` AND property_id = ?`; params.push(property_id); }
    res.json(db.prepare(sql).all(...params));
  });

  return router;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

module.exports = buildRouter;
