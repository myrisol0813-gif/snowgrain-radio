import test from "node:test";
import assert from "node:assert/strict";
import {
  createAdminSession,
  decryptEmail,
  encryptEmail,
  isEmail,
  validateMessage,
  verifyAdminSession
} from "../src/core.js";

test("tuft submissions require a valid email", () => {
  assert.match(validateMessage("tuft", "两只毛土豆", "", 0), /邮箱/);
  assert.equal(validateMessage("tuft", "两只毛土豆", "pup@example.com", 0), null);
});

test("ask submissions may contain only an image", () => {
  assert.equal(validateMessage("ask", "", "", 1), null);
  assert.match(validateMessage("ask", "", "", 0), /还没有/);
});

test("email validation stays deliberately small", () => {
  assert.equal(isEmail("pup@example.com"), true);
  assert.equal(isEmail("not-an-email"), false);
});

test("admin sessions expire and reject tampering", async () => {
  const session = await createAdminSession("secret", 1000);
  assert.equal(await verifyAdminSession("secret", session, 1001), true);
  assert.equal(await verifyAdminSession("other", session, 1001), false);
  assert.equal(await verifyAdminSession("secret", session, 9e15), false);
});

test("emails encrypt and decrypt at rest", async () => {
  const keyBytes = new Uint8Array(32);
  crypto.getRandomValues(keyBytes);
  const key = Buffer.from(keyBytes).toString("base64");
  const encrypted = await encryptEmail(key, "pup@example.com");
  assert.notEqual(encrypted.ciphertext, "pup@example.com");
  assert.equal(
    await decryptEmail(key, encrypted.ciphertext, encrypted.iv),
    "pup@example.com"
  );
});
