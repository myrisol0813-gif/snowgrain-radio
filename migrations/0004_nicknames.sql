-- Optional public display name for anonymous ask submissions. Older letters remain unnamed.
ALTER TABLE submissions ADD COLUMN nickname TEXT NOT NULL DEFAULT '';
