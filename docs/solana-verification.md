# Solana verification

Initial implementation prepared October 29, 2026. Production enablement and real-wallet/provider acceptance are pending. The migration has only been rehearsed against a disposable local restore; no production data was changed. The user's live testing remains deferred.

## Initial coverage

- Mainnet Solana wallets, with Phantom Wallet Standard discovery and a Phantom injected-provider fallback. The connector signs an exact, readable Bouncer message; it never signs transactions or pays fees. SIWS/off-chain envelopes, hardware-wallet and multisig/program-account authorization are not enabled in this slice.
- SPL Token and explicitly allowlisted transparent Token-2022 balances by mint, token program and minimum. Sum all directly owned accounts across saved wallets using raw integer units. Reject unknown balance-affecting extensions, mismatched mint configuration, overlapping accounts and incomplete responses. Frozen ownership can count; spending capability is not the criterion. Confidential, interest/scaled display and protocol-deposit balances are excluded.
- NFTs using collection, verified creator or explicit asset-ID scopes, minimum counts and existing same-asset AND/OR trait filters. Scope addresses are case-sensitive; multiple addresses in a scope mean OR. Token Metadata/programmatic NFTs and Core assets are the only advertised formats in this slice. Collection relationships are read from Token Metadata PDAs or Core's on-chain update authority, with batched reads. An indexed collection name/group alone is insufficient.
- Wallet linking/transfers/removal, proof activity/history, privacy and deletion behavior, server wallet blocks/audits, member lookup/explorer links, rule edits/revisions, combined collectible counts, background checks, setup diagnostics and fresh exports use the new family. Solana fungible balances never join collectible item-count groups.
- The Control Room has Solana NFT/token rule choices when enabled. Discord has `/setup add-solana-nft-rule` and `/setup add-solana-token-rule`, using the same validated creation operations.

Compressed Bubblegum assets, master-edition ancestry, native SOL minima, staking/escrow, other wallet apps and marketplace slugs remain separate follow-ups. Existing saved EVM/Bitcoin identities and behavior are preserved. In particular, a Solana address can start with `bc1p`; prefix alone must not classify it as Bitcoin or cause lowercasing.

## Backend configuration and migration

Configure these only on the backend:

| Variable | Purpose |
| --- | --- |
| `SOLANA_RPC_URL` | HTTPS Solana mainnet JSON-RPC endpoint with finalized account/mint reads. |
| `SOLANA_DAS_URL` | HTTPS mainnet RPC/DAS endpoint supporting `getAssetsByOwner` and ordinary cluster-identity RPC. It may equal `SOLANA_RPC_URL`, for example with Helius. |
| `SOLANA_ENABLED=1` | Explicit opt-in after migration/provider readiness. Unset or other values leave new Solana proofs/rule creation disabled and existing Solana checks unavailable. |

Existing `BASE_URL` supplies the public verification origin for challenge messages. Endpoint credentials are never exposed to the frontend or returned in provider errors. No frontend secret or Solana environment variable is needed.

Rehearse and apply `backend/supabase/migrations/20261029010000_solana_verification.sql` through the normal reviewed migration workflow before enabling Solana. The additive migration expands wallet/block/flow constraints, adds typed Solana rule criteria and extends canonical rule mutation/duplicate guards. Existing service-role-only wallet RPC signatures remain unchanged. Solana links have no EVM chain scope.

The proof binds the Discord member, server/channel context, nonce, account, origin, purpose, issue/expiry times and signed privacy choices. Fresh verification consumes its nonce before linking. Portal wallet linking uses the existing expiring, single-use flow and explicit transfer confirmation. Connection/account changes invalidate pending client signatures.

## Evidence and provider limits

The adapter validates both endpoints' mainnet genesis identity. Token reads use finalized commitment and mint/account program/decimals checks. NFT inventory needs a usable indexed-slot signal at least as recent as the finalized slot read before scanning. It rejects changed reported totals, duplicate identities, unexpected owners, malformed pages and incomplete inventories. Required missing traits are unavailable. No arbitrary metadata URLs are fetched.

