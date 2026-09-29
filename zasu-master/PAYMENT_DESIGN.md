# ZASU AUDIO Payment Design v0.1

## Public launch prices
- ZASU CONVERT: free
- ZASU MIX: JPY 500 / track
- ZASU MASTER: JPY 500 / track
- MIX + MASTER: JPY 800 / track
- No subscription at launch.

## Provider
Square Online Checkout. Existing ZASU MASTER Square infrastructure remains intact during OPEN BETA.

## Safety / launch gate
The public frontend uses `commerceEnabled: false` during OPEN BETA. No new ZASU AUDIO paid checkout is exposed until the credit ledger and completion-based consumption are deployed and tested.

## Paid-launch flow
1. Browser creates or reuses an anonymous visitor identity.
2. Buyer chooses MIX, MASTER, or FULL.
3. Backend creates a ZASU AUDIO order and a Square payment link.
4. Square webhook verifies COMPLETED payment, expected JPY amount, product identity, and Square order identity.
5. Verified payment grants track credits:
   - MIX: 1 mix credit
   - MASTER: 1 master credit
   - FULL: 1 mix credit + 1 master credit tied to the same workflow
6. Starting a processing job reserves a credit.
7. Credit is consumed only when the requested stage completes successfully.
8. Retryable/failed jobs release the reservation.
9. Duplicate payment webhooks are idempotent.
10. FULL direct handoff consumes the reserved master credit without a second checkout.

## Required schema before commerceEnabled=true
- audio_orders
- audio_credits / credit ledger
- credit reservations linked to job IDs
- Square product-specific order matching
- checkout access token / visitor authentication
- cleanup / expiry policy
- refund and support state fields

## Existing beta compatibility
OPEN BETA remains free and uses the existing beta/application access flow. Paid commerce is additive and must not alter current MIX / MASTER / CONVERT processing until explicitly enabled.
