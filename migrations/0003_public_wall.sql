-- V1.2: optional, consent-based public question/reply pairs.
-- All existing and new submissions stay private until explicit opt-in and owner approval.
ALTER TABLE submissions ADD COLUMN allow_public INTEGER NOT NULL DEFAULT 0 CHECK (allow_public IN (0,1));
ALTER TABLE submissions ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1));
CREATE INDEX IF NOT EXISTS submissions_public_idx
  ON submissions(kind, is_public, created_at DESC);
