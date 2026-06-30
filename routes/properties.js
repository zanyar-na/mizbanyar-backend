// routes/properties.js
const { Router } = require('../lib/micro-router');
const { newId, isValidEnum, errorResponse } = require('../lib/helpers');

function buildRouter(db) {
  const router = new Router();

  // GET /api/properties?workspace_id=...
  router.get('/api/properties', (req, res) => {
    const { workspace_id } = req.query;
    if (!workspace_id) return errorResponse(res, 400, 'workspace_id الزامی است');
    const rows = db.prepare(`
      SELECT * FROM properties WHERE workspace_id = ? ORDER BY created_at DESC
    `).all(workspace_id);
    res.json(rows.map(withParsedAmenities));
  });

  // GET /api/properties/:id
  router.get('/api/properties/:id', (req, res) => {
    const row = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(req.params.id);
    if (!row) return errorResponse(res, 404, 'اقامتگاه یافت نشد');
    res.json(withParsedAmenities(row));
  });

  // POST /api/properties
  router.post('/api/properties', (req, res) => {
    const b = req.body;
    const required = ['workspace_id', 'name', 'city', 'type', 'base_capacity', 'max_capacity', 'base_price', 'weekend_price'];
    for (const f of required) {
      if (b[f] === undefined || b[f] === null || b[f] === '') {
        return errorResponse(res, 400, `فیلد ${f} الزامی است`);
      }
    }
    if (!isValidEnum('property_type', b.type)) {
      return errorResponse(res, 400, 'نوع اقامتگاه نامعتبر است');
    }
    const id = newId();
    try {
      db.prepare(`
        INSERT INTO properties
          (id, workspace_id, name, city, area, type, base_capacity, max_capacity,
           bedrooms_count, beds_count, amenities, base_price, weekend_price,
           min_price, max_price, status, internal_notes)
        VALUES (@id, @workspace_id, @name, @city, @area, @type, @base_capacity, @max_capacity,
                @bedrooms_count, @beds_count, @amenities, @base_price, @weekend_price,
                @min_price, @max_price, @status, @internal_notes)
      `).run({
        id,
        workspace_id: b.workspace_id,
        name: b.name,
        city: b.city,
        area: b.area ?? null,
        type: b.type,
        base_capacity: b.base_capacity,
        max_capacity: b.max_capacity,
        bedrooms_count: b.bedrooms_count ?? 0,
        beds_count: b.beds_count ?? 0,
        amenities: JSON.stringify(b.amenities ?? []),
        base_price: b.base_price,
        weekend_price: b.weekend_price,
        min_price: b.min_price ?? null,
        max_price: b.max_price ?? null,
        status: b.status === undefined ? 1 : (b.status ? 1 : 0),
        internal_notes: b.internal_notes ?? null,
      });
    } catch (err) {
      return errorResponse(res, 400, 'خطا در ایجاد اقامتگاه — قوانین داده رعایت نشده', err.message);
    }
    const row = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(id);
    res.status(201).json(withParsedAmenities(row));
  });

  // PATCH /api/properties/:id
  router.patch('/api/properties/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(req.params.id);
    if (!existing) return errorResponse(res, 404, 'اقامتگاه یافت نشد');

    const b = req.body;
    if (b.type && !isValidEnum('property_type', b.type)) {
      return errorResponse(res, 400, 'نوع اقامتگاه نامعتبر است');
    }
    const merged = {
      name: b.name ?? existing.name,
      city: b.city ?? existing.city,
      area: b.area ?? existing.area,
      type: b.type ?? existing.type,
      base_capacity: b.base_capacity ?? existing.base_capacity,
      max_capacity: b.max_capacity ?? existing.max_capacity,
      bedrooms_count: b.bedrooms_count ?? existing.bedrooms_count,
      beds_count: b.beds_count ?? existing.beds_count,
      amenities: b.amenities ? JSON.stringify(b.amenities) : existing.amenities,
      base_price: b.base_price ?? existing.base_price,
      weekend_price: b.weekend_price ?? existing.weekend_price,
      min_price: b.min_price ?? existing.min_price,
      max_price: b.max_price ?? existing.max_price,
      status: b.status === undefined ? existing.status : (b.status ? 1 : 0),
      internal_notes: b.internal_notes ?? existing.internal_notes,
      id: req.params.id,
    };
    try {
      db.prepare(`
        UPDATE properties SET
          name=@name, city=@city, area=@area, type=@type,
          base_capacity=@base_capacity, max_capacity=@max_capacity,
          bedrooms_count=@bedrooms_count, beds_count=@beds_count,
          amenities=@amenities, base_price=@base_price, weekend_price=@weekend_price,
          min_price=@min_price, max_price=@max_price, status=@status,
          internal_notes=@internal_notes
        WHERE id=@id
      `).run(merged);
    } catch (err) {
      return errorResponse(res, 400, 'خطا در ویرایش اقامتگاه', err.message);
    }
    const row = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(req.params.id);
    res.json(withParsedAmenities(row));
  });

  // DELETE /api/properties/:id
  router.delete('/api/properties/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(req.params.id);
    if (!existing) return errorResponse(res, 404, 'اقامتگاه یافت نشد');
    db.prepare(`DELETE FROM properties WHERE id = ?`).run(req.params.id);
    res.json({ ok: true, message: 'اقامتگاه حذف شد (همراه با رزروهای مرتبط)' });
  });

  return router;
}

function withParsedAmenities(row) {
  return { ...row, amenities: safeParseJson(row.amenities), status: !!row.status };
}
function safeParseJson(s) {
  try { return JSON.parse(s); } catch { return []; }
}

module.exports = buildRouter;
