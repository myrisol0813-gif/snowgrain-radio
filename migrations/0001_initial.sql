CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('ask', 'tuft')),
  message TEXT NOT NULL,
  email_ciphertext TEXT,
  email_iv TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'held', 'done', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS submissions_kind_created_idx
  ON submissions(kind, created_at DESC);

CREATE INDEX IF NOT EXISTS submissions_status_created_idx
  ON submissions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS attachments_submission_idx
  ON attachments(submission_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key, value, updated_at)
VALUES
  ('ask_open', 'true', CURRENT_TIMESTAMP),
  ('tuft_open', 'true', CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_ends_at TEXT NOT NULL
);
