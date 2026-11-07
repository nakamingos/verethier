# Verification incident follow-up — November 7, 2026

## Mobile browser storage

An iPhone/Safari-style wallet picker reported `Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.` This is browser storage used by the wallet connection SDK, not Bouncer's Supabase database.

The installed `idb-keyval` 6.2.1 cached its database connection indefinitely. The upstream 6.2.2 patch resets the cached connection when the browser reports an unexpected close. The frontend resolution pins 6.2.2 across the wallet dependencies without changing AppKit/WalletConnect versions or clearing saved storage. The wallet error bridge also gives reload/reconnect guidance when this failure is reported.

`npm run test:storage-smoke` uses real Chromium IndexedDB and models the unexpected-close event. The same test reproduced the exact reported error with the cached 6.2.1 source and passes with 6.2.2, retaining the synthetic session and concurrent reads/writes. This tests the recovery path, not an actual iPhone or every possible storage-initialization failure. No signatures are retried automatically.

Upstream: [6.2.2 createStore implementation](https://github.com/jakearchibald/idb-keyval/blob/v6.2.2/src/index.ts).

## Desktop verification and privacy/error overlap

The reported “missing those offers. Normal Bouncer verification and role checks still work.” is existing privacy explanatory text. It is not an application error message. The old desktop step panel had a fixed height and absolutely positioned content; privacy disclosures could grow past it, so the notification overlapped the disclosure text.

The active step now participates in normal flow at all widths. Inactive steps are hidden, error messages use an alert live region and long error text can wrap. Browser regression cases verify an API failure appears after the complete panel at 1280, 768, 393 and 320px, leaves signing available, and does not request another signature automatically.

The repeated desktop verification failure itself is not diagnosed by that screenshot. Await the affected wallet/browser and the actual error once readable. Do not treat the privacy sentence as a backend eligibility or privacy-consent rejection.

## MetaMask domain warning

The member confirmed the production domain. The operator independently reproduced the warning and reports it during both connecting and signing. The private verification token was not used for reputation checks or included in documentation.

MetaMask's public checker said the domain was not blocked; there was no direct domain/parent match in the public static configuration. The public HTML and two entry scripts matched the expected local production artifacts. MetaMask also uses separate live reputation checks, which returned 403 to this investigation. The reason for the member's warning remains unconfirmed; there is no application-side switch that should suppress wallet security warnings.

The exact screenshot text matches MetaMask's current upstream trust-signal modal. The connection gate displays it when the hostname's URL-scan cache recommends blocking. Signature confirmations also read the same origin trust state, so a hostname classification can explain alerts at both stages. This narrows the investigation; it does not identify the classification's underlying reason or rule out another signature-specific alert. The operator reports Chrome 155.0.8059.39 (Official Build), x86_64, and MetaMask 13.55.0. The same source paths were checked against the v13.55.0 tag. The supplied connection and signing text explicitly labels the site malicious; the typed-data schema matches the expected Ethereum `Verification` message. No provider-specific reason was included. Personal identifiers and nonce values were not retained. Source references and sanitized details are preserved in the review draft.

A [support-review draft](metamask-domain-review-draft.md) records the intended signature flow, bounded checks, public evidence and missing client details. It has not been sent. MetaMask's current support guidance is the route for a URL classification review.

## Validation and release

The production frontend build, storage recovery regression, 50 targeted Angular wallet/verification tests, the EVM wallet browser suite (including privacy/error cases, signing/session reuse and Base accounts), Stamps browser checks and Solana signature browser checks passed. Browser fixtures use synthetic keys and mocked verification APIs; they do not prove compatibility with the affected users' actual wallet apps.

These fixes are local and unpushed. No backend behavior, database schema, wallet associations, privacy decisions or wallet security protections were changed.

Outstanding: affected desktop wallet/browser and actual error; real iOS follow-up after release; MetaMask classification review and remaining affected-client details. The holder-analysis branch remains separate.
