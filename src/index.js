import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_TOTAL_IMAGE_BYTES,
  createAdminSession,
  decryptEmail,
  encryptEmail,
  hmacHex,
  normalizeKind,
  parseCookies,
  safeEqual,
  validateMessage,
  verifyAdminSession
} from "./core.js";
import {createReceipt,receiptInsert,lookupReceipt,receiptMedia,addReplyData,saveReply,adminReplyMedia} from "./replies.js";
import {publicWall,changePublication,removeSubmission,removeOwnSubmission} from "./community.js";

const ADMIN_COOKIE = "snowgrain_admin";
const STATUS_VALUES = new Set(["new", "held", "done", "archived"]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

function fail(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

function isUnsafeMethod(request) {
  return !["GET", "HEAD", "OPTIONS"].includes(request.method);
}

function sameOrigin(request) {
  if (!isUnsafeMethod(request)) return true;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function sessionSecret(env) {
  return env.ADMIN_SESSION_SECRET || env.ADMIN_TOKEN || "";
}

async function isAdmin(request, env) {
  const secret = sessionSecret(env);
  if (!secret) return false;
  const cookies = parseCookies(request.headers.get("cookie"));
  return verifyAdminSession(secret, cookies[ADMIN_COOKIE]);
}

async function requireAdmin(request, env) {
  if (!sameOrigin(request)) return fail("请求来源不对。", 403);
  if (!(await isAdmin(request, env))) return fail("需要先回到雪粒电台。", 401);
  return null;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function getSettings(env) {
  const result = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('ask_open', 'tuft_open')"
  ).all();
  const values = Object.fromEntries((result.results || []).map((row) => [row.key, row.value]));
  return {
    askOpen: values.ask_open !== "false",
    tuftOpen: values.tuft_open !== "false"
  };
}

async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET) return env.ENVIRONMENT !== "production";
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET,
    response: String(token || "")
  });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.set("remoteip", ip);
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body }
  );
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true;
}

async function checkRateLimit(request, env, kind) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const secret = env.RATE_LIMIT_SECRET || "snowgrain-local";
  const hour = new Date().toISOString().slice(0, 13);
  const key = await hmacHex(secret, kind + ":" + hour + ":" + ip);
  const windowEnds = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(
    "INSERT INTO rate_limits(key, count, window_ends_at) VALUES (?, 1, ?) " +
      "ON CONFLICT(key) DO UPDATE SET count = count + 1, window_ends_at = excluded.window_ends_at " +
      "RETURNING count"
  ).bind(key, windowEnds).first();
  const maximum = Math.max(1, Number(env.RATE_LIMIT_MAX || 12));
  return Number(result?.count || 1) <= maximum;
}

async function notifySignal(env, payload) {
  if (!env.SIGNAL_WEBHOOK_URL || !env.SIGNAL_WEBHOOK_SECRET) return;
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = await hmacHex(
    env.SIGNAL_WEBHOOK_SECRET,
    timestamp + "." + body
  );
  const response = await fetch(env.SIGNAL_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-snowgrain-timestamp": timestamp,
      "x-snowgrain-signature": signature
    },
    body
  });
  if (!response.ok) throw new Error("signal webhook returned " + response.status);
}

function collectImages(form) {
  return form
    .getAll("images")
    .filter((value) => typeof value === "object" && value && "arrayBuffer" in value);
}

