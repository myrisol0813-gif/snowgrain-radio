# Flurry Radio / 雪粒电台

Flurry Radio is a small self-hosted signal box for anonymous text, private image uploads, and one deliberately simple custom form.

The reference deployment is https://radio.elementeracoast.com. The existing repository, Worker, D1/R2 identifiers and webhook event names retain the legacy `snowgrain` technical prefix for compatibility; the public-facing English name is Flurry Radio.

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

Set ENVIRONMENT to production, replace TURNSTILE_SITE_KEY with the production site key, and keep runtime secrets in the Cloudflare Worker settings.

Production deployment is now **one ordered command**, which performs checks, applies pending remote D1 migrations and deploys the Worker only when migration succeeds:

       npm run deploy

Cloudflare Workers Builds remains the **only production deployment executor** (not GitHub Actions). In the Cloudflare dashboard, under this Worker's **Settings → Build**, configure:

- Production branch: `main`
- Build command: empty
- Deploy command: `npm run deploy`
- Preview command: `npx wrangler preview` (never apply production migrations from previews)
- Build API token: the existing Workers Builds token, explicitly extended with **Account → D1 → Edit** for this account. Cloudflare's auto-created build token does not include D1 Edit by default. Do not paste any token into this repository or into chat.

The sequence is fail-closed: `npm run check` → `wrangler d1 migrations apply DB --remote` → `wrangler deploy`. Failures stop deployment; they do **not** roll back already-applied migrations. Only add backwards-compatible migrations, and make database backups before destructive changes. The initial `0001_initial.sql` was previously executed in D1 Console, not Wrangler's migration history; the first automated run may reapply it, but all initial schema statements use `IF NOT EXISTS` / `OR IGNORE` and are designed to be idempotent.

The reference custom domain is configured separately as radio.elementeracoast.com.

## V1.1 draft: Snow Letter + pickup/replies

The visitor pages use a responsive browser adaptation of the Native Snow Letter
paper outline, gold paperclip, pale blue edge and subtle shadow. The paper grows
with the contents.

For the ordinary `ask` channel, a successful submission returns one
cryptographically random 192-bit pickup code, displayed once. The server stores
only a SHA-256 digest of that high-entropy code.
Visitors can enter the code at `/pickup/` to see **only** the owner's reply.
Unanswered letters remain pending without exposing other submissions.
The owner's `/admin/` page now includes a reply form for each ask with
text (up to 12,000 characters) and up to four private R2 images. Replacing
reply images is explicit. The `tuft` channel retains its email-based delivery
and deliberately has **no** pickup code or queue progress.

**V1.1 release order once Workers Builds is configured:**
1. Confirm the Deploy command is `npm run deploy` and that the build API token has D1 Edit access.
2. Confirm the draft PR's GitHub Actions CI passes and then merge the PR to `main`.
3. Cloudflare automatically checks, applies `0001_initial.sql` if not already tracked, applies `0002_replies.sql`, and deploys only after these steps succeed.
4. In D1 Console verify `receipt_tokens`, `replies` and `reply_attachments` are present. Existing submissions should still be intact.
5. Test a new ordinary ask submission and copy its code; the pickup page should show pending. Reply with text/image in `/admin/`, then retrieve it with the code.
6. Test an incorrect code and a tuft submission (which should never receive a code).

Do not merge until the Cloudflare Deploy command and build token are configured; the existing default `npx wrangler deploy` bypasses the remote migration step.

Earlier ordinary submissions created before V1.1 do not have pickup codes; they
are still visible to the owner but cannot be retrospectively claimed by visitors.
Rotating RATE_LIMIT_SECRET does not invalidate existing pickup codes. The reply text/images live in D1/R2 and remain
private behind the matching code.

**Notifications:** The existing signed metadata-only webhook remains optional
and has not been connected to the Elementera Coast native Android app. The native
app currently has no push receiver/permission configured in this repository.
Do not claim that installing this branch alone provides Android notifications.
That follow-up requires implementing and securing a dedicated receiver,
notification delivery, and APK build.

## V1.2: compact letters, private reference pictures, and public wall

- The Native-inspired stationery remains unchanged in its torn edge, paperclip
  color and paper shade. Controls and typography are smaller; reply editors in
  the private control room are folded until requested.
