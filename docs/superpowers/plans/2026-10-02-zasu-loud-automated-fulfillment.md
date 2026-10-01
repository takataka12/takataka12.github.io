# ZASU LOUD Automated Fulfillment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically deliver the private ZASU LOUD v1.1.2 macOS installer by email after a verified ¥2,980 Square payment.

**Architecture:** Extend the existing `square-payment-webhook` instead of creating a second Square ingress. Keep ZASU LOUD validation and fulfillment in a focused helper module with dependency injection so product matching, email extraction, idempotency, signed-URL creation, and Resend delivery can be tested without real payments. Store the installer in a private Supabase Storage bucket and issue a fresh 24-hour signed URL only after server-side Square revalidation.

**Tech Stack:** Supabase Postgres + RLS, Supabase Storage, Supabase Edge Functions (Deno), `@supabase/supabase-js@2.95.0`, Square Orders/Payments APIs (Square-Version `2026-09-16`), Resend transactional email, Deno tests.

**Spec:** `docs/superpowers/specs/2026-10-02-zasu-loud-automated-fulfillment-design.md`

## Global Constraints

- Product: `ZASU LOUD v1.1.2 for macOS`.
- Launch price: exactly `2980 JPY`.
- Release object path: `v1.1.2/ZASU_LOUD_v1.1.2_macOS.pkg`.
- Release bucket: `zasu-loud-releases`, private.
- Signed download URL lifetime: exactly `86400` seconds (24 hours).
- Public frontend never receives Supabase service-role or Resend secrets.
- Fulfillment requires a valid Square webhook signature, a `COMPLETED` payment, and a Square API re-fetch.
- Payment amount, currency, and product identity must all match server-side before fulfillment.
- Purchase tables remain service-role-only with RLS enabled and no anon/authenticated policies.
- Deduplicate by both Square `event_id` and `square_payment_id`.
- Never persist or log the signed download URL.
- Do not expose a permanent public installer URL.
- Email is transactional, not marketing.
- Existing ZASU MASTER and ZASU AUDIO commerce flows must retain their current behavior.

## Review Focus

- **A Square order has ¥2,980 JPY but is not ZASU LOUD:** must return `not_zasu_loud` and never create a purchase row or send mail. Covered in Task 2 validation tests.
- **The custom email field is missing but Square exposes a buyer email:** must use the buyer email fallback; if neither is valid, fail closed. Covered in Task 2 extraction tests.
- **Square sends both `payment.created` and `payment.updated` for the same payment:** only one delivery may be sent. Covered in Task 3 idempotency tests.
- **Resend succeeds but a later duplicate webhook arrives:** the existing `sent` row must short-circuit before generating a second signed URL/email. Covered in Task 3 tests.
- **The installer object is missing or URL signing fails:** no email may be sent and the purchase remains retryable with `delivery_status='failed'`. Covered in Task 3 failure tests.

---

## File Structure

Backend source-of-truth will live in `takataka12/zasu-audio-engine`:

- `supabase/migrations/20261002_zasu_loud_fulfillment.sql` — database table, constraints, RLS, grants, private Storage bucket.
- `supabase/functions/square-payment-webhook/index.ts` — mirrored current production webhook plus the additive ZASU LOUD dispatch branch.
- `supabase/functions/square-payment-webhook/zasu_loud_core.ts` — pure normalization, product validation, email extraction, and email composition.
- `supabase/functions/square-payment-webhook/zasu_loud_fulfillment.ts` — side-effect orchestration behind injected dependencies.
- `supabase/functions/square-payment-webhook/zasu_loud_core_test.ts` — pure validation/extraction tests.
- `supabase/functions/square-payment-webhook/zasu_loud_fulfillment_test.ts` — idempotency, signed URL, and email delivery behavior with fakes.

Deployment remains through the existing Supabase project `siwmzradvrtetotakkbi`.

---

### Task 1: Create service-only purchase storage and private release bucket

**Files:**
- Create: `supabase/migrations/20261002_zasu_loud_fulfillment.sql`

**Interfaces:**
- Consumes: none.
- Produces:
  - table `public.zasu_loud_orders`
  - unique key `zasu_loud_orders.square_payment_id`
  - private bucket `storage.buckets.id='zasu-loud-releases'`

- [ ] **Step 1: Write the migration SQL**

Migration must create `public.zasu_loud_orders` with the columns and checks from the spec, including:
- `delivery_status in ('pending','sent','failed')`
- `payment_status='paid'` for the initial release
- `amount_jpy > 0`
- unique `square_payment_id`

