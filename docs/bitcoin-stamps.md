# Bitcoin Stamps verification

Released November 5, 2026 (production migration applied the same day). Owner-assisted wallet/Discord acceptance remains deferred. This adapter shares Bitcoin wallet links, privacy, blocks, reconciliation, audit history and fresh export checks; it does not create another wallet identity or copy holdings into the database.

## Rules

Choose **Bitcoin Stamps** in the Control Room, or use `/setup add-stamps-rule` with a verification channel and role. Supply `creator_address`, comma-separated `stamp_ids`, or both, plus an optional `min_items` (default 1).

- Stamp numbers are the explorer's non-negative numbers, including stamp #0. Up to 100 distinct numbers per rule. Transaction hashes and Counterparty asset names are not accepted in this field.
- A creator-only rule matches that original creator address in Stampchain's stamp metadata. It does not mean the creator must currently own the stamp.
- Explicit numbers are alternatives within the selection. When a creator is supplied too, each selected stamp must belong to that creator; mismatches are rejected during setup.
- Counts are **owned copies of indivisible stamps**, including editions. Holding 3 copies of one stamp meets a minimum of 3. Divisible assets and SRC-20 fungible tokens are outside this release.
- Cursed (negative-numbered) stamps are excluded. Both classic Stamps and Counterparty-backed SRC-721 records can match when the provider supplies the required metadata and an indivisible Counterparty balance.
- Saved Bitcoin wallets stack. Overlapping creator/number rules use Counterparty asset identity to count the same owned copies once. Existing combined-role rules can also combine Stamps with other collectible families.
- Minimums and target roles can be edited; creator/number identity is fixed. Create a replacement rule to change its scope. Delete/Undo/Redo retain the criteria.

Examples: creator `1GotRejB6XsGgMsM79TvcypeanDJRJbMtg` alone; stamp numbers `0,1`; or a creator and numbers together. These are public protocol examples, not test requests for members to transfer assets.

## Wallet proof

Ordinals-only Discord channels retain the existing mainnet Taproot (bc1p…) connection and key-path proof restriction. A channel with Stamps rules also permits single-key P2PKH (1…), native P2WPKH (bc1q…) and nested P2SH-P2WPKH (3…) addresses. P2WSH, arbitrary script/multisig proofs and testnet are excluded.

UniSat uses its selected account. Legacy P2PKH accounts sign compact Bitcoin messages; SegWit/Taproot accounts sign BIP-322 simple messages. Xverse exposes an explicit address choice when Stamps are supported: the Ordinals address remains the initial choice, and the member can select the payment address holding Stamps. The saved-wallet portal exposes the same choice. No payment address is silently saved or assumed to share ownership with another address.

