// routes/bookings.js
const { Router } = require('../lib/micro-router');
const {
  newId, isValidEnum, isValidDate, errorResponse, findOverlappingBookings,
} = require('../lib/helpers');

function buildRouter(db) {
  const router = new Router();

  // GET /api/bookings?workspace_id=...&property_id=...&status=...
  router.get('/api/bookings', (req, res) => {
    const { workspace_id, property_id, status, from, to } = req.query;
    if (!workspace_id) return errorResponse(res, 400, 'workspace_id الزامی است');

    let sql = `SELECT * FROM bookings WHERE workspace_id = ?`;
    const params = [workspace_id];
    if (property_id) { sql += ` AND property_id = ?`; params.push(property_id); }
    if (status) { sql += ` AND booking_status = ?`; params.push(status); }
    if (from) { sql += ` AND check_out_date > ?`; params.push(from); }
    if (to) { sql += ` AND check_in_date < ?`; params.push(to); }
    sql += ` ORDER BY check_in_date ASC`;

    res.json(db.prepare(sql).all(...params));
  });

  // GET /api/bookings/:id
  router.get('/api/bookings/:id', (req, res) => {
    const row = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(req.params.id);
    if (!row) return errorResponse(res, 404, 'رزرو یافت نشد');
    res.json(row);
  });

  // GET /api/bookings/check-conflict?property_id=...&check_in=...&check_out=...&exclude_id=...
  router.get('/api/bookings-check-conflict', (req, res) => {
    const { property_id, check_in, check_out, exclude_id } = req.query;
    if (!property_id || !isValidDate(check_in) || !isValidDate(check_out)) {
      return errorResponse(res, 400, 'property_id، check_in و check_out معتبر الزامی است');
    }
    const conflicts = findOverlappingBookings(db, property_id, check_in, check_out, exclude_id || null);
    res.json({ hasConflict: conflicts.length > 0, conflicts });
  });

  // POST /api/bookings
  router.post('/api/bookings', (req, res) => {
    const b = req.body;
    const required = ['workspace_id', 'property_id', 'guest_name', 'check_in_date', 'check_out_date', 'guest_count', 'channel', 'total_amount'];
    for (const f of required) {
      if (b[f] === undefined || b[f] === null || b[f] === '') {
        return errorResponse(res, 400, `فیلد ${f} الزامی است`);
      }
    }
    if (!isValidDate(b.check_in_date) || !isValidDate(b.check_out_date)) {
      return errorResponse(res, 400, 'تاریخ ورود/خروج نامعتبر است (فرمت YYYY-MM-DD)');
    }
    if (b.check_out_date <= b.check_in_date) {
      return errorResponse(res, 400, 'تاریخ خروج باید بعد از تاریخ ورود باشد');
    }
    if (!isValidEnum('booking_channel', b.channel)) {
      return errorResponse(res, 400, 'کانال رزرو نامعتبر است');
    }
    const bookingStatus = b.booking_status ?? 'pending_payment';
    if (!isValidEnum('booking_status', bookingStatus)) {
      return errorResponse(res, 400, 'وضعیت رزرو نامعتبر است');
    }
    const paymentStatus = b.payment_status ?? 'unpaid';
    if (!isValidEnum('payment_status', paymentStatus)) {
      return errorResponse(res, 400, 'وضعیت پرداخت نامعتبر است');
    }

    // overbooking guard — block creation unless force=true is passed
    if (['confirmed', 'pending_payment'].includes(bookingStatus) && !b.force) {
      const conflicts = findOverlappingBookings(db, b.property_id, b.check_in_date, b.check_out_date);
      if (conflicts.length > 0) {
        return res.status(409).json({
          error: 'تداخل رزرو شناسایی شد',
          message: 'این بازه تاریخی با رزرو(های) دیگری در همین اقامتگاه تداخل دارد. برای ثبت اجباری، force=true ارسال کنید.',
          conflicts,
        });
      }
    }

    const id = newId();
    try {
      db.prepare(`
        INSERT INTO bookings
          (id, workspace_id, property_id, guest_name, guest_phone,
           check_in_date, check_out_date, guest_count, channel,
           booking_status, total_amount, paid_amount, payment_status, internal_notes)
        VALUES (@id, @workspace_id, @property_id, @guest_name, @guest_phone,
                @check_in_date, @check_out_date, @guest_count, @channel,
                @booking_status, @total_amount, @paid_amount, @payment_status, @internal_notes)
      `).run({
        id,
        workspace_id: b.workspace_id,
        property_id: b.property_id,
        guest_name: b.guest_name,
        guest_phone: b.guest_phone ?? null,
        check_in_date: b.check_in_date,
        check_out_date: b.check_out_date,
        guest_count: b.guest_count,
        channel: b.channel,
        booking_status: bookingStatus,
        total_amount: b.total_amount,
        paid_amount: b.paid_amount ?? 0,
        payment_status: paymentStatus,
        internal_notes: b.internal_notes ?? null,
      });
    } catch (err) {
      return errorResponse(res, 400, 'خطا در ثبت رزرو — قوانین داده رعایت نشده', err.message);
    }

    // auto-create alert if force-created despite conflict
    if (b.force) {
      db.prepare(`
        INSERT INTO alerts (id, workspace_id, property_id, booking_id, alert_type, title, description, priority, status)
        VALUES (?, ?, ?, ?, 'overbooking_conflict', ?, ?, 'high', 'open')
      `).run(
        newId(), b.workspace_id, b.property_id, id,
        'تداخل رزرو اجباری ثبت شد',
        `رزرو ${b.guest_name} با وجود تداخل تاریخی به‌صورت اجباری ثبت شد. لطفاً فوراً بررسی کنید.`
      );
    }

    const row = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(id);
    res.status(201).json(row);
  });

  // PATCH /api/bookings/:id
  router.patch('/api/bookings/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(req.params.id);
    if (!existing) return errorResponse(res, 404, 'رزرو یافت نشد');
    const b = req.body;

    const merged = {
      guest_name: b.guest_name ?? existing.guest_name,
      guest_phone: b.guest_phone ?? existing.guest_phone,
      check_in_date: b.check_in_date ?? existing.check_in_date,
      check_out_date: b.check_out_date ?? existing.check_out_date,
      guest_count: b.guest_count ?? existing.guest_count,
      channel: b.channel ?? existing.channel,
      booking_status: b.booking_status ?? existing.booking_status,
      total_amount: b.total_amount ?? existing.total_amount,
      paid_amount: b.paid_amount ?? existing.paid_amount,
      payment_status: b.payment_status ?? existing.payment_status,
      internal_notes: b.internal_notes ?? existing.internal_notes,
      id: req.params.id,
    };

    if (b.channel && !isValidEnum('booking_channel', b.channel)) {
      return errorResponse(res, 400, 'کانال رزرو نامعتبر است');
    }
    if (b.booking_status && !isValidEnum('booking_status', b.booking_status)) {
      return errorResponse(res, 400, 'وضعیت رزرو نامعتبر است');
    }
    if (b.payment_status && !isValidEnum('payment_status', b.payment_status)) {
      return errorResponse(res, 400, 'وضعیت پرداخت نامعتبر است');
    }
    if (merged.check_out_date <= merged.check_in_date) {
      return errorResponse(res, 400, 'تاریخ خروج باید بعد از تاریخ ورود باشد');
    }

    if (['confirmed', 'pending_payment'].includes(merged.booking_status) && !b.force) {
      const conflicts = findOverlappingBookings(
        db, existing.property_id, merged.check_in_date, merged.check_out_date, req.params.id
      );
      if (conflicts.length > 0) {
        return res.status(409).json({
          error: 'تداخل رزرو شناسایی شد',
          message: 'این تغییر باعث تداخل با رزرو(های) دیگر می‌شود. برای اعمال اجباری، force=true ارسال کنید.',
          conflicts,
        });
      }
    }

    try {
      db.prepare(`
        UPDATE bookings SET
          guest_name=@guest_name, guest_phone=@guest_phone,
          check_in_date=@check_in_date, check_out_date=@check_out_date,
          guest_count=@guest_count, channel=@channel, booking_status=@booking_status,
          total_amount=@total_amount, paid_amount=@paid_amount, payment_status=@payment_status,
          internal_notes=@internal_notes
        WHERE id=@id
      `).run(merged);
    } catch (err) {
      return errorResponse(res, 400, 'خطا در ویرایش رزرو', err.message);
    }
    res.json(db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(req.params.id));
  });

  // DELETE /api/bookings/:id
  router.delete('/api/bookings/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(req.params.id);
    if (!existing) return errorResponse(res, 404, 'رزرو یافت نشد');
    db.prepare(`DELETE FROM bookings WHERE id = ?`).run(req.params.id);
    res.json({ ok: true, message: 'رزرو حذف شد' });
  });

  return router;
}

module.exports = buildRouter;