It must:
- enable RLS,
- revoke table privileges from `anon` and `authenticated`,
- avoid public policies,
- create the private Storage bucket with `public=false`,
- use `application/octet-stream` as an allowed MIME type,
- set a file-size limit comfortably above the current ~3 MB package (50 MB is sufficient).

- [ ] **Step 2: Apply the migration to project `siwmzradvrtetotakkbi`**

Use the Supabase migration tool once the SQL is final.

Expected: migration succeeds without destructive changes to existing commerce tables.

- [ ] **Step 3: Verify database security and bucket state**

Run read-only verification queries asserting:
- RLS enabled on `zasu_loud_orders`.
- `anon` and `authenticated` have no table privileges.
- no RLS policies exist for the table.
- `zasu-loud-releases.public = false`.
- bucket allowed MIME types include `application/octet-stream`.

Expected: all assertions true.

- [ ] **Step 4: Run Supabase security advisors**

Use the Supabase security advisor.

Expected: no new WARN/ERROR attributable to `zasu_loud_orders` or the release bucket.

- [ ] **Step 5: Commit backend source**

```bash
git add supabase/migrations/20261002_zasu_loud_fulfillment.sql
git commit -m "feat: add ZASU LOUD fulfillment storage"
```

---

### Task 2: Implement pure Square order validation and delivery-email extraction

**Files:**
- Create: `supabase/functions/square-payment-webhook/zasu_loud_core.ts`
- Create: `supabase/functions/square-payment-webhook/zasu_loud_core_test.ts`

**Interfaces:**
- Consumes: Square payment/order/custom-attribute JSON.
- Produces:
  - `normalizeLabel(value: unknown): string`
  - `validEmail(value: unknown): string | null`
  - `extractDeliveryEmail(attrs: unknown[], fallbackEmail?: unknown): string | null`
  - `validateZasuLoudOrder(payment: unknown, order: unknown): { ok: true } | { ok: false; reason: string }`
  - `buildZasuLoudEmail(input: { downloadUrl: string; expiresHours: number }): { subject: string; text: string; html: string }`

- [ ] **Step 1: Write failing core tests**

Tests must assert:
- exact `2980 JPY` + a line item whose normalized name contains `zasu loud` passes.
- `3500 JPY`, wrong currency, or non-ZASU product fails.
- case/spacing variants such as `ZASU  LOUD v1.1.2 for macOS` still match.
- explicit custom field names containing `ダウンロード送付先`, `メール`, or `email` are preferred.
- invalid explicit custom email falls back to valid buyer email.
- no valid email returns `null`.
- email copy contains `ZASU LOUD v1.1.2`, `AU / VST3`, `Apple Silicon`, and `24時間`.

- [ ] **Step 2: Run tests and verify they fail**

Run:
```bash
deno test supabase/functions/square-payment-webhook/zasu_loud_core_test.ts
```

Expected: FAIL because the core module/functions do not exist.

- [ ] **Step 3: Implement the pure core functions**

Use exact constants:
- amount `2980`
- currency `JPY`
- version `v1.1.2`
- signed-link message `24時間`

No network, database, Storage, or Resend calls belong in this file.

- [ ] **Step 4: Run core tests**

Run:
```bash
deno test supabase/functions/square-payment-webhook/zasu_loud_core_test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/square-payment-webhook/zasu_loud_core.ts supabase/functions/square-payment-webhook/zasu_loud_core_test.ts
git commit -m "feat: validate ZASU LOUD purchases"
```

---

### Task 3: Implement idempotent fulfillment orchestration

**Files:**
- Create: `supabase/functions/square-payment-webhook/zasu_loud_fulfillment.ts`
- Create: `supabase/functions/square-payment-webhook/zasu_loud_fulfillment_test.ts`

**Interfaces:**
- Consumes:
  - Task 2 core functions.
  - `FulfillmentDeps` injected interface for DB, Square custom attributes, Storage signing, and Resend.
- Produces:
  - `fulfillZasuLoudPurchase(input: FulfillmentInput, deps: FulfillmentDeps): Promise<FulfillmentResult>`
  - results: `not_zasu_loud`, `missing_email`, `already_sent`, `sent`, `failed`

`FulfillmentInput` must contain:
- `eventId: string`
- `payment: unknown`
- `order: unknown`
- `fallbackEmail?: unknown`

