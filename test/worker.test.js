import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function settingsDb() {
  return {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async all() {
          if (sql.includes("FROM settings")) {
            return {
              results: [
                { key: "ask_open", value: "true" },
                { key: "tuft_open", value: "false" }
              ]
            };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes("rate_limits")) return { count: 1 };
          return null;
        }
      };
    }
  };
}

function env(overrides = {}) {
  return {
    DB: settingsDb(),
    ADMIN_TOKEN: "snake-key",
    ADMIN_SESSION_SECRET: "session-secret",
    TURNSTILE_SITE_KEY: "test-site-key",
    ENVIRONMENT: "development",
    ...overrides
  };
}

const context = {
  waitUntil() {}
};

test("public config exposes only presentation settings", async () => {
  const response = await worker.fetch(
    new Request("https://radio.example/api/config"),
    env(),
    context
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    askOpen: true,
    tuftOpen: false,
    turnstileSiteKey: "test-site-key"
  });
});

test("admin login creates a usable http-only session", async () => {
  const login = await worker.fetch(
    new Request("https://radio.example/api/admin/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://radio.example"
      },
      body: JSON.stringify({ password: "snake-key" })
    }),
    env(),
    context
  );
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);

  const cookie = setCookie.split(";")[0];
  const session = await worker.fetch(
    new Request("https://radio.example/api/admin/session", {
      headers: { cookie }
    }),
    env(),
    context
  );
  assert.equal(session.status, 200);
  assert.equal((await session.json()).authenticated, true);
});

test("unsafe cross-origin requests are rejected", async () => {
  const response = await worker.fetch(
    new Request("https://radio.example/api/admin/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://elsewhere.example"
      },
      body: JSON.stringify({ password: "snake-key" })
    }),
    env(),
    context
  );
  assert.equal(response.status, 403);
});
