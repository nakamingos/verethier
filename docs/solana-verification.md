# Solana verification

Initial implementation prepared October 29, 2026. The production migration was applied October 29 after a fresh private backup and rehearsal of the exact guarded upgrade. Helius passed read-only provider acceptance checks. The operator enabled Solana and confirmed that the desktop Phantom connection now works. Full signing, mobile and Discord-role acceptance remain on the deferred checklist.

## Initial coverage

- Mainnet Solana wallets, with Phantom Wallet Standard discovery and a Phantom injected-provider fallback. The connector signs an exact, readable Bouncer message; it never signs transactions or pays fees. SIWS/off-chain envelopes, hardware-wallet and multisig/program-account authorization are not enabled in this slice.
- SPL Token and explicitly allowlisted transparent Token-2022 balances by mint, token program and minimum. Sum all directly owned accounts across saved wallets using raw integer units. Reject unknown balance-affecting extensions, mismatched mint configuration, overlapping accounts and incomplete responses. Frozen ownership can count; spending capability is not the criterion. Confidential, interest/scaled display and protocol-deposit balances are excluded.
- NFTs using collection, verified creator or explicit asset-ID scopes, minimum counts and existing same-asset AND/OR trait filters. Scope addresses are case-sensitive; multiple addresses in a scope mean OR. Token Metadata/programmable NFTs and Core assets are the only advertised formats in this slice. Collection relationships are read from Token Metadata PDAs or Core's on-chain update authority, with batched reads. An indexed collection name/group alone is insufficient.
- Wallet linking/transfers/removal, proof activity/history, privacy and deletion behavior, server wallet blocks/audits, member lookup/explorer links, rule edits/revisions, combined collectible counts, background checks, setup diagnostics and fresh exports use the new family. Solana fungible balances never join collectible item-count groups.
- The Control Room has Solana NFT/token rule choices when enabled. Discord has `/setup add-solana-nft-rule` and `/setup add-solana-token-rule`, using the same validated creation operations.

Compressed Bubblegum V1/V2 support is implemented as the separately gated stage below. Master-edition ancestry, native SOL minima, staking/escrow, other wallet apps and marketplace slugs remain separate follow-ups. Existing saved EVM/Bitcoin identities and behavior are preserved. In particular, a Solana address can start with `bc1p`; prefix alone must not classify it as Bitcoin or cause lowercasing.

## Backend configuration and migration

Configure these only on the backend:

| Variable | Purpose |
| --- | --- |
| `SOLANA_RPC_URL` | HTTPS Solana mainnet JSON-RPC endpoint with finalized account/mint reads. |
| `SOLANA_DAS_URL` | HTTPS mainnet RPC/DAS endpoint supporting `getAssetsByOwner` and ordinary cluster-identity RPC. It may equal `SOLANA_RPC_URL`, for example with Helius. |
| `SOLANA_COMPRESSED_ENABLED=1` | Separate opt-in for explicit compressed NFT rules, only after the compressed-format migration below. Existing NFT rules keep their saved formats. |
| `SOLANA_ENABLED=1` | Explicit opt-in after migration/provider readiness. Unset or other values leave new Solana proofs/rule creation disabled and existing Solana checks unavailable. |

Existing `BASE_URL` supplies the public verification origin for challenge messages. Endpoint credentials are never exposed to the frontend or returned in provider errors. No frontend secret or Solana environment variable is needed.

Rehearse and apply `backend/supabase/migrations/20261029010000_solana_verification.sql` through the normal reviewed migration workflow before enabling Solana. The additive migration expands wallet/block/flow constraints, adds typed Solana rule criteria and extends canonical rule mutation/duplicate guards. Existing service-role-only wallet RPC signatures remain unchanged. Solana links have no EVM chain scope.

The proof binds the Discord member, server/channel context, nonce, account, origin, purpose, issue/expiry times and signed privacy choices. Fresh verification consumes its nonce before linking. Portal wallet linking uses the existing expiring, single-use flow and explicit transfer confirmation. Connection/account changes invalidate pending client signatures.

## Evidence and provider limits

The adapter validates both endpoints' mainnet genesis identity. Token reads use finalized commitment and mint/account program/decimals checks. NFT inventory needs a usable indexed-slot signal at least as recent as the finalized slot read before scanning. It validates each page's reported count against its items and rejects duplicate identities, unexpected owners, malformed pages and incomplete inventories. Token Metadata holdings are independently checked through finalized SPL and Token-2022 account reads, so stale index rows for closed or transferred NFTs do not count or block unrelated collection checks. The shared binary account prefix avoids RPC JSON-parser failures for accounts whose mint was closed. Required missing traits are unavailable. No arbitrary metadata URLs are fetched.