`FulfillmentDeps` must expose focused methods:
- `listOrderCustomAttributes(orderId: string): Promise<unknown[]>`
- `findOrderByPaymentId(paymentId: string): Promise<ZasuLoudOrderRow | null>`
- `upsertPendingOrder(row: PendingOrderInput): Promise<ZasuLoudOrderRow>`
- `markAttempt(id: string): Promise<void>`
- `markSent(id: string, resendMessageId: string): Promise<void>`
- `markFailed(id: string, message: string): Promise<void>`
- `createDownloadUrl(): Promise<string>`
- `sendEmail(to: string, message: EmailMessage, idempotencyKey: string): Promise<string>`

- [ ] **Step 1: Write failing orchestration tests**

Use fake dependencies to assert:
- valid purchase creates a 24-hour URL and sends once.
- already-sent payment returns `already_sent` before URL creation or email.
- two different Square event IDs for the same payment still send once.
- missing installer/signing error marks delivery failed and does not send.
- Resend failure marks delivery failed and leaves purchase retryable.
- missing email creates no signed URL and sends nothing.
- non-ZASU purchase writes no ZASU LOUD order.

- [ ] **Step 2: Run tests and verify failure**

Run:
```bash
deno test supabase/functions/square-payment-webhook/zasu_loud_fulfillment_test.ts
```

Expected: FAIL because the orchestration module does not exist.

- [ ] **Step 3: Implement `fulfillZasuLoudPurchase`**

Required ordering:
1. validate product/amount/currency,
2. resolve email,
3. check existing row by payment ID,
4. short-circuit `sent`,
5. upsert pending purchase,
6. increment attempt,
7. create a fresh signed URL,
8. send Resend email with idempotency key `zasu-loud/<square_payment_id>`,
9. mark sent or failed.

Never persist the signed URL.

- [ ] **Step 4: Run fulfillment tests**

