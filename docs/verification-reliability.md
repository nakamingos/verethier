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

## Verification failure displayed as OK

A subsequent screenshot from the affected desktop member shows the error below the complete panel, confirming the overlap is absent in that capture. The member is using Rabby on Chrome; the exact browser/extension versions and whether the notification appeared after signature approval are not yet known.

The verification error handler fell back to the HTTP `statusText` when the response lacked a usable error message. That label can be `OK` even when HttpClient rejects the response. Unit regressions reproduced `OK` for error statuses with missing messages; a real Chromium regression reproduced the exact `OK` notification after a synthetic signature when the mocked endpoint returned HTTP 200 with plain-text `OK` instead of JSON. These are demonstrated ways to trigger the misleading text, not proof of the affected member's actual response.

The error handler now preserves meaningful server messages and rate-limit guidance, explains network failures and unreadable HTTP 2xx responses, and includes the HTTP status for otherwise unexplained failures. Status labels, bare `OK` and HTML error pages are not used as explanations. The same HTTP handling covers Bitcoin/Solana challenge failures. Wallet signing errors retain their existing messages. The change does not retry signatures or change ownership/authentication decisions.

Validation: 46 targeted wallet/verification unit tests, the production frontend build and the complete EVM wallet browser suite passed. The unreadable-response browser case passed at 1280, 768, 393 and 320px, with the alert below the active panel and no automatic signature retry. Desktop/mobile screenshots were inspected. The unit and browser regressions reproduced the old failure before the fix.

The error-message fix was pushed to `main` in `f7073dc`. A subsequent screenshot shows a generic backend failure rather than the HTTP status label. The database investigation below identifies an explicit restriction affecting this wallet.

## Linked database follow-up: explicit wallet restriction

Read-only inspection of the linked production database on November 7 found an existing block for the wallet shown in the affected member's screenshots, in the same community. No recent proof or privacy-choice event was present for that member. The database migrations, wallet-link function signature and grants, and wallet sequence were present; no database changes were made. The address, identity and private administrative reason are intentionally omitted from these repository notes.

`WalletBlockService.assertAllowed` rejects the blocked address before the EVM nonce is consumed, privacy choices are saved or the wallet proof is updated. Its fixed `WALLET_BLOCKED` explanation was not recognized by the API controller and became the generic HTTP 500 message shown in the new screenshot. A production-mode controller regression reproduced that exact conversion. The existing restriction is a definite obstacle to verification; the database inspection does not reconstruct every detail of the member's individual HTTP request.

The controller now returns HTTP 403 with only the existing fixed public explanation: “This wallet has been blocked from verification in this server. Contact a server administrator.” The exact constant must match; unexpected appended details still receive the generic response. Administrative block notes remain private. Restriction checks, stored blocks and verification decisions are unchanged. The backend build and 99 targeted controller, wallet-flow, block and security tests passed, including the new production response/privacy regressions. This response fix is committed locally until separately released.

## MetaMask domain warning

The member confirmed the production domain. The operator independently reproduced the warning and reports it during both connecting and signing. The private verification token was not used for reputation checks or included in documentation.

MetaMask's public checker said the domain was not blocked; there was no direct domain/parent match in the public static configuration. The public HTML and two entry scripts matched the expected local production artifacts. MetaMask also uses separate live reputation checks, which returned 403 to this investigation. The reason for the member's warning remains unconfirmed; there is no application-side switch that should suppress wallet security warnings.

The exact screenshot text matches MetaMask's current upstream trust-signal modal. The connection gate displays it when the hostname's URL-scan cache recommends blocking. Signature confirmations also read the same origin trust state, so a hostname classification can explain alerts at both stages. This narrows the investigation; it does not identify the classification's underlying reason or rule out another signature-specific alert. The operator reports Chrome 155.0.8059.39 (Official Build), x86_64, and MetaMask 13.55.0. The same source paths were checked against the v13.55.0 tag. The supplied connection and signing text explicitly labels the site malicious; the typed-data schema matches the expected Ethereum `Verification` message. No provider-specific reason was included. Personal identifiers and nonce values were not retained. Source references and sanitized details are preserved in the review draft.

