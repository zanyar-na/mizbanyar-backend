-- =====================================================================
-- MizbanYar (میزبان‌یار) — Database Schema
-- =====================================================================
-- Engine note: written for SQLite (zero-dependency, file-based) so this
-- backend runs anywhere without a Postgres server. The design is fully
-- PostgreSQL-portable:
--   • SQLite has no native ENUM type, so each enum below is implemented
--     as TEXT + CHECK(col IN (...)). In Postgres, swap these for native
--     `CREATE TYPE ... AS ENUM (...)` types — the column-level meaning
--     and allowed values are identical.
--   • UUIDs are generated in the app layer (uuid v4) and stored as TEXT.
--     In Postgres, change column type to UUID and use gen_random_uuid().
--   • All timestamps are TEXT in ISO-8601 (UTC), Postgres-compatible.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- ENUM REFERENCE (documented here; enforced via CHECK constraints below)
-- ---------------------------------------------------------------------
-- property_type:    villa | apartment | suite | ecotourism | hotel_apartment | other
-- booking_status:    confirmed | pending_payment | cancelled | completed
-- payment_status:    fully_paid | deposit_paid | unpaid
-- booking_channel:   jabama | jajiga | otaghak | shab | whatsapp | instagram | direct_call | other
-- alert_priority:    high | medium | low
-- alert_status:      open | resolved | ignored
-- member_role:       owner | admin | staff
-- recommendation_status: pending | accepted | rejected
-- ---------------------------------------------------------------------

-- =====================================================================
-- users
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,                 -- UUID
  email         TEXT UNIQUE,
  phone         TEXT UNIQUE,                       -- Iranian market: phone is primary identifier
  password_hash TEXT,
  full_name     TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- =====================================================================
-- workspaces  (multi-tenancy boundary)
-- =====================================================================
CREATE TABLE IF NOT EXISTS workspaces (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  primary_city  TEXT,
  owner_id      TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id);