Each request is bounded to ten seconds and four megabytes. A foreground operation has a thirty-second budget, at most two upstream requests run concurrently, and requests start no faster than twice per second per process. Inventory is capped at 25 pages of 1,000 entries; on-chain NFT account reads are batched in groups of up to 100. Inventories and balances are reused only within the existing check context. Exhausted limits or provider uncertainty never become a definitive zero or a partial export. Setup checks cluster identity/finalized-slot access only, not a member's complete inventory.

Live provider pagination/count semantics and freshness availability must be checked before enabling production. These safeguards are not an atomic snapshot guarantee across changing chain/index pages. Independently deployable instances also need a shared provider quota large enough for their combined traffic; the initial limiter is local to one process.

## Validation and deferred acceptance

Automated coverage uses real synthetic Ed25519 keys/signatures, replay/concurrent-proof rejection, context/account/privacy changes, exact token amounts, extension handling, stale/incomplete inventories, verified collection/Core relationships, creator/trait filters and wallet-family separation. The migration rehearsal compares every existing application value, including EVM proof scope, before/after and exercises Solana links, transfer confirmation/history, guarded rule creation/edits and RPC permissions in a disposable restore.

Validation on October 29, 2026 passed: 1,627 backend tests across 80 suites, 42 targeted frontend tests, backend/frontend production builds, the local migration rehearsal, Solana verification smoke at three widths, existing member-portal smoke at three widths and Control Room smoke at five widths. The final Solana-specific checks also passed after the freshness-anchor and prefix-collision fixes.

The browser smoke signs the built verification UI with a synthetic Phantom wallet and verifies the exact Ed25519 signature at the mocked API boundary at 1280/393/320 pixels. This is not an actual Phantom app or provider-acceptance test. Run backend and frontend builds before `frontend`'s `test:solana-smoke` command. The local migration rehearsal is `python3 backend/test/check-solana-migration.py BACKUP_DIRECTORY`; it never applies a migration remotely.

- [ ] Configure real RPC/DAS access and confirm token programs, pagination/count semantics and indexed freshness.
- [ ] Rehearse against a fresh backup and apply the production migration through the normal release workflow.
- [ ] Later, test actual Phantom desktop/mobile connection, cancellation, repeat signatures, linking/transfer and Discord verification when the user has time.
- [ ] Check representative SPL/Token-2022, Token Metadata/programmatic and Core assets: positive/negative holdings, movement/burns, traits, stale providers, role preservation and permission-respecting exports.
- [ ] Enable only the accepted capabilities after the separate release decision.

Technical references: [Solana messages](https://solana.com/docs/frontend/messages-and-auth), [token account reads](https://solana.com/docs/rpc/http/gettokenaccountsbyowner), [Token-2022 extensions](https://solana.com/docs/tokens/extensions), [DAS owner inventory](https://www.helius.dev/docs/api-reference/das/getassetsbyowner), [Core account layout](https://github.com/metaplex-foundation/mpl-core/blob/main/clients/rust/src/generated/accounts/base_asset_v1.rs), and [Token Metadata layout](https://github.com/metaplex-foundation/mpl-token-metadata/blob/main/programs/token-metadata/program/src/state/metadata.rs).

## Alchemy readiness check (October 29, 2026)

Read-only checks against the configured Alchemy mainnet endpoint confirmed cluster identity and finalized slot access. The check uncovered and corrected an incomplete mainnet genesis hash in the application. Both `getAssetsByOwner` and `getAssetsByOwner_v2` returned HTTP 503 / JSON-RPC code -32001, including with a documented public example wallet. NFT inventory compatibility remains unconfirmed; this response alone does not establish whether the cause is temporary provider availability or account configuration. Production migration and enablement were not performed.
