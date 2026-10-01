# ZASU LOUD Automated Fulfillment Design

Date: 2026-10-02
Status: Approved design, implementation pending
Product: ZASU LOUD v1.1.2 for macOS
Launch price: ¥2,980 JPY

## 1. Goal

Automate delivery of ZASU LOUD after a successful Square payment.

Required buyer flow:

1. Buyer opens the ZASU LOUD product page.
2. Buyer checks out on Square.
3. Buyer provides the download destination email address in Square custom fields.
4. Square redirects to the ZASU LOUD thank-you page after checkout.
5. Square webhook confirms payment.
6. Backend independently validates the payment and order against Square.
7. Purchase is recorded in Supabase.
8. Backend creates a time-limited signed URL for the private macOS installer.
9. Resend sends the download email automatically.
10. The signed URL expires after 24 hours.

The installer must never be exposed via a permanent public URL.

## 2. Existing infrastructure to reuse

### Square
Reuse the existing `square-payment-webhook` Edge Function.

Existing protections already present:
- Square HMAC webhook signature verification.
- Event ID duplicate suppression.
- Square API order re-fetch.
- Payment amount/currency verification patterns.
- Completed-payment-only processing.

### Supabase
Reuse the existing ZASU MASTER Supabase project:
- Project ref: `siwmzradvrtetotakkbi`
- Service-role-only backend access model for internal commerce data.
- Existing Edge Function deployment model.
- Existing private Storage architecture.

### Resend
Reuse the existing Resend integration and API key stored server-side.
The fulfillment path gets its own transactional send logic rather than reusing health alert semantics.

## 3. Architecture

```
ZASU LOUD product page
        |
        v
Square Payment Link
        |
        +--> redirect --> /zasu-loud/thanks/
        |
        v
Square webhook
        |
        v
square-payment-webhook
        |
        +--> verify webhook HMAC
        +--> dedupe event_id
        +--> require COMPLETED
        +--> re-fetch Square order
        +--> verify:
        |      amount = 2980
        |      currency = JPY
        |      item/title matches ZASU LOUD
        |      buyer delivery email exists
        |
        v
zasu_loud_orders
        |
        v
Private Storage bucket
zasu-loud-releases
        |
        v
24h signed download URL
        |
        v
Resend transactional email
```

## 4. Database design

Create `public.zasu_loud_orders`.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `square_payment_id text not null unique`
- `square_order_id text not null`
- `square_event_id text`
- `buyer_email text not null`
- `product_slug text not null default 'zasu-loud-v1.1.2-macos'`
- `amount_jpy integer not null`
- `currency text not null default 'JPY'`
- `payment_status text not null default 'paid'`
- `delivery_status text not null default 'pending'`
  - allowed: pending, sent, failed
- `delivery_attempts integer not null default 0`
- `resend_message_id text`
- `delivery_error text`
- `paid_at timestamptz`
- `delivered_at timestamptz`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Security:
- RLS enabled.
- No anon/authenticated policies.
- Revoke public Data API privileges.
- Service role / postgres only.

Uniqueness:
- `square_payment_id` is the primary fulfillment idempotency boundary.
- Existing `square_webhook_events.event_id` remains webhook-event idempotency.

## 5. Storage design

Create private bucket:
- Bucket ID: `zasu-loud-releases`
- Public: false
- MIME types:
  - `application/octet-stream`
  - `application/vnd.apple.installer+xml` if supported by upload metadata
- Suggested file path:
  `v1.1.2/ZASU_LOUD_v1.1.2_macOS.pkg`

The release package remains private.

The fulfillment function generates a signed URL with:
- expiry: 86400 seconds (24 hours)
- download filename: `ZASU_LOUD_v1.1.2_macOS.pkg`

No public Storage policy is created.

## 6. Square order validation

The webhook may fulfill only when all checks pass:

1. Webhook signature is valid.
2. Event type is `payment.created` or `payment.updated`.
3. Payment status is `COMPLETED`.
4. Payment has both payment ID and order ID.
5. Payment amount = 2980.
6. Currency = JPY.
7. Order is re-fetched from Square API.
8. Order total = 2980 JPY.
9. Order line item/name identifies ZASU LOUD.
10. Download destination email is present and syntactically valid.

If any validation fails:
- do not generate a download URL.
- do not send email.
- log the reason in `square_webhook_events`.
- return HTTP 200 to Square for permanent mismatch failures to avoid endless retries.

## 7. Email extraction

