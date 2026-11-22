const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

export const MAX_MESSAGE_LENGTH = 12000;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

export function normalizeKind(value) {
  return value === "tuft" ? "tuft" : value === "ask" ? "ask" : null;
}

export function validateMessage(kind, message, email, imageCount = 0) {
  if (!normalizeKind(kind)) return "这条信号没有找到自己的频道。";
  const cleanMessage = String(message || "").trim();
  if (!cleanMessage && imageCount === 0) return "还没有往里面放东西。";
  if (cleanMessage.length > MAX_MESSAGE_LENGTH) return "这一团有点太大了，请稍微剪短一点。";
  if (kind === "tuft") {
    if (!cleanMessage) return "还没有让我瞅见毛土豆们。";
    if (!isEmail(email)) return "邮箱看起来还没有写完整。";
    if (imageCount > 0) return "毛团区现在只收文字和邮箱。";
  }
  return null;
}

export function isEmail(value) {
  const input = String(value || "").trim();
  if (input.length < 3 || input.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
}

export function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function hmacHex(secret, value) {
  const key = await importHmacKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value))
  );
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacBase64Url(secret, value) {
  const key = await importHmacKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value))
  );
  return bytesToBase64(signature)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function safeEqual(left, right) {
  const a = encoder.encode(String(left || ""));
  const b = encoder.encode(String(right || ""));
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual
    ? crypto.subtle.timingSafeEqual(a, b)
    : a.every((value, index) => value === b[index]);
}

export async function createAdminSession(secret, now = Date.now()) {
  const expires = now + 7 * 24 * 60 * 60 * 1000;
  const payload = String(expires);
  const signature = await hmacBase64Url(secret, "admin:" + payload);
  return payload + "." + signature;
}

export async function verifyAdminSession(secret, session, now = Date.now()) {
  const [expiresRaw, signature] = String(session || "").split(".");
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < now || !signature) return false;
  const expected = await hmacBase64Url(secret, "admin:" + expiresRaw);
  return safeEqual(expected, signature);
}

export async function importEmailKey(secret) {
  const raw = base64ToBytes(secret);
  if (raw.byteLength !== 32) throw new Error("EMAIL_ENCRYPTION_KEY must decode to 32 bytes");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptEmail(secret, email) {
  const clean = String(email || "").trim();
  if (!clean) return { ciphertext: null, iv: null };
  const key = await importEmailKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(clean))
  );
  return {
    ciphertext: bytesToBase64(encrypted),
    iv: bytesToBase64(iv)
  };
}

export async function decryptEmail(secret, ciphertext, iv) {
  if (!ciphertext || !iv) return "";
  const key = await importEmailKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext)
  );
  return decoder.decode(decrypted);
}

export function parseCookies(header) {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1
          ? [part, ""]
          : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}