**Other wallet** (Stamps channels and the member portal) covers wallets a webpage can't reach, such as Freewallet. The member enters an address, copies Bouncer's message, signs it in their wallet (Freewallet: **Sign Message** on that address) and pastes the signature. The same challenge, expiry and verifier apply. Freewallet signs SegWit addresses with the compressed P2PKH compact header (31–34) rather than BIP-322 or the SegWit BIP-137 headers; Bouncer accepts that header for `bc1q…`/`3…` only when the recovered public key derives the claimed address. Real Freewallet signatures for a `1…` and a `bc1q…` address confirmed this format on November 17, 2026; tests use equivalent signatures from a fixed test key. Freewallet's sign dialog reads the message through jQuery's `serializeArray`, which turns each line break into CRLF, so Bouncer also accepts a signature over the CRLF form of its own challenge. The first live attempt failed for that reason before this was added. With that fix, Freewallet verified live through the page on November 17, 2026 (#172).

On desktop, the panel also offers **Sign with Freewallet**: a `counterparty:<address>?action=sign&message=…&callback=…` link. Freewallet signs the message from the link (no copying, no CRLF change), shows **Send data to remote server?** with the backend's host name, and on **Yes** posts `address`, `message` and `signature` as a form to `POST /api/bitcoin-relay/:id`. The page creates that relay (`POST /api/bitcoin-relay`, Bouncer challenges only, 15 minutes, in memory, at most 2,000 open), polls `GET /api/bitcoin-relay/:id` every two seconds, and submits the delivered signature through the normal verify or link request. The relay verifies the signature before storing it, and its callback is served without CORS headers because Freewallet posts from its app. Freewallet's link parser turns `+` into a space, so the button is hidden for any message containing `+`; it is also hidden on phones. Freewallet registers `counterparty:` links on Windows and in its Linux install script. Live on Linux with Brave (November 18, 2026), Freewallet handled a link reliably whenever no other Freewallet request dialog was open, whether or not Freewallet was already running. A link arriving while a request dialog is open stacks a second dialog with the same id: it opens empty (Freewallet passes data through one shared `FW.DIALOG_DATA` slot that the first dialog clears) and its Cancel button doesn't work, so only its close button dismisses it. The page therefore asks members to close Freewallet request dialogs first and ignores repeat clicks within five seconds.

Base58 address case is preserved throughout challenge, proof, linking, lookup, transfer, blocks and explorer links. Bech32 addresses are normalized to lower case after validation. Challenges remain bound to origin, address, nonce, expiry and privacy choices; Discord user/server/channel context stays server-side, bound to the nonce. Wallet prompts contain no Discord identifiers or raw privacy choices. Signing grants no token approval and creates no asset transfer.

## Providers and failure behavior

Backend-only optional overrides:

```dotenv
STAMPCHAIN_API_URL=https://stampchain.io/api/v2
COUNTERPARTY_API_URL=https://api.counterparty.io:4000/v2
```

These public mainnet endpoints are the defaults, so no key or enable switch is required for initial use. Both must be HTTPS, compatible with the documented APIs and their node-readiness headers. Public service limits apply; production capacity may require arranging a suitable hosted node/provider. No automatic paid account signup is performed.

Counterparty is authoritative for current confirmed quantities. The adapter follows every `type=all` balance cursor, including unbound and UTXO-attached balances, and verifies owner, raw integer units, asset divisibility, reported total, duplicate rows and terminal cursor. All pages and stacked wallets must describe the same confirmed block; duplicate outputs across wallets are rejected. Readiness, mainnet identity, height lag and response cache age are checked. Unsafe numeric JSON quantities fail unavailable rather than rounding; exact decimal integer strings are supported.

Stampchain supplies stamp-number/creator metadata. Explicit selections use detail lookups; creator rules page the wallet's stamp catalog. This metadata relationship and catalog discovery are provider-backed, not independently reconstructed from Bitcoin history. Catalog quantities and market data never establish ownership. A suspicious empty catalog is confirmed against individual indivisible assets, because the upstream catalog query can return empty on internal errors. This fallback is bounded to 100 assets.

Requests are serialized with bounded queue wait, timeouts and a 100-page limit of 100 rows for each inventory. Failed, stale, partial, inconsistent or rate-limited responses produce **unavailable**, retain previously earned roles and prevent partial export completion. Fresh inventories and metadata are reused only inside the same check/export context; Bouncer does not cache ownership across checks. Provider-side indexing and HTTP caching can still introduce lag.

**Check Setup** probes mainnet Counterparty readiness and Stampchain indexer health. It does not claim to test a member's inventory.

## Database and release

`backend/supabase/migrations/20261030020000_bitcoin_stamps.sql` adds nullable `stamp_criteria`, rule validation/duplicate/edit/undo guards, and the approved Bitcoin address constraints. A checksum-aware Base58 discriminator keeps legacy Bitcoin block records distinct from Solana keys. RPC permissions remain service-only. No existing wallet or rule values are backfilled or rewritten.

The production migration was applied November 5, 2026 after a fresh private backup and guarded rehearsal (`backend/test/check-stamps-migration.py`). The default provider URLs need no Railway variables.

## Acceptance

- Automated tests cover creator/number intersection, editions, stacked wallets, overlapping rule counts, pagination/inconsistent blocks, malformed/imprecise data, unavailable providers, proof replay/tampering and unchanged Ordinals restrictions.
- Independent native SegWit BIP-322 vectors and generated P2PKH/P2WPKH/nested-SegWit signatures are verified by the backend.
- Read-only compiled-adapter checks passed for a public wallet: selected stamp #787425 = 1 copy; creator-only = 10,088 copies; creator-plus-number = 1 copy. This exercised a 1,712-row Counterparty inventory and a mixed Stamps/cursed catalog. These observations are a dated acceptance sample, not a permanent balance assertion.
- Local browser acceptance covers admin creation/review/collapse/restore and a real synthetic legacy Bitcoin signature at 1280px, 393px and 320px. It does not prove compatibility with an actual installed wallet app.
- Owner-assisted Xverse/UniSat desktop/mobile signing, portal link/transfer/removal, Discord role grant/recheck after holdings change, and fresh export checks remain deferred at the user's request. Ordinary spendable Stamps address support does not widen Ordinals ownership checks to payment addresses.

Sources: [Stampchain API](https://stampchain.io/docs), [official explorer API implementation](https://github.com/stampchain-io/stampchain.io), [Counterparty API v2](https://apidocs.counterparty.io/), [BIP-322](https://bips.dev/322/), [Xverse message signing](https://docs.xverse.app/sats-connect/bitcoin-methods/signmessage), [UniSat wallet API](https://docs.unisat.io/developer-support/open-api-documentation/unisat-wallet.md).