async function handleSubmission(request, env, ctx) {
  if (!sameOrigin(request)) return fail("请求来源不对。", 403);
  let form;
  try {
    form = await request.formData();
  } catch {
    return fail("这团东西没有顺利落进来。");
  }

  const kind = normalizeKind(form.get("kind"));
  if (!kind) return fail("这条信号没有找到自己的频道。");
  const settings = await getSettings(env);
  if (kind === "ask" && !settings.askOpen) return fail("今天暂时不收新的信号。", 409);
  if (kind === "tuft" && !settings.tuftOpen) return fail("毛团暂时太多，现在还塞不进来。", 409);

  const images = collectImages(form);
  if (images.length > MAX_IMAGES) return fail("一次最多可以放四张图。");
  let totalBytes = 0;
  for (const image of images) {
    totalBytes += image.size;
    if (!ALLOWED_IMAGE_TYPES.has(image.type)) return fail("目前只收 JPG、PNG 和 WebP 图片。");
    if (image.size > MAX_IMAGE_BYTES) return fail("有一张图片太大了，请压到 6MB 以内。");
  }
  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) return fail("这些图片加起来有点太大了。");

  const message = String(form.get("message") || "").trim();
  const email = String(form.get("email") || "").trim();
  const nickname = kind === "ask" ? String(form.get("nickname") || "").trim() : "";
  if (nickname.length > 36 || /[\r\n\u0000-\u001f]/u.test(nickname)) return fail("小昵称请控制在 36 个字符以内。");
  const allowPublic = kind === "ask" && form.get("allowPublic") === "yes" && !!message;
  const validationError = validateMessage(kind, message, email, images.length);
  if (validationError) return fail(validationError);

  const turnstileOkay = await verifyTurnstile(request, env, form.get("turnstileToken"));
  if (!turnstileOkay) return fail("这条信号还没有通过门口的小检查。", 403);
  if (!(await checkRateLimit(request, env, kind))) {
    return fail("这一小会儿塞进来的东西有点多，请稍后再试。", 429);
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const receipt = kind === "ask" ? await createReceipt(env) : null;
  let encryptedEmail = { ciphertext: null, iv: null };
  if (kind === "tuft") {
    if (!env.EMAIL_ENCRYPTION_KEY) return fail("电台的邮箱保险箱还没有准备好。", 503);
    encryptedEmail = await encryptEmail(env.EMAIL_ENCRYPTION_KEY, email);
  }

  const storedObjects = [];
  const attachmentRows = [];
  try {
    for (const image of images) {
      const attachmentId = crypto.randomUUID();
      const extension =
        image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
      const objectKey = "submissions/" + id + "/" + attachmentId + "." + extension;
      await env.MEDIA.put(objectKey, await image.arrayBuffer(), {
        httpMetadata: { contentType: image.type },
        customMetadata: { submissionId: id, attachmentId }
      });
      storedObjects.push(objectKey);
      attachmentRows.push({
        id: attachmentId,
        objectKey,
        mediaType: image.type,
        originalName: String(image.name || "image." + extension).slice(0, 180),
        sizeBytes: image.size
      });
    }

    const statements = [
      env.DB.prepare(
        "INSERT INTO submissions(" +
          "id, kind, message, email_ciphertext, email_iv, status, created_at, updated_at, allow_public, is_public, nickname" +
          ") VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?, 0, ?)"
      ).bind(
        id,
        kind,
        message,
        encryptedEmail.ciphertext,
        encryptedEmail.iv,
        now,
        now,
        allowPublic ? 1 : 0,
        nickname
      ),
      ...(receipt ? [receiptInsert(env, id, receipt.hash, now)] : []),
      ...attachmentRows.map((row) =>
        env.DB.prepare(
          "INSERT INTO attachments(" +
            "id, submission_id, object_key, media_type, original_name, size_bytes, created_at" +
            ") VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          row.id,
          id,
          row.objectKey,
          row.mediaType,
          row.originalName,
          row.sizeBytes,
          now
        )
      )
    ];
    await env.DB.batch(statements);
  } catch (error) {
    await Promise.allSettled(storedObjects.map((key) => env.MEDIA.delete(key)));
    console.error("submission store failed", error);
    return fail("电台刚才打了个小喷嚏，请再试一次。", 500);
  }

  ctx.waitUntil(
    Promise.allSettled([
      notifySignal(env, {
        event: "snowgrain.signal.received",
        submission_id: id,
        kind,
        created_at: now
      }),
      env.DB.prepare("DELETE FROM rate_limits WHERE window_ends_at < ?")
        .bind(now)
        .run()
    ])
  );

  return json({ ok: true, ...(receipt ? { receiptCode: receipt.code } : {}) }, 201);
}