Each request is bounded to ten seconds and four megabytes. A foreground operation has a thirty-second budget, at most two upstream requests run concurrently, and requests start no faster than twice per second per process. Inventory is capped at 50 pages of 500 entries; on-chain NFT account reads are batched in groups of up to 100. Inventories and balances are reused only within the existing check context. Exhausted limits or provider uncertainty never become a definitive zero or a partial export. Setup checks cluster identity/finalized-slot access only, not a member's complete inventory.

Helius pagination/count semantics and freshness availability were checked live. Repeat these checks when changing providers. These safeguards are not an atomic snapshot guarantee across changing chain/index pages. Independently deployable instances also need a shared provider quota large enough for their combined traffic; the initial limiter is local to one process.

## Validation and deferred acceptance

Automated coverage uses real synthetic Ed25519 keys/signatures, replay/concurrent-proof rejection, context/account/privacy changes, exact token amounts, extension handling, stale/incomplete inventories, verified collection/Core relationships, creator/trait filters and wallet-family separation. The migration rehearsal compares every existing application value, including EVM proof scope, before/after and exercises Solana links, transfer confirmation/history, guarded rule creation/edits and RPC permissions in a disposable restore.

Validation on October 29, 2026 passed: 1,627 backend tests across 80 suites, 42 targeted frontend tests, backend/frontend production builds, the local migration rehearsal, Solana verification smoke at three widths, existing member-portal smoke at three widths and Control Room smoke at five widths. The final Solana-specific checks also passed after the freshness-anchor and prefix-collision fixes.

The browser smoke signs the built verification UI with a synthetic Phantom wallet and verifies the exact Ed25519 signature at the mocked API boundary at 1280/393/320 pixels. This is not an actual Phantom app or provider-acceptance test. Run backend and frontend builds before `frontend`'s `test:solana-smoke` command. The local migration rehearsal is `python3 backend/test/check-solana-migration.py BACKUP_DIRECTORY [GUARDED_APPLY_FILE]`; it never applies a migration remotely. It accepts fresh smart-wallet-enabled backups and older pre-upgrade backups, and can rehearse the exact guarded release transaction.

- [x] Configure real RPC/DAS access and confirm token programs, pagination/count semantics and indexed freshness with Helius.
- [x] Rehearse against a fresh backup and apply the production migration through the normal release workflow (October 29, 2026).
- [ ] Later, test actual Phantom desktop/mobile connection, cancellation, repeat signatures, linking/transfer and Discord verification when the user has time.
- [ ] Check representative SPL/Token-2022, Token Metadata/programmable and Core assets: positive/negative holdings, movement/burns, traits, stale providers, role preservation and permission-respecting exports.
- [x] Operator enabled Solana with the accepted Helius endpoint; Solana appears in verification and the user confirmed the corrected desktop Phantom connection works.

