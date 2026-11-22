-- V1.1: receipt tokens and owner replies. Existing rows stay unchanged.
-- Earlier ask submissions have no receipt token; they cannot be queried retroactively.
CREATE TABLE IF NOT EXISTS receipt_tokens (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS receipt_tokens_hash_idx ON receipt_tokens(token_hash);

CREATE TABLE IF NOT EXISTS replies (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reply_attachments (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reply_attachments_submission_idx ON reply_attachments(submission_id);