async function handleAdminLogin(request, env) {
  if (!sameOrigin(request)) return fail("请求来源不对。", 403);
  if (!env.ADMIN_TOKEN || !sessionSecret(env)) return fail("管理入口还没有设置好。", 503);
  if (!(await checkRateLimit(request, env, "admin-login"))) {
    return fail("钥匙试得有点多，请过一会儿再来。", 429);
  }
  const body = await readJson(request);
  if (!body || !(await safeEqual(body.password, env.ADMIN_TOKEN))) {
    return fail("这不是电台的钥匙。", 401);
  }
  const session = await createAdminSession(sessionSecret(env));
  const cookie =
    ADMIN_COOKIE + "=" + encodeURIComponent(session) +
    "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800";
  return json({ ok: true }, 200, { "set-cookie": cookie });
}

function logoutResponse() {
  const cookie =
    ADMIN_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
  return json({ ok: true }, 200, { "set-cookie": cookie });
}

async function listSubmissions(request, env) {
  const url = new URL(request.url);
  const kind = normalizeKind(url.searchParams.get("kind"));
  const requestedStatus = url.searchParams.get("status");
  const status = STATUS_VALUES.has(requestedStatus) ? requestedStatus : null;
  const clauses = [];
  const bindings = [];
  if (kind) {
    clauses.push("kind = ?");
    bindings.push(kind);
  }
  if (status) {
    clauses.push("status = ?");
    bindings.push(status);
  }
  const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
  const rows = await env.DB.prepare(
    "SELECT id, kind, message, email_ciphertext, email_iv, status, created_at, updated_at, allow_public, is_public, nickname " +
      "FROM submissions" + where + " ORDER BY created_at DESC LIMIT 100"
  ).bind(...bindings).all();
  const submissions = rows.results || [];

  let attachmentRows = [];
  if (submissions.length) {
    const marks = submissions.map(() => "?").join(",");
    const result = await env.DB.prepare(
      "SELECT id, submission_id, media_type, original_name, size_bytes " +
        "FROM attachments WHERE submission_id IN (" + marks + ") ORDER BY created_at ASC"
    ).bind(...submissions.map((row) => row.id)).all();
    attachmentRows = result.results || [];
  }
  const bySubmission = new Map();
  for (const attachment of attachmentRows) {
    if (!bySubmission.has(attachment.submission_id)) bySubmission.set(attachment.submission_id, []);
    bySubmission.get(attachment.submission_id).push({
      id: attachment.id,
      mediaType: attachment.media_type,
      originalName: attachment.original_name,
      sizeBytes: attachment.size_bytes
    });
  }

  const output = [];
  for (const row of submissions) {
    let email = "";
    if (row.email_ciphertext && env.EMAIL_ENCRYPTION_KEY) {
      try {
        email = await decryptEmail(
          env.EMAIL_ENCRYPTION_KEY,
          row.email_ciphertext,
          row.email_iv
        );
      } catch (error) {
        console.error("email decrypt failed", row.id, error);
      }
    }
    output.push({
      id: row.id,
      kind: row.kind,
      message: row.message,
      nickname: row.nickname || "",
      email,
      status: row.status,
      allowPublic: row.allow_public === 1,
      isPublic: row.is_public === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      attachments: bySubmission.get(row.id) || []
    });
  }
  await addReplyData(env, output);
  return json({ ok: true, submissions: output });
}

async function updateSubmission(request, env, id) {
  const body = await readJson(request);
  if (!body || !STATUS_VALUES.has(body.status)) return fail("这个状态放不进去。");
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?"
  ).bind(body.status, now, id).run();
  if (!result.meta?.changes) return fail("没有找到这条信号。", 404);
  return json({ ok: true, status: body.status, updatedAt: now });
}

