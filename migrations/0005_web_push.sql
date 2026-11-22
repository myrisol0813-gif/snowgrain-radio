-- Private browser-push subscription registry; no submission body or email is stored.
CREATE TABLE IF NOT EXISTS push_config (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  public_key TEXT NOT NULL,
  encrypted_private_jwk TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