A [support-review draft](metamask-domain-review-draft.md) records the intended signature flow, bounded checks, public evidence and missing client details. It has not been sent. MetaMask's current support guidance is the route for a URL classification review.

Railway's [November 4–5 incident](https://status.railway.com/incident/QBCLHG1V) reports IP-reputation blocks following traffic with forged Railway source addresses. This is a plausible lead for the MetaMask review, not a confirmed cause of its hostname classification. The report now asks MetaMask to check for that connection. An authorized submission attempt could not reach the support messenger because it excludes automated/headless browsers. No review message was sent or case number received; a concise message and normal-browser submission steps are saved alongside the draft.

## Validation and release

The production frontend build, storage recovery regression, 50 targeted Angular wallet/verification tests, the EVM wallet browser suite (including privacy/error cases, signing/session reuse and Base accounts), Stamps browser checks and Solana signature browser checks passed. Browser fixtures use synthetic keys and mocked verification APIs; they do not prove compatibility with the affected users' actual wallet apps.

The verification fixes and initial investigation notes were pushed to `main` through `8d2fb3a` on November 7. Subsequent support-request updates are recorded separately. No backend behavior, database schema, wallet associations, privacy decisions or wallet security protections were changed.

Outstanding: affected desktop wallet/browser and actual error; real iOS follow-up after release; MetaMask classification review and remaining affected-client details. The holder-analysis branch remains separate.

## Deleted Discord roles

Previously earned-role history can remain after a Discord role is deleted. Removal is idempotent: a fresh member without the role, a missing role result, or Discord's explicit Unknown Role response already satisfies removal. These cases retain the history without a Discord write or a fabricated removal event. Permission and transport failures still retain assignments for retry. Add/grant handling continues to require an existing role.

Validation covers absent roles on fresh members, deletion races, explicit Unknown Role responses and transient lookup/removal failures. These corrections are local until published; no historical assignments are deleted.

## Ethscriptions provider failure diagnostics

Global numbered Ethscription rules read complete direct and marketplace-escrow inventories through the protocol API. They use 50-item pages, a 1,000-item inventory safety limit and a serialized request queue. Requests waiting more than 45 seconds are rejected; upstream requests have a ten-second timeout and up to three attempts. Queue expiry, HTTP failures, invalid JSON, malformed records, ownership mismatches and incomplete pagination all remain unavailable results rather than false zero holdings.

Sanitized server warnings now distinguish these failure classes without including wallet addresses, request URLs, raw exceptions or response bodies. The member-facing message stays generic. Earlier generic logs cannot establish which failure class occurred retrospectively; a successful health probe later does not prove the provider was healthy at the earlier failure time. Priority-tier evaluation can log the same cached failed requirement again when trying later alternatives; that does not establish another upstream request.

The diagnostic changes preserve existing request pacing, retries, inventory bounds, role-retention behavior and dormancy safeguards. Local validation passed all 1,995 backend tests across 96 suites and the production backend build. Targeted member-wallet replays require authorization before sending saved addresses to an external provider. Three affected member-wallet replays were subsequently authorized and completed; the findings follow.


## Numbered Ethscription checks for large holders

Authorized read-only replays on November 9 reproduced the same failure for all three affected wallets: the API returned 20 successful 50-item pages with more data remaining, and the verifier reached its inventory safety limit. This establishes the cap as the cause of the reproduced failures; earlier generic messages alone cannot rule out additional historical timeout or queue failures.

Selections covering up to 1,000 individual numbers now query the API's `ethscription_number[]` filter in batches of 50. Matching uses each returned record's current ownership, including the existing marketplace escrow rule. Overlapping number selections share records only within the current check context. Responses must contain valid requested numbers and unique identifiers, with complete pagination. Missing selected numbers fall back to the existing complete-inventory path instead of becoming a false empty result. Larger ranges retain the existing bounded inventory implementation.

The three authorized replays then each completed with one response containing all seven selected records, returning zero matching holdings in approximately 0.07–0.38 seconds. These are isolated checks under different conditions, not production bulk-job latency measurements. No saved wallet, rule, role, or running job was changed by these probes. This removes the need to scan a large wallet for the affected seven-number rule; no API key or database migration is needed.
