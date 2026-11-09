# Bouncer domain reputation review — November 9, 2026

## Findings

The operator reproduced a connection warning in Rainbow extension 1.6.13 on Chrome. The screenshot shows the application name `bouncer.up.railway.app`, a red `railway.app` label and a malicious-app warning. No details or report link was available. MetaMask connection/signing warnings were previously reported separately.

Rainbow's published [Blockaid integration](https://blockaid.io/blog/rainbow-wallet-mobile-app-and-browser-extension-powered-by-blockaid) includes dapp scanning before connection. Its [published extension snapshot](https://github.com/rainbow-me/browser-extension/blob/62ea10cc0e98cf05eab68b6dafc8d392183f87dc/package.json) identifies version 1.6.13. The matching warning component consumes `dApp.status` from Rainbow's metadata service. This establishes the displayed classification path; the underlying provider rule and reason are not exposed by that response.

The [`getDappHostname` formatter](https://github.com/rainbow-me/browser-extension/blob/62ea10cc0e98cf05eab68b6dafc8d392183f87dc/src/core/utils/connectedApps.ts) displays only the last two hostname components. The [metadata lookup](https://github.com/rainbow-me/browser-extension/blob/62ea10cc0e98cf05eab68b6dafc8d392183f87dc/src/core/resources/metadata/dapp.ts) separately sends the supplied URL for classification. Consequently, the red `railway.app` label does not establish that Railway's parent domain is classified malicious.

A read-only query to Rainbow's public metadata endpoint, `https://metadata.p.rainbow.me/v1/graph`, returned HTTP 200 at **November 9, 2026, 4:51:55 PM EST / 21:51:55 UTC**:

| Submitted URL | Returned status |
| --- | --- |
| `https://bouncer.up.railway.app` | `SCAM` |
| `https://up.railway.app` | `UNVERIFIED` |
| `https://railway.app` | `UNVERIFIED` |
| `https://railway.com` | `UNVERIFIED` |

Only public origin URLs were submitted; no verification tokens, member identities, wallet addresses or signatures were included. `UNVERIFIED` does not mean verified safe. These results support a hostname-specific result in Rainbow, but do not reveal whether the underlying heuristic involves hosting, IP reputation, content or another signal.

Railway's [external-network blocking incident](https://status.railway.com/incident/QBCLHG1V) is now marked resolved, with its closing update dated November 9 at **1:03 PM EST / 18:03 UTC**. The incident discusses IP-address blocks after forged-source scanning. Neither that notice nor the support responses supplied by the operator establish a connection to this wallet hostname classification.

MetaMask's [current support guidance](https://support.metamask.io/configure/wallet/security-alerts/) describes multiple intelligence sources and security partners, including Blockaid. This does not establish that Rainbow and MetaMask received the same underlying record. Keep the existing MetaMask case and cross-reference any Blockaid response rather than assuming one appeal will resolve every wallet.

## Appeal route

Blockaid's official [contact page](https://blockaid.io/contact) links its [support portal](https://report.blockaid.io/). Choose **Mistake** for a false-positive review. Read-only inspection confirmed fields for domain, optional chain/wallet/address, email and additional details, plus a verification-code challenge. No fields were filled, no challenge was solved and no report was submitted.

Suggested form entries:

- Domain: `bouncer.up.railway.app`
- Wallet: `Rainbow extension 1.6.13 on Chrome; also reported in MetaMask`
- Chain: `Ethereum` for the previously confirmed MetaMask reproduction; the warning is also visible at connection time.
- Email: `nomorelabs@gmail.com`
- Address: leave blank for this domain-classification review; member wallet data is not needed in this draft.
- Attach the operator's Rainbow screenshot if the submission flow accepts attachments.

Rainbow's official [extension support page](https://rainbow.me/support/extension/common-browser-extension-issues) gives `support@rainbow.me` as a follow-up route. Ask Rainbow to confirm the upstream reason and refresh/propagation behavior if the live `SCAM` status persists after provider review.

## Copyable appeal draft

**Subject:** False-positive review: bouncer.up.railway.app flagged in Rainbow and MetaMask

Please review the website classification for https://bouncer.up.railway.app. Bouncer verifies wallet ownership and reads holdings to assign Discord roles. Members are receiving malicious-site warnings during connection and signing, preventing normal verification.

The new reproduction is Rainbow browser extension 1.6.13 on Chrome. Its connection screen identifies bouncer.up.railway.app and displays “This app is likely malicious.” No details or report link is available. MetaMask connection and signature warnings have also been reproduced and reported separately.

On November 9, 2026 at 21:51:55 UTC, Rainbow's public metadata API returned SCAM for https://bouncer.up.railway.app, while https://up.railway.app, https://railway.app and https://railway.com returned UNVERIFIED. Rainbow's published hostname formatter shortens the displayed label to railway.app; please review the exact Bouncer hostname rather than assuming the screenshot establishes a parent-domain block.

The EVM ownership-verification flow requests an EIP-712 Verification message containing user/server context, a one-time nonce, expiry, wallet address and privacy choices. This flow does not request token approvals, permits, asset transfers or on-chain transactions. Public source: https://github.com/nakamingos/verethier. Actual member verification links are short-lived and private, so no member links, addresses, signatures or nonce values are included here.

Please identify the classification reason, source and scope, review the application, and correct the classification if it is erroneous. Please also advise whether the Rainbow and MetaMask warnings use the same record and how a correction propagates through wallet caches.

Potentially relevant infrastructure context: https://status.railway.com/incident/QBCLHG1V describes an IP-reputation incident and was marked resolved on November 9 at 18:03 UTC. A connection to this hostname warning is unconfirmed; please let us know whether it is relevant.

Operator: Snepsid. Contact: nomorelabs@gmail.com.

**Status:** Draft only. No appeal or support message has been submitted by the assistant.