async function updateSettings(request, env) {
  const body = await readJson(request);
  if (!body || typeof body !== "object") return fail("没有收到开关状态。");
  const now = new Date().toISOString();
  const statements = [];
  if (typeof body.askOpen === "boolean") {
    statements.push(
      env.DB.prepare(
        "INSERT INTO settings(key, value, updated_at) VALUES ('ask_open', ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ).bind(String(body.askOpen), now)
    );
  }
  if (typeof body.tuftOpen === "boolean") {
    statements.push(
      env.DB.prepare(
        "INSERT INTO settings(key, value, updated_at) VALUES ('tuft_open', ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ).bind(String(body.tuftOpen), now)
    );
  }
  if (!statements.length) return fail("没有需要改变的开关。");
  await env.DB.batch(statements);
  return json({ ok: true, ...(await getSettings(env)) });
}

async function serveAttachment(env, attachmentId) {
  const row = await env.DB.prepare(
    "SELECT object_key, media_type, original_name FROM attachments WHERE id = ?"
  ).bind(attachmentId).first();
  if (!row) return fail("没有找到这张图。", 404);
  const object = await env.MEDIA.get(row.object_key);
  if (!object) return fail("这张图暂时不在架子上。", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", row.media_type);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set(
    "content-disposition",
    "inline; filename*=UTF-8''" + encodeURIComponent(row.original_name)
  );
  return new Response(object.body, { headers });
}

function applySecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "content-security-policy",
    "default-src 'self'; " +
      "script-src 'self' https://challenges.cloudflare.com; " +
      "style-src 'self'; " +
      "img-src 'self' blob: data:; " +
      "connect-src 'self' https://challenges.cloudflare.com; " +
      "frame-src https://challenges.cloudflare.com; " +
      "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function routeApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/config") {
    return json({
      ok: true,
      ...(await getSettings(env)),
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || ""
    });
  }
  if (request.method === "GET" && path === "/api/gallery") {
    return publicWall(request, env);
  }
  if (request.method === "POST" && path === "/api/submissions") {
    return handleSubmission(request, env, ctx);
  }
  if (request.method === "DELETE" && path === "/api/receipt/submission") {
    return removeOwnSubmission(request, env);
  }
  if (request.method === "POST" && path === "/api/receipt/lookup") {
    return lookupReceipt(request, env);
  }
  const receiptImageMatch = path.match(/^\/api\/receipt\/media\/([a-f0-9-]+)$/i);
  if (request.method === "POST" && receiptImageMatch) {
    return receiptMedia(request, env, receiptImageMatch[1]);
  }
  if (request.method === "POST" && path === "/api/admin/login") {
    return handleAdminLogin(request, env);
  }

  const authFailure = await requireAdmin(request, env);
  if (authFailure) return authFailure;

  if (request.method === "GET" && path === "/api/admin/session") {
    return json({ ok: true, authenticated: true });
  }
  if (request.method === "POST" && path === "/api/admin/logout") return logoutResponse();
  if (request.method === "GET" && path === "/api/admin/settings") {
    return json({ ok: true, ...(await getSettings(env)) });
  }
  if (request.method === "PATCH" && path === "/api/admin/settings") {
    return updateSettings(request, env);
  }
  if (request.method === "GET" && path === "/api/admin/submissions") {
    return listSubmissions(request, env);
  }

  const submissionMatch = path.match(/^\/api\/admin\/submissions\/([a-f0-9-]+)$/i);
  if (request.method === "PATCH" && submissionMatch) {
    return updateSubmission(request, env, submissionMatch[1]);
  }
  if (request.method === "DELETE" && submissionMatch) {
    return removeSubmission(env, submissionMatch[1]);
  }
  const visibilityMatch = path.match(/^\/api\/admin\/submissions\/([a-f0-9-]+)\/public$/i);
  if (request.method === "PATCH" && visibilityMatch) {
    return changePublication(request, env, visibilityMatch[1]);
  }
  const replyMatch = path.match(/^\/api\/admin\/submissions\/([a-f0-9-]+)\/reply$/i);
  if (request.method === "POST" && replyMatch) {
    return saveReply(request, env, replyMatch[1], ctx);
  }
  const adminReplyImageMatch = path.match(/^\/api\/admin\/reply-media\/([a-f0-9-]+)$/i);
  if (request.method === "GET" && adminReplyImageMatch) {
    return adminReplyMedia(env, adminReplyImageMatch[1]);
  }
  const mediaMatch = path.match(/^\/api\/admin\/media\/([a-f0-9-]+)$/i);
  if (request.method === "GET" && mediaMatch) {
    return serveAttachment(env, mediaMatch[1]);
  }
  return fail("没有找到这个接口。", 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await routeApi(request, env, ctx);
      const response = await env.ASSETS.fetch(request);
      return applySecurityHeaders(response);
    } catch (error) {
      console.error("snowgrain radio request failed", error);
      if (url.pathname.startsWith("/api/")) return fail("电台刚才短暂失去了信号。", 500);
      return new Response("雪粒电台暂时失去信号。", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }
  }
};