-- =====================================================================
-- workspace_members
-- =====================================================================
CREATE TABLE IF NOT EXISTS workspace_members (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','admin','staff')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON workspace_members(user_id);

-- =====================================================================
-- properties
-- =====================================================================
CREATE TABLE IF NOT EXISTS properties (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  name            TEXT NOT NULL,
  city            TEXT NOT NULL,
  area            TEXT,
  type            TEXT NOT NULL CHECK (type IN
                    ('villa','apartment','suite','ecotourism','hotel_apartment','other')),
  base_capacity   INTEGER NOT NULL CHECK (base_capacity > 0),
  max_capacity    INTEGER NOT NULL CHECK (max_capacity > 0),
  bedrooms_count  INTEGER DEFAULT 0 CHECK (bedrooms_count >= 0),
  beds_count      INTEGER DEFAULT 0 CHECK (beds_count >= 0),
  amenities       TEXT DEFAULT '[]',                -- JSON array, e.g. ["استخر","جکوزی"]
  base_price      NUMERIC NOT NULL CHECK (base_price >= 0),
  weekend_price   NUMERIC NOT NULL CHECK (weekend_price >= 0),
  min_price       NUMERIC CHECK (min_price >= 0),
  max_price       NUMERIC CHECK (max_price >= 0),
  status          INTEGER NOT NULL DEFAULT 1,        -- boolean: 1 active / 0 inactive
  internal_notes  TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CHECK (max_capacity >= base_capacity),
  CHECK (min_price IS NULL OR max_price IS NULL OR min_price <= max_price)
);
CREATE INDEX IF NOT EXISTS idx_properties_workspace ON properties(workspace_id);
CREATE INDEX IF NOT EXISTS idx_properties_city ON properties(city);

-- =====================================================================
-- bookings
-- =====================================================================
CREATE TABLE IF NOT EXISTS bookings (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  property_id     TEXT NOT NULL,
  guest_name      TEXT NOT NULL,
  guest_phone     TEXT,
  check_in_date   TEXT NOT NULL,                     -- ISO date YYYY-MM-DD
  check_out_date  TEXT NOT NULL,
  guest_count     INTEGER NOT NULL CHECK (guest_count > 0),
  channel         TEXT NOT NULL CHECK (channel IN
                    ('jabama','jajiga','otaghak','shab','whatsapp','instagram','direct_call','other')),
  booking_status  TEXT NOT NULL DEFAULT 'pending_payment' CHECK (booking_status IN
                    ('confirmed','pending_payment','cancelled','completed')),
  total_amount    NUMERIC NOT NULL CHECK (total_amount >= 0),
  paid_amount     NUMERIC NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  payment_status  TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN
                    ('fully_paid','deposit_paid','unpaid')),
  internal_notes  TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  CHECK (check_out_date > check_in_date),
  CHECK (paid_amount <= total_amount)
);
-- Composite index to optimize double-booking / overlap queries
CREATE INDEX IF NOT EXISTS idx_bookings_property_dates
  ON bookings(property_id, check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_bookings_workspace ON bookings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(booking_status);

-- =====================================================================
-- blocked_dates
-- =====================================================================
CREATE TABLE IF NOT EXISTS blocked_dates (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  property_id   TEXT NOT NULL,
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  reason        TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  CHECK (end_date > start_date)
);
CREATE INDEX IF NOT EXISTS idx_blocked_property_dates
  ON blocked_dates(property_id, start_date, end_date);

-- =====================================================================
-- pricing_recommendations
-- =====================================================================
CREATE TABLE IF NOT EXISTS pricing_recommendations (
  id                  TEXT PRIMARY KEY,
  workspace_id        TEXT NOT NULL,
  property_id         TEXT NOT NULL,
  target_date         TEXT NOT NULL,
  current_price       NUMERIC NOT NULL CHECK (current_price >= 0),
  recommended_price   NUMERIC NOT NULL CHECK (recommended_price >= 0),
  change_percentage   NUMERIC NOT NULL,                -- e.g. +15.0 or -10.0
  reason              TEXT NOT NULL,                    -- Persian explanation
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                        ('pending','accepted','rejected')),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pricing_rec_property_date
  ON pricing_recommendations(property_id, target_date);
CREATE INDEX IF NOT EXISTS idx_pricing_rec_workspace ON pricing_recommendations(workspace_id);

-- =====================================================================
-- alerts
-- =====================================================================
CREATE TABLE IF NOT EXISTS alerts (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  property_id   TEXT,
  booking_id    TEXT,
  alert_type    TEXT NOT NULL,    -- e.g. 'overbooking_conflict','pending_payment','check_in_today','pricing_opportunity'
  title         TEXT NOT NULL,    -- Persian title
  description   TEXT NOT NULL,    -- Persian description
  priority      TEXT NOT NULL CHECK (priority IN ('high','medium','low')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ignored')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_workspace ON alerts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);

-- =====================================================================
-- updated_at auto-touch triggers (SQLite has no ON UPDATE clause)
-- =====================================================================
CREATE TRIGGER IF NOT EXISTS trg_users_updated_at AFTER UPDATE ON users
BEGIN UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_workspaces_updated_at AFTER UPDATE ON workspaces
BEGIN UPDATE workspaces SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_members_updated_at AFTER UPDATE ON workspace_members
BEGIN UPDATE workspace_members SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_properties_updated_at AFTER UPDATE ON properties
BEGIN UPDATE properties SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_bookings_updated_at AFTER UPDATE ON bookings
BEGIN UPDATE bookings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_blocked_updated_at AFTER UPDATE ON blocked_dates
BEGIN UPDATE blocked_dates SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_pricing_updated_at AFTER UPDATE ON pricing_recommendations
BEGIN UPDATE pricing_recommendations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_alerts_updated_at AFTER UPDATE ON alerts
BEGIN UPDATE alerts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
