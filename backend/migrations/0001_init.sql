-- Appointments created by the voice agent
CREATE TABLE bookings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  business        TEXT    NOT NULL,              -- 'dental' | 'auto'
  platform        TEXT    NOT NULL,              -- 'elevenlabs' | 'vapi' | 'test'
  service_id      TEXT    NOT NULL,
  patient_name    TEXT    NOT NULL,
  phone           TEXT    NOT NULL,
  date            TEXT    NOT NULL,              -- YYYY-MM-DD, local business time
  start_min       INTEGER NOT NULL,              -- minutes since midnight
  end_min         INTEGER NOT NULL,
  notes           TEXT,
  conversation_id TEXT,
  status          TEXT    NOT NULL DEFAULT 'confirmed',
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_bookings_slot    ON bookings (business, date, status);
CREATE INDEX idx_bookings_created ON bookings (created_at);
CREATE INDEX idx_bookings_conv    ON bookings (conversation_id);

-- "Talk to a human" requests
CREATE TABLE callbacks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  business        TEXT NOT NULL,
  platform        TEXT NOT NULL,
  reason          TEXT NOT NULL,
  summary         TEXT NOT NULL,
  patient_name    TEXT,
  phone           TEXT NOT NULL,
  conversation_id TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_callbacks_created ON callbacks (created_at);
CREATE INDEX idx_callbacks_conv    ON callbacks (conversation_id);

-- One row per conversation (filled by tools during the call and by the post-call webhook)
CREATE TABLE calls (
  id           TEXT PRIMARY KEY,                 -- platform conversation / call id
  business     TEXT NOT NULL,
  platform     TEXT NOT NULL,
  started_at   TEXT,                             -- ISO UTC
  duration_sec INTEGER,
  outcome      TEXT,                             -- 'booked' | 'transferred' | 'question' | 'no_interaction'
  summary      TEXT,
  ended_reason TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_calls_started ON calls (started_at);
