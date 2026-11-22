# Snowgrain Radio / 雪粒电台

Snowgrain Radio is a small self-hosted signal box for anonymous text, private image uploads, and one deliberately simple custom form.

The reference deployment is planned for https://radio.elementeracoast.com.

## What it contains

- a public text-and-image signal form
- a second text-and-email form with independent copy
- independent open/closed switches for both channels
- a mobile-friendly private control room
- private R2 media objects
- D1 records and status tracking
- encrypted email addresses at rest
- Turnstile verification and privacy-preserving rate limiting
- an optional signed webhook containing only event metadata

No submissions, email addresses, uploaded images, device tokens, passwords, or deployment secrets belong in this repository.

## Runtime

- Cloudflare Workers with Static Assets
- Cloudflare D1
- Cloudflare R2
- Cloudflare Turnstile
- Node.js 22 or newer for local checks

## Local setup

1. Install dependencies.

       npm install

2. Copy the example secrets file.

       cp .dev.vars.example .dev.vars

3. Replace the example values. A 32-byte email encryption key can be generated with:

       openssl rand -base64 32

4. Create or select a D1 database and R2 bucket, then replace the placeholder database ID and bucket name in wrangler.jsonc.

5. Apply the local schema and start the Worker.

       npm run db:migrate:local
       npm run dev

Turnstile test keys in wrangler.jsonc and .dev.vars.example are for development only.

## Production setup

Create a D1 database, an R2 bucket, and a Turnstile widget for the production hostname. Configure these Worker secrets:

- ADMIN_TOKEN
- ADMIN_SESSION_SECRET
- EMAIL_ENCRYPTION_KEY
- RATE_LIMIT_SECRET
- TURNSTILE_SECRET

Optional signal delivery uses:

- SIGNAL_WEBHOOK_URL
- SIGNAL_WEBHOOK_SECRET

Set ENVIRONMENT to production, replace TURNSTILE_SITE_KEY with the production site key, apply remote migrations, and deploy.

       npm run db:migrate:remote
       npm run deploy

The reference custom domain is configured separately as radio.elementeracoast.com.

## Signal webhook

When configured, every successful submission emits a JSON POST with no message text, email address, or image data:

       {
         "event": "snowgrain.signal.received",
         "submission_id": "...",
         "kind": "ask",
         "created_at": "..."
       }

The receiver verifies X-Snowgrain-Timestamp and X-Snowgrain-Signature. The signature is an HMAC-SHA256 hex digest of:

       timestamp + "." + raw_request_body

This is intended for push relays and other owner-controlled notification adapters.

## Privacy notes

- Email addresses are encrypted with AES-256-GCM before D1 storage.
- Uploaded media stays in a private R2 bucket and is served only through authenticated control-room routes.
- Raw IP addresses are not stored. Rate-limit keys are HMAC digests scoped to an hourly window.
- The browser attempts to re-encode images before upload, which normally removes embedded metadata. The server still treats all uploaded media as private.
- Public notification adapters should send a generic signal, not submission contents.

## License

Code is licensed under GNU AGPL-3.0-only.

The names Elementera Coast, Snowgrain Radio / 雪粒电台, their marks, and instance-specific writing are not granted as trademarks merely because the code is open source. Forks should rename their public-facing instance unless separately permitted.
