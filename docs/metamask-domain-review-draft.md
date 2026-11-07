# MetaMask domain classification review — draft

Prepared November 7, 2026. Not submitted. This draft includes only public application details. Member verification tokens, signatures, wallet addresses and Discord identities are intentionally excluded.

Subject: Unexpected phishing/domain warning for https://bouncer.up.railway.app

Bouncer is a Discord asset-ownership verifier hosted at `https://bouncer.up.railway.app`. A member reports, and the Bouncer operator independently reproduced, a MetaMask warning saying the site shows signs of phishing or wallet-draining activity, with a “Connect anyway” button. The operator reports the warning during both connecting and signing. The screenshot wording matches MetaMask's origin trust-signal modal; the exact installed MetaMask versions and platforms are not yet available. Please investigate the classification and identify which signal or provider produced it. If the classification is incorrect, please review its correction through your normal process.

Public source: https://github.com/nakamingos/verethier

## Intended wallet interaction

The verification page connects a wallet and requests an EIP-712 `Verification` signature. Fields identify the Discord user/server, one-time nonce, expiry, signing wallet and privacy choices. The domain is named `Bouncer`, version `1`, on the connected supported chain. The backend validates the signature and nonce and reads ownership to determine Discord roles.

The verification flow does not request token approvals, permits, asset transfers or transaction broadcasts. The wallet SDK includes generic capabilities for other applications, but this flow invokes account/chain reads and typed-data message signing. See `frontend/src/app/routes/verify/verify.component.ts`, `frontend/src/app/services/wallet.service.ts`, and the backend wallet/signature services in the public source.

AppKit metadata uses the actual frontend origin as its URL, the name `Bouncer`, and `/assets/bouncer.svg`. No metadata change or security-warning override has been added in response to this report.

## Checks performed November 7

- MetaMask's official public “Why Was This Site Blocked?” utility returned: “This domain is not blocked! No problem here.” for `bouncer.up.railway.app`.
- The current public `eth-phishing-detect` configuration contained no direct blocked entry for the domain or a parent domain. These observations do not rule out other reputation feeds, cached results or live classifications.
- Direct unauthenticated reads of MetaMask's live domain-scan/feed endpoints returned HTTP 403, so their classification/reason was not available to this investigation. Access controls were not bypassed.
- The public site's HTML had only the expected local script entry points. The two public entry scripts matched our existing production build:
- `polyfills-5CFQRCPP.js`: SHA-256 `15c6f58707b9b19116fde3a3f6a0ce9cf83427d64a91e95cb91fe1056c3da616`; matched the existing local production artifact before these fixes.
- `main-MIQHMIKO.js`: SHA-256 `8025e23f6cfd28dc4693fa7d59fcc489a4203331f5dfdf06c3fc5a85f785d7c2`; matched the existing local production artifact before these fixes.

These entry-file comparisons identify the checked artifacts; they do not establish the state of every lazy-loaded chunk or an affected member's extension/browser. Please use your service-side evidence to investigate the warning rather than treating our intended workflow as proof of a false classification.

## Alert source trace — November 7

The Bouncer operator independently reproduced the warning and reports seeing it both while connecting and while signing. This is now reported by a member and the operator. The operator's browser and MetaMask version are still pending.

The screenshot wording matches MetaMask's [trust-signal modal](https://github.com/MetaMask/metamask-extension/blob/c3a708b3774a7cb2a539e8e4c44f73ed913eecc1/ui/components/app/trust-signal-modal/trust-signal-modal.tsx). Its [connection gate](https://github.com/MetaMask/metamask-extension/blob/c3a708b3774a7cb2a539e8e4c44f73ed913eecc1/ui/pages/permissions-connect/connection-trust-signal-gate/connection-trust-signal-gate.tsx) displays that modal when the origin trust state is `Malicious`. The [origin hook](https://github.com/MetaMask/metamask-extension/blob/c3a708b3774a7cb2a539e8e4c44f73ed913eecc1/ui/hooks/useOriginTrustSignals.ts) reads the URL-scan cache by hostname and maps `RecommendedAction.Block` to that state. The [confirmation alert hook](https://github.com/MetaMask/metamask-extension/blob/c3a708b3774a7cb2a539e8e4c44f73ed913eecc1/ui/pages/confirmations/hooks/alerts/useOriginTrustSignalAlerts.ts) uses the same origin hook for transaction and signature confirmations.

This supports investigating the hostname's live classification as a common explanation for both stages. It does not reveal the underlying provider/signal, establish that the classification is incorrect, or rule out an additional signature-specific warning. These references describe current upstream source; the affected installed version is not yet known.

## Submission route

MetaMask's current [security-alert documentation](https://support.metamask.io/configure/wallet/security-alerts/#how-to-report-a-false-classification) directs URL/token/address scan classification issues to MetaMask Support (Option 2). The [legacy domain-warning guidance](https://support.metamask.io/stay-safe/safety-in-web3/deceptive-site-ahead-when-trying-to-connect-to-a-site/) also links the public phishing-list tracker when the problem is a list entry. The appropriate first request here is a domain-classification review through support, since the public checker does not flag this domain.

Attach a screenshot cropped to the warning and domain, without the private verification URL/token. Add the affected MetaMask version, browser and platform when available. Do not ask members to bypass the warning or disable security alerts.