Run:
```bash
deno test supabase/functions/square-payment-webhook/zasu_loud_fulfillment_test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all ZASU LOUD tests**

Run:
```bash
deno test supabase/functions/square-payment-webhook/*_test.ts
```

Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/square-payment-webhook/zasu_loud_fulfillment.ts supabase/functions/square-payment-webhook/zasu_loud_fulfillment_test.ts
git commit -m "feat: automate ZASU LOUD fulfillment"
```

---

### Task 4: Integrate fulfillment into the production Square webhook

**Files:**
- Create mirror from production then modify: `supabase/functions/square-payment-webhook/index.ts`
- Modify: deployed Supabase Edge Function `square-payment-webhook`

**Interfaces:**
- Consumes: `fulfillZasuLoudPurchase` from Task 3 and existing Square API helper/authentication.
- Produces: additive ZASU LOUD commerce path while preserving ZASU AUDIO and ZASU MASTER behavior.

- [ ] **Step 1: Mirror current production v6 source into backend repository**

The initial `index.ts` must match the currently deployed v6 before edits.

- [ ] **Step 2: Add real dependency adapters**

Adapters must:
- list order custom attributes using `GET /v2/orders/{order_id}/custom-attributes?visibility_filter=ALL&limit=100&with_definitions=true`;
- read/write `zasu_loud_orders` only through service-role Supabase;
- create `86400` second signed URL for `zasu-loud-releases/v1.1.2/ZASU_LOUD_v1.1.2_macOS.pkg` with download filename enabled;
- obtain existing server-side Resend configuration without exposing it to clients;
- send with Resend `Idempotency-Key: zasu-loud/<square_payment_id>`.

- [ ] **Step 3: Insert the ZASU LOUD branch without altering existing flows**

After existing ZASU AUDIO order lookup fails, use the already re-fetched Square order (or fetch it once) to try ZASU LOUD fulfillment **before** the legacy `500 JPY` ZASU MASTER check.

Routing requirements:
- `sent` / `already_sent`: mark `square_webhook_events.result` with a ZASU LOUD-specific success result and return 200.
- `not_zasu_loud`: continue into the unchanged ZASU MASTER legacy branch.
- permanent ZASU LOUD mismatch such as missing email: log the reason and return 200 without fulfillment.
- transient Storage/Resend failure: record failed delivery and return 200; manual/controlled retry will use the payment ID idempotency boundary.

- [ ] **Step 4: Run all local helper tests**

Run:
```bash
deno test supabase/functions/square-payment-webhook/*_test.ts
```

Expected: PASS, 0 failures.

- [ ] **Step 5: Deploy `square-payment-webhook` with `verify_jwt=false`**

This remains a public webhook endpoint, but it must continue enforcing Square HMAC authentication in the function body.

Expected: new deployed version becomes ACTIVE.

- [ ] **Step 6: Verify invalid-signature behavior**

Send a synthetic POST without a valid Square signature.

Expected:
- HTTP `403`
- body contains `invalid_signature`
- no `zasu_loud_orders` row created.

- [ ] **Step 7: Verify existing commerce paths remain present**

Inspect deployed source and confirm:
- ZASU AUDIO path still exists.
- ZASU MASTER paid-beta path still exists.
- `unexpected_amount_or_currency` remains only after the new ZASU LOUD branch.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/square-payment-webhook/index.ts
git commit -m "feat: fulfill ZASU LOUD from Square webhook"
```

---

### Task 5: Verify Resend transport and prepare the private release object

**Files:**
- No source change required unless transport configuration needs a documented fix.

**Interfaces:**
- Consumes:
  - existing Resend API key/server config
  - private bucket from Task 1
  - local release artifact `ZASU_LOUD_v1.1.2_macOS.pkg`
- Produces:
  - verified outbound email transport
  - Storage object at `v1.1.2/ZASU_LOUD_v1.1.2_macOS.pkg`

- [ ] **Step 1: Check Resend domain readiness**

Verify the configured sending domain is actually verified and can send transactional mail.

Expected: domain verified and API key active.

If still pending, stop activation here; backend code may remain deployed, but no live fulfillment test is performed until DNS verification completes.

- [ ] **Step 2: Obtain the exact release package**

Use the already notarized/stapled/validated:
`ZASU_LOUD_v1.1.2_macOS.pkg`.

Do not substitute a rebuild.

- [ ] **Step 3: Upload the package to private Storage**

Destination:
`zasu-loud-releases/v1.1.2/ZASU_LOUD_v1.1.2_macOS.pkg`

Expected:
- object exists,
- bucket remains private,
- object MIME is acceptable.

If agent-side Storage upload is unavailable, this is the one explicit operator step: upload the exact package in the Supabase Dashboard to the exact path above, then resume verification.

- [ ] **Step 4: Verify private/public behavior**

Expected:
- unsigned public object URL does not return the package.
- service-role signed URL with `expiresIn=60` downloads the package.

- [ ] **Step 5: Verify SHA-256 against the release master**

Compute SHA-256 before upload and after download.

Expected: hashes match exactly.

---

### Task 6: End-to-end activation and production safety verification

**Files:**
- No new code unless a test reveals a defect.

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: live automated fulfillment readiness.

- [ ] **Step 1: Run Supabase security advisor again**

Expected: no new security WARN/ERROR caused by this feature.

- [ ] **Step 2: Verify schema and production function state**

Assert:
- `zasu_loud_orders` RLS enabled.
- no anon/authenticated grants.
- bucket private.
- webhook ACTIVE.
- installer object present.

- [ ] **Step 3: Run a controlled negative production probe**

POST unsigned synthetic payment data to webhook.

Expected: 403 before any purchase logic.

- [ ] **Step 4: Choose the final positive-payment test path**

Preferred order:
1. Square sandbox if the existing production webhook can be tested without changing production secrets.
2. Otherwise a real production purchase only with explicit user approval.

Do **not** fabricate or bypass Square signature verification for this test.

- [ ] **Step 5: Execute one valid positive checkout**

Expected:
- Square reports COMPLETED.
- exactly one `zasu_loud_orders` row.
- amount `2980`, currency `JPY`.
- `delivery_status='sent'`.
- `delivery_attempts=1`.
- `resend_message_id` populated.
- buyer receives download email.
- link downloads the exact notarized package.

- [ ] **Step 6: Verify duplicate protection**

Replay/observe a second webhook event for the same payment.

Expected:
- still one order row.
- no second Resend delivery.
- no duplicate fulfillment.

- [ ] **Step 7: Verify user-facing flow**

From `https://zasuofficial.jp/zasu-loud/`:
- BUY NOW opens the Square payment link.
- Square checkout requests the download destination email.
- successful checkout redirects to `https://zasuofficial.jp/zasu-loud/thanks/`.
- thank-you page exposes no permanent package URL.

- [ ] **Step 8: Final commit if verification required any source fixes**

```bash
git add supabase/
git commit -m "fix: harden ZASU LOUD fulfillment"
```