Technical references: [Solana messages](https://solana.com/docs/frontend/messages-and-auth), [token account reads](https://solana.com/docs/rpc/http/gettokenaccountsbyowner), [Token-2022 extensions](https://solana.com/docs/tokens/extensions), [DAS owner inventory](https://www.helius.dev/docs/api-reference/das/getassetsbyowner), [Core account layout](https://github.com/metaplex-foundation/mpl-core/blob/main/clients/rust/src/generated/accounts/base_asset_v1.rs), and [Token Metadata layout](https://github.com/metaplex-foundation/mpl-token-metadata/blob/main/programs/token-metadata/program/src/state/metadata.rs).

## Alchemy readiness check (October 29, 2026)

Read-only checks against the configured Alchemy mainnet endpoint confirmed cluster identity and finalized slot access. The check uncovered and corrected an incomplete mainnet genesis hash in the application. Both `getAssetsByOwner` and `getAssetsByOwner_v2` returned HTTP 503 / JSON-RPC code -32001, including with a documented public example wallet. NFT inventory compatibility remains unconfirmed; this response alone does not establish whether the cause is temporary provider availability or account configuration. Production migration and enablement were not performed.

## Helius readiness check (October 29, 2026)

Read-only checks used the same configured Helius mainnet URL for ordinary RPC and DAS. Both cluster identity and finalized-slot access passed. The actual compiled ownership service passed:

- USDC mint validation (six decimals) and positive/zero exact balances on public sample wallets.
- Two public Token-2022 mints and raw integer balances.
- A 3,691-entry public wallet inventory across eight 500-item pages with fresh indexed-slot evidence.
- Token Metadata/programmable collection membership decoded on-chain (73 matches), an explicit NFT ID, a verified creator (64 matches), matching/nonmatching traits and an absent ID.
- Core collection membership decoded on-chain (one match), an explicit ID and matching/nonmatching traits.

Live testing uncovered two adapter issues: DAS `total` is the page count, and a fresh global index watermark does not guarantee that individual asset ownership/burn rows are current. The adapter now handles page counts correctly and filters Token Metadata assets through finalized token-account ownership before collection, ID, creator or trait checks. Reads use the common SPL/Token-2022 binary prefix, including frozen holdings, rather than relying on mint-dependent JSON parsing. Invalid or unavailable ownership evidence still preserves uncertainty. On the large public sample, indexed records for 39 nonexistent mint/metadata accounts had previously prevented unrelated collection checks; the finalized ownership filter resolved this without treating incomplete reads as zero. A 1,000-item request also repeatedly hit the ten-second timeout; smaller pages completed that large inventory in approximately five seconds while retaining the 25,000-entry cap.

Post-fix Solana regression checks passed 41 tests across three suites; the full backend suite passed 1,636 tests across 80 suites, and the backend build passed. Public sample holdings can change; these counts describe this run, not fixed fixtures. No wallet was connected or signed, no database migration was applied, and no production flag was changed. Actual Phantom/Discord acceptance remains deferred.

## Production migration release (October 29, 2026)

The operator authorized release after Helius acceptance. A fresh private roles/schema/application-data backup was taken before the upgrade. The exact guarded transaction passed on a disposable restore, including synthetic Solana linking, transfer/history, rule edits, criteria validation and permission checks. The production transaction then applied `20261029010000_solana_verification`, recorded the migration and notified PostgREST to reload its schema.

The transaction compared every existing application value before/after under bounded locks. All 23 public application tables, 360 wallets, 52 rules, existing EVM wallet scopes and RPC permissions were preserved. Independent SQL verification confirmed the migration record, new JSONB field, legacy rule scopes, backward-compatible RPC defaults and service-role-only criteria access. A record-free API probe using the current project key returned HTTP 200 for the new field, confirming the PostgREST schema reload. Private backup, rehearsal and application receipts are retained under `backup/solana-release-20261029T205314Z/`, outside version control.

Application activation remains separate: configure the Railway backend's two Solana URLs with Helius and set `SOLANA_ENABLED=1` after deploying the compatibility fixes. No frontend variable is required. Actual Phantom desktop/mobile, linking/transfer and Discord role acceptance remains on the deferred checklist above.

## Phantom connection action correction (October 29, 2026)

A desktop user reported that the always-visible “Open Phantom” action opened the mobile app landing page. The verification and member portals now label the connection action “Connect Phantom” and reserve “Open in Phantom app” for mobile browsers without a detected Phantom provider. Wallet Standard and injected extension connections stay on the current page; missing desktop providers receive extension guidance. Mobile browse links use Phantom's documented `phantom.com` endpoint and preserve the Solana selection when reopening verification or wallet linking.

Validation passed: production frontend build, 43 targeted connector/verification tests, synthetic signed verification at 1280/393/320 pixels, desktop missing-provider guidance, mobile handoff with route/selection preservation, and existing member-portal smoke at 1280/393/320 pixels. These browser checks mock the wallet; the user subsequently confirmed that the desktop connection works. Full signing/role and mobile acceptance remain deferred. No backend or database change is required.


## Compressed NFT stage (October 29, 2026)

Implemented locally; not released or enabled. The new `20261029020000_solana_compressed_nfts.sql` migration expands the service-only criteria validator. It changes no saved rule, wallet, table or column. Rehearse/apply it after the original Solana migration, deploy this code, then explicitly set backend `SOLANA_COMPRESSED_ENABLED=1` when releasing this stage. `SOLANA_ENABLED=1` is also required. Reuse the existing Helius RPC/DAS URLs; no new API key or frontend environment variable is required. This implementation session did not apply a production migration, change a Railway flag or push commits.

The new-rule editor and `/setup add-solana-nft-rule` offer Token Metadata + Core (the existing default), compressed NFTs (Bubblegum V1/V2), or all supported formats. Existing format scopes stay unchanged and cannot be broadened by editing a rule. Collection, verified creator and explicit asset-ID scopes retain their existing OR-address, minimum, trait and combined-count behavior. Compressed assets use their Bubblegum asset PDA as identity and contribute one item each. Inherited collection royalty recipients do not become verified asset creators.

Compressed evidence is checked independently of ordinary token-account ownership:

- Decode the Bubblegum V1/V2 leaf and derive its asset PDA from tree and nonce. Authenticate owner, delegate, data/creator hashes and V2 collection/asset-data hashes and flags. A delegate does not count as owner.
- Authenticate creator lists against the creator hash. Authenticate collection membership against the serialized metadata hash and, for V2, collection hash. Grouping names and display verification flags alone never establish membership. Required missing, inconsistent or unsupported evidence is unavailable.
- Verify the full Merkle path against the **current finalized** on-chain tree root, not a retained historical root. Validate the compression program, registered Bubblegum TreeConfig PDA/owner/version, tree authority, capacity, nonce and account layout. Parse the active root from one complete bounded account read to avoid accepting an obsolete root during a read race.
- Re-read selected assets/proofs, exclude authenticated transfers to another owner and authenticate zero-leaf burn proofs before treating those assets as absent. A provider that cannot supply usable burn evidence produces unavailable rather than a guessed negative. Frozen holdings can count; program-held/staked assets need a separate adapter.

The provider must support `getAsset`, `getAssetProof`, `getAssetBatch` and `getAssetProofBatch`, complete full-depth proofs with usable indexed slots, plus finalized `getMultipleAccounts`/`getAccountInfo` reads. Multiple selected candidates use batches of up to 100, shared tree reads and within-check caches; missing, duplicate or unexpected batch entries fail the check. At most 1,000 selected compressed candidates are proved per evaluation. Existing ten-second/four-megabyte request limits, thirty-second foreground budget, inventory limits and rate limiting still apply. Busy trees or slow index responses can produce unavailable; existing roles are preserved and fresh required exports cannot use a partial result. Setup diagnostics check configuration/cluster access; they do not claim to prove an individual asset.

Discovery and negative results still depend on a complete, fresh indexed owner inventory. Selected positive holdings additionally require cryptographic on-chain proof. Mutable trait attributes remain provider evidence; this does not make their off-chain contents cryptographically authoritative or make paginated reads an atomic snapshot.

Validation passed with independent synthetic vectors generated by the official Metaplex Bubblegum SDK 6.0.0: V1/V2 leaves, PDAs, metadata/creator/collection hashes, inherited royalties, Merkle paths, transfers, burns, forged relationships, stale/historical roots, read races, malformed batches and missing evidence. Coverage includes 104 focused Solana tests, the 1,699-test backend regression set across 82 suites (the slash-command option expectation was updated and its 95 tests rerun), 52 targeted frontend tests, both production builds, Control Room smoke at five widths and signed synthetic Phantom smoke at three widths. Compressed rule gating, format selection, collapse/restore, review and save passed at 1280/393/320 pixels, including light mode.

The migration passed a disposable local restore rehearsal against the private pre-Solana production backup, with the initial Solana migration as a prerequisite. Every existing application value, including saved rule criteria and EVM wallet scopes, was identical before/after the compressed migration. Synthetic SQL checks covered standard/compressed criteria, guarded creation/edits, immutable format scope and service-role-only execution. Run `python3 backend/test/check-solana-compressed-migration.py BACKUP_DIRECTORY` to repeat; it never connects to a remote database. Browser coverage is `frontend`'s `test:solana-compressed-smoke` after building.

Read-only Helius mainnet checks passed actual V1 and V2 leaf/proof/current-finalized-root verification and complete ownership-service positive checks with authenticated collection membership. One larger V2 wallet scan hit the ten-second provider timeout and correctly returned unavailable; a smaller public V2 wallet (15 indexed entries) completed in approximately 3.4 seconds, as did the V1 check. Both batch methods also passed a live response-shape check. These public checks connected no wallet, requested no signature and changed no member or database state. Public holdings can change.

Deferred release acceptance: actual community V1/V2 holdings through Phantom/Discord, movement/burns, role preservation, combined groups and privacy-respecting fresh exports. Existing smart-wallet/OpenSea and mobile acceptance remain deferred at the user's request.

Implementation references: [Bubblegum leaf schemas](https://github.com/metaplex-foundation/mpl-bubblegum/blob/accedabc5f162f456bb3421ade7e49a517ece092/programs/bubblegum/program/src/state/leaf_schema.rs), [official SDK hashing](https://github.com/metaplex-foundation/mpl-bubblegum/blob/accedabc5f162f456bb3421ade7e49a517ece092/clients/js/src/hash.ts), [Helius asset batches](https://www.helius.dev/docs/api-reference/das/getassetbatch), [Helius proof batches](https://www.helius.dev/docs/api-reference/das/getassetproofbatch).
