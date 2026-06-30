// lib/helpers.js
const { randomUUID } = require('node:crypto');

const ENUMS = {
  property_type: ['villa', 'apartment', 'suite', 'ecotourism', 'hotel_apartment', 'other'],
  booking_status: ['confirmed', 'pending_payment', 'cancelled', 'completed'],
  payment_status: ['fully_paid', 'deposit_paid', 'unpaid'],
  booking_channel: ['jabama', 'jajiga', 'otaghak', 'shab', 'whatsapp', 'instagram', 'direct_call', 'other'],
  alert_priority: ['high', 'medium', 'low'],
  alert_status: ['open', 'resolved', 'ignored'],
  member_role: ['owner', 'admin', 'staff'],
  recommendation_status: ['pending', 'accepted', 'rejected'],
};

function isValidEnum(type, value) {
  return ENUMS[type] && ENUMS[type].includes(value);
}

function isValidDate(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}

function newId() {
  return randomUUID();
}

function nowIso() {
  return new Date().toISOString().replace('Z', '').slice(0, 23) + 'Z';
}

/**
 * Checks whether a proposed [checkIn, checkOut) range overlaps any existing
 * active booking (confirmed or pending_payment) on the same property.
 * Two ranges [a1,a2) and [b1,b2) overlap iff a1 < b2 AND b1 < a2.
 * excludeBookingId lets you ignore a booking's own row when updating it.
 */
function findOverlappingBookings(db, propertyId, checkIn, checkOut, excludeBookingId = null) {
  const rows = db.prepare(`
    SELECT id, guest_name, channel, booking_status, check_in_date, check_out_date
    FROM bookings
    WHERE property_id = ?
      AND booking_status IN ('confirmed', 'pending_payment')
      AND check_in_date < ?
      AND ? < check_out_date
      ${excludeBookingId ? 'AND id != ?' : ''}
  `).all(...(excludeBookingId
    ? [propertyId, checkOut, checkIn, excludeBookingId]
    : [propertyId, checkOut, checkIn]));
  return rows;
}

function errorResponse(res, status, message, detail) {
  res.status(status).json({ error: message, ...(detail ? { detail } : {}) });
}

module.exports = {
  ENUMS, isValidEnum, isValidDate, newId, nowIso,
  findOverlappingBookings, errorResponse,
};
