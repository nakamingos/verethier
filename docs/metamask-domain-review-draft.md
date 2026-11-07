# MetaMask domain classification review — draft

Prepared November 7, 2026. Not submitted. This draft includes public application details and operator-reported client versions. Member verification tokens, signatures, wallet addresses and Discord identities are intentionally excluded.

Subject: Unexpected phishing/domain warning for https://bouncer.up.railway.app

Bouncer is a Discord asset-ownership verifier hosted at `https://bouncer.up.railway.app`. A member reports, and the Bouncer operator independently reproduced, a MetaMask warning saying the site shows signs of phishing or wallet-draining activity, with a “Connect anyway” button. The operator reports the warning during both connecting and signing. The screenshot wording matches MetaMask's origin trust-signal modal; the operator reports MetaMask 13.55.0 and Google Chrome 155.0.8059.39 (Official Build), x86_64. The other affected member's client details remain unknown. Please investigate the classification and identify which signal or provider produced it. If the classification is incorrect, please review its correction through your normal process.

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

The Bouncer operator independently reproduced the warning and reports seeing it both while connecting and while signing. This is now reported by a member and the operator. The operator reports Google Chrome 155.0.8059.39 (Official Build), x86_64, and MetaMask 13.55.0. The operating system was not supplied.

The screenshot wording matches MetaMask's [trust-signal modal](https://github.com/MetaMask/metamask-extension/blob/c3a708b3774a7cb2a539e8e4c44f73ed913eecc1/ui/components/app/trust-signal-modal/trust-signal-modal.tsx). Its [connection gate](https://github.com/MetaMask/metamask-extension/blob/c3a708b3774a7cb2a539e8e4c44f73ed913eecc1/ui/pages/permissions-connect/connection-trust-signal-gate/connection-trust-signal-gate.tsx) displays that modal when the origin trust state is `Malicious`. The [origin hook](https://github.com/MetaMask/metamask-extension/blob/c3a708b3774a7cb2a539e8e4c44f73ed913eecc1/ui/hooks/useOriginTrustSignals.ts) reads the URL-scan cache by hostname and maps `RecommendedAction.Block` to that state. The [confirmation alert hook](https://github.com/MetaMask/metamask-extension/blob/c3a708b3774a7cb2a539e8e4c44f73ed913eecc1/ui/pages/confirmations/hooks/alerts/useOriginTrustSignalAlerts.ts) uses the same origin hook for transaction and signature confirmations.

This supports investigating the hostname's live classification as a common explanation for both stages. It does not reveal the underlying provider/signal, establish that the classification is incorrect, or rule out an additional signature-specific warning. The same connection gate, hostname-cache mapping and signature-confirmation origin hook were also verified in the reported [v13.55.0 source](https://github.com/MetaMask/metamask-extension/blob/v13.55.0/ui/hooks/useOriginTrustSignals.ts).

## Operator-provided alert and signature details

The connection screen classifies `bouncer.up.railway.app` as “Malicious—flagged as unsafe.” The signature screen also identifies a malicious site. No specific provider or underlying detection reason was shown in the supplied text.

The reported signature request is on Ethereum, with EIP-712 domain `Bouncer`, version `1`, chain ID `1`, and primary type `Verification`. Its field names and types match the intended application schema described above, including the privacy choices. The supplied payload does not contain a token approval, permit or transfer instruction. This observation does not determine why the hostname was classified or substitute for review of the service-side signals. The generic connection permission to send transaction requests does not establish that a transaction was requested in this verification flow.

Only the schema and client versions are retained here. The operator's wallet address, Discord identity/server identifiers, nonce, expiry and privacy epoch values are omitted from this draft.

## Potential Railway reputation connection

Railway's [incident QBCLHG1V](https://status.railway.com/incident/QBCLHG1V), first posted November 4 at 18:54 UTC, reports network/security-provider blocks on Railway IP addresses after a third party sent scanning traffic using forged Railway source IP addresses. Railway states that the traffic did not originate from its network and that these reports are not evidence of compromised customer workloads. Its latest posted update, November 5 at 18:51 UTC as checked November 7, says it is working with network operators, security vendors and abuse database providers; some access restrictions remain.

This incident overlaps the timing of our warning reports. It describes IP reputation/access restrictions, whereas MetaMask is flagging our hostname. A causal connection has not been established.

Please check whether `bouncer.up.railway.app` was classified because of Railway IP/infrastructure reputation associated with this incident. If so, please distinguish the application from the spoofed traffic and review the classification using your normal process. If unrelated, please identify the applicable detection reason/provider and any remediation needed.

## Submission route

MetaMask's current [security-alert documentation](https://support.metamask.io/configure/wallet/security-alerts/#how-to-report-a-false-classification) directs URL/token/address scan classification issues to MetaMask Support (Option 2). The [legacy domain-warning guidance](https://support.metamask.io/stay-safe/safety-in-web3/deceptive-site-ahead-when-trying-to-connect-to-a-site/) also links the public phishing-list tracker when the problem is a list entry. The appropriate first request here is a domain-classification review through support, since the public checker does not flag this domain.

Attach a screenshot cropped to the warning and domain, without the private verification URL/token. The operator client versions are recorded above; add the operating system and other affected client details if available. Do not ask members to bypass the warning or disable security alerts.

## Submission attempt — November 7

The operator authorized proceeding with the review request. Opened MetaMask's official support page, selected Continue without wallet, ended the initial AI-search conversation and selected Contact Support. The Intercom messenger did not load. Its public loader explicitly excludes automated/headless user agents, including the isolated browser available for this attempt. No user-agent disguise or bypass was attempted.

The review message was not sent and no support case number was obtained. The concise message is saved in [metamask-domain-review-message.txt](metamask-domain-review-message.txt). To submit from a normal browser: open [MetaMask Support](https://support.metamask.io/), choose Contact support, then Continue without wallet. If the AI-search screen appears, choose End conversation, then Contact Support to reach the support messenger. Paste the saved message and request a human review of the URL classification. Include a cropped warning screenshot if requested; omit the private verification token and personal identifiers.