- Both ask and tuft forms can accept 1–4 JPG/PNG/WebP private images (6 MB
  per image, 20 MB total), along with their existing text/email rules.
- The pickup link is more visible; code holders can delete their own ask
  submission and its reply after explicit browser confirmation.
- The owner can permanently delete any submission from /admin/, including
  private original and reply attachments. The UI asks for confirmation first.
- /gallery/ displays **text-only** questions and replies. A letter appears
  there **only** if the visitor voluntarily opts in to publication at
  submission time AND the owner explicitly enables public display after a
  text reply is saved. Default is always private. Email addresses, internal
  IDs, receipt codes, original images and reply images are never made public.
  Legacy ask submissions have no public consent and cannot be published.
- Removing a submission removes it from the public wall and invalidates
  its pickup code. Revoking publication in /admin/ hides the entry again.

### Database release

\`migrations/0003_public_wall.sql\` only adds two default-false submission
flags and an index; it does not remove or rewrite existing letters.
The existing Cloudflare Workers Builds production command \`npm run deploy\`
must continue to run checks, remote D1 migrations, then Worker deploy.
Before merging, confirm CI and check that preview branches remain disabled
unless an isolated preview D1/R2 environment has been set up.

**Acceptance:** on a phone, check both forms' compact layout and image
previews/removal, submit a private tuft with an image, verify inbox filtering
and media reveal, submit an ask without public consent and verify it never
appears on /gallery/, submit a consented ask, send a text reply in /admin/,
then manually publish it. Verify /gallery/ shows only question and text reply.
Revoke publication. Test wrong pickup code, owner deletion and code-holder
deletion on disposable test letters only. Confirm deletion after R2 cleanup
and that unrelated letters remain accessible.

## V1.3: nicknames, letter cards and a private notification bell

- Anonymous ask senders can optionally write a small nickname or anonymous ID (maximum 36 characters). It appears in the private owner inbox and only on an explicitly consented, owner-approved public text question/reply. Older or unnamed letters have no nickname.
- The gallery displays each public text question and reply on an independent light paper card. Pictures, emails, receipt codes and internal identifiers never appear there.
- Tuft email remains REQUIRED. The form placeholder reads “填写邮箱，用来接收成图”, with no brackets.
- The owner control room has a voluntary browser Web Push bell. On HTTPS, click “开启此设备提醒” and grant browser/OS notification permissions. Notifications may arrive after the tab closes, subject to browser and Android power restrictions. This is browser push, NOT a Native APK notification integration.
- The service worker displays only the fixed generic sentence “雪粒电台收到新信号” and no notification payload. The Worker does not send letter contents, images, nicknames, emails, admin tokens, or receipt codes to the push server. Owner can disable the current device or revoke all devices; at most eight devices are allowed.
- The VAPID signing key is generated on first owner opt-in, encrypted at rest with AES-GCM under a key derived from the existing admin secret, and never committed to the repository. Rotation of the admin secret may require reinitializing the encrypted push key and re-registering devices.
- Only known browser push service hosts are allowed for subscription endpoints; the old signed webhook is optional and unchanged.
- migrations/0004_nicknames.sql adds the optional backward-compatible nickname column, and migrations/0005_web_push.sql creates private push tables. Automatic deployment applies remote migrations before Worker publish.

### V1.3 acceptance

1. Verify successful production build, D1 migration, and new code before sending real letters.
2. Submit test questions with and without nicknames. Consent, reply, and publish the first in the private control room. Check that only the intended nickname and text pair show in the gallery.
3. On a narrow mobile screen, check independent paper cards and that older public questions are unaffected.
4. Confirm tuft email is still required and its new placeholder is visible.
5. Sign into /admin/ on a supported Android browser, opt in to Web Push, allow notifications, and send a disposable letter from another device. Confirm only a generic notification appears, including with the browser tab closed when the OS permits.
6. Disable this device and verify no new push. Use global revoke with care because it removes every device registration.

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

The names Elementera Coast, Flurry Radio / 雪粒电台, their marks, and instance-specific writing are not granted as trademarks merely because the code is open source. Forks should rename their public-facing instance unless separately permitted.