Preferred source:
- Square order custom attributes containing a field whose normalized name/key includes:
  - `メール`
  - `email`
  - `ダウンロード送付先`

Fallback:
- Square buyer/customer email if present in order/payment data.

If multiple email values exist:
- prefer the explicit custom-field download email.

Normalize:
- trim whitespace
- lowercase
- validate with a conservative email syntax check

## 8. Fulfillment sequence

For a validated completed purchase:

1. Upsert / find `zasu_loud_orders` by `square_payment_id`.
2. If delivery_status = sent:
   - return success without re-sending.
3. Increment `delivery_attempts`.
4. Generate a fresh 24-hour signed URL from private Storage.
5. Send transactional email via Resend.
6. On success:
   - set `delivery_status = sent`
   - save Resend message ID
   - set delivered_at
   - clear delivery_error
7. On failure:
   - set `delivery_status = failed`
   - save sanitized failure reason
   - do not mark as delivered

The signed URL itself is not stored permanently because a future retry should generate a fresh URL.

## 9. Email content

Subject:
`ZASU LOUD v1.1.2 — ダウンロードのご案内`

Body:

- Thank buyer for purchasing ZASU LOUD.
- Display product:
  - ZASU LOUD v1.1.2 for macOS
  - AU / VST3
  - Apple Silicon
- Provide one prominent download URL.
- State:
  - link expires in 24 hours
  - package filename
  - Apple Developer ID signed / Notarized
- Provide basic installation steps.
- Support contact:
  - existing ZASU WORKS support email.

Email type is transactional, not marketing.

## 10. Thank-you page

Existing page:
`https://zasuofficial.jp/zasu-loud/thanks/`

It must not expose the installer URL.

It tells the buyer:
- payment is complete
- check the email used for download delivery
- check spam folder if needed
- contact support if the message does not arrive

## 11. Failure and retry behavior

### Duplicate Square webhook
Return success without duplicate fulfillment.

### Resend temporary failure
Keep `delivery_status = failed`.
A retry path can safely re-run fulfillment because payment ID is idempotent.

### Storage signing failure
No email is sent.
Order remains failed for retry.

### Buyer entered invalid email
No fulfillment is sent.
Record failure reason for manual support recovery.

### Wrong price/product
Never fulfill.

## 12. Admin / operational visibility

Phase 1:
- fulfillment state visible directly in `zasu_loud_orders`.

Recommended fields to inspect:
- buyer_email
- square_payment_id
- delivery_status
- delivery_attempts
- delivered_at
- delivery_error

Phase 2, deferred:
- Add a ZASU LOUD sales card to the existing admin dashboard.
- Add manual resend button.
- Add purchase count / gross revenue stats.

## 13. Security requirements

- Never expose Supabase service role key to frontend.
- Never expose Resend API key.
- Never make the release bucket public.
- Verify Square webhook signature before parsing/processing trusted fields.
- Re-fetch the order from Square before fulfillment.
- Verify exact amount/currency/product server-side.
- Deduplicate on both webhook event ID and Square payment ID.
- Keep purchase tables service-only.
- Do not log signed URLs.
- Do not store raw payment card data.
- Do not trust the public thank-you redirect as proof of payment.

## 14. Testing

### Database
- Table exists with RLS enabled.
- anon/authenticated cannot select/insert/update/delete.
- unique payment ID constraint works.

### Storage
- bucket is private.
- unsigned public URL cannot download.
- signed URL works.
- signed URL expires.

### Webhook
Test cases:
- invalid signature -> 403.
- non-payment event -> ignored.
- incomplete payment -> ignored.
- wrong price -> no fulfillment.
- wrong currency -> no fulfillment.
- wrong product name -> no fulfillment.
- missing email -> no fulfillment.
- valid purchase -> one order + one email.
- duplicate webhook -> no second email.
- second event for same payment -> no second email.

### Email
- correct recipient.
- correct version and platform.
- 24-hour link present.
- Resend message ID saved.

## 15. Release dependency

Implementation can be deployed before the installer is uploaded.

Production fulfillment must remain effectively inactive until:
- `v1.1.2/ZASU_LOUD_v1.1.2_macOS.pkg` exists in the private bucket.

The final activation test should use either:
- a controlled Square sandbox flow, or
- a production ¥2,980 purchase only if the user explicitly chooses to perform a real payment.

## 16. Deferred scope

Not part of the first automated fulfillment release:
- license-key DRM
- device activation
- customer account portal
- refund-triggered download revocation
- automatic version update service
- Windows release
- Intel / Universal 2 build
- sales analytics dashboard
