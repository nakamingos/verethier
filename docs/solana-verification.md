# Solana verification

Initial implementation prepared October 29, 2026. The production migration was applied October 29 after a fresh private backup and rehearsal of the exact guarded upgrade. Helius passed read-only provider acceptance checks. The operator enabled Solana and confirmed that the desktop Phantom connection now works. Full signing, mobile and Discord-role acceptance remain on the deferred checklist.

## Initial coverage

- Mainnet Solana wallets, with Phantom Wallet Standard discovery and a Phantom injected-provider fallback. The connector signs an exact, readable Bouncer message; it never signs transactions or pays fees. SIWS/off-chain envelopes, hardware-wallet and multisig/program-account authorization are not enabled in this slice.
- SPL Token and explicitly allowlisted transparent Token-2022 balances by mint, token program and minimum. Sum all directly owned accounts across saved wallets using raw integer units. Reject unknown balance-affecting extensions, mismatched mint configuration, overlapping accounts and incomplete responses. Frozen ownership can count; spending capability is not the criterion. Confidential, interest/scaled display and protocol-deposit balances are excluded.
- NFTs using collection, verified creator or explicit asset-ID scopes, minimum counts and existing same-asset AND/OR trait filters. Scope addresses are case-sensitive; multiple addresses in a scope mean OR. Token Metadata/programmable NFTs and Core assets are the only advertised formats in this slice. Collection relationships are read from Token Metadata PDAs or Core's on-chain update authority, with batched reads. An indexed collection name/group alone is insufficient.
- Wallet linking/transfers/removal, proof activity/history, privacy and deletion behavior, server wallet blocks/audits, member lookup/explorer links, rule edits/revisions, combined collectible counts, background checks, setup diagnostics and fresh exports use the new family. Solana fungible balances never join collectible item-count groups.
- The Control Room has Solana NFT/token rule choices when enabled. Discord has `/setup add-solana-nft-rule` and `/setup add-solana-token-rule`, using the same validated creation operations.

Compressed Bubblegum V1/V2 support is implemented as the separately gated stage below. Printed-edition rules are implemented as the separately gated stage below. Native SOL minima, staking/escrow, other wallet apps and marketplace slugs remain separate follow-ups. Existing saved EVM/Bitcoin identities and behavior are preserved. In particular, a Solana address can start with `bc1p`; prefix alone must not classify it as Bitcoin or cause lowercasing.

## Backend configuration and migration

Configure these only on the backend:

| Variable | Purpose |
| --- | --- |
| `SOLANA_RPC_URL` | HTTPS Solana mainnet JSON-RPC endpoint with finalized account/mint reads. |
| `SOLANA_DAS_URL` | HTTPS mainnet RPC/DAS endpoint supporting `getAssetsByOwner` and ordinary cluster-identity RPC. It may equal `SOLANA_RPC_URL`, for example with Helius. |
| `SOLANA_ENABLED=1` | Explicit opt-in after migration/provider readiness. Unset or other values leave new Solana proofs/rule creation disabled and existing Solana checks unavailable. |

`SOLANA_ENABLED` is the single Solana enable/pause switch. Once the required migrations and this code are deployed, supported ordinary, compressed and printed-edition rules are available automatically. The former `SOLANA_COMPRESSED_ENABLED` and `SOLANA_EDITIONS_ENABLED` variables have been retired; any leftover environment entries are ignored. No operator action is needed for those old entries. Existing rules keep their saved format/scope selections.

Future per-feature flags are temporary staging controls, with removal included in the release after the matching migration is ready. They must not accumulate as permanent operator configuration.

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


## Compressed NFT stage (updated October 30, 2026)

The `20261029020000_solana_compressed_nfts.sql` production migration was applied October 30, 2026 after a fresh private backup and guarded rehearsal. The format-specific flag is retired as part of the printed-edition release below. The migration expands the service-only criteria validator. It changes no saved rule, wallet, table or column. After deploying this release, `SOLANA_ENABLED=1` enables supported compressed rules automatically. Reuse the existing Helius RPC/DAS URLs; no new API key or frontend environment variable is required. The local simplification does not require an additional migration. The application commits are being published with this release; no Railway flag was changed and no deployment was monitored.

The new-rule editor and `/setup add-solana-nft-rule` offer Token Metadata + Core (the existing default), compressed NFTs (Bubblegum V1/V2), or all supported formats. Existing format scopes stay unchanged and cannot be broadened by editing a rule. Collection, verified creator and explicit asset-ID scopes retain their existing OR-address, minimum, trait and combined-count behavior. Canonical asset IDs identify compressed holdings and contribute one item each. Inherited collection royalty recipients do not become verified asset creators.

Routine compressed NFT checks trust provider-reported ownership and relationships:

- Discover assets through the complete, fresh indexed owner inventory. Re-read selected candidates through `getAsset` or `getAssetBatch`, checking response identities, supported V1/V2 interface, compressed format and explicit burn state. Missing, malformed, duplicate or unexpected entries are unavailable.
- Count a directly owned asset only when the returned owner is one of the member's saved wallets. A delegate does not count as owner. Exclude a lookup reporting a different owner or a burned asset. Frozen holdings can count; program-held/staked assets need a separate adapter.
- Match collection/creator scopes using explicit provider-reported verified relationships. Missing verification evidence is unavailable. For V2 inherited royalties, use raw asset creators when supplied, rather than resolved collection recipients. Trait conditions use the same existing provider metadata and AND/OR behavior.
- Preserve roles on unavailable provider data; fresh required exports cannot use a partial result. No Merkle proof request, leaf hashing, TreeConfig validation or compressed tree-account read runs in this path. Existing SPL/Token-2022, Token Metadata and Core checks keep their previous behavior.

Compressed candidates need `getAssetsByOwner`, `getAsset` and `getAssetBatch`, plus the existing mainnet identity/finalized-slot calls for inventory freshness. Detail reads use batches of up to 100 and within-check caching, capped at 1,000 selected compressed lookups per evaluation. Existing ten-second/four-megabyte request limits, thirty-second foreground budget, inventory limits and rate limiting remain. Setup diagnostics check capability configuration/cluster access; they do not claim independent cryptographic verification of member holdings.

A fresh API request and global indexed slot do not guarantee every individual row has caught up with an ownership change. This provider-backed approach deliberately accepts indexing delay. Re-reading selected details can catch a stale inventory row but is not independent proof against blockchain state. Discovery, positive/negative results and mutable traits depend on the provider, and pagination is not an atomic snapshot.

The initial cryptographic prototype was tested on October 29 and is preserved in Git commit `df0234f`. On October 30 the user requested its removal from the normal ownership path. Proof requests, tree parsing, hashing and proof-only tests/SDK fixtures were removed; the independent verification idea and recovery pointers are filed in the [optional feature backlog](plans/optional-features.md#asset-capabilities-and-optimizations).

The unchanged compressed-format migration previously passed a disposable local restore rehearsal against the private pre-Solana production backup, with the initial Solana migration as a prerequisite. Every existing application value, including saved rule criteria and EVM wallet scopes, was identical before/after. Synthetic SQL checks covered standard/compressed criteria, guarded creation/edits, immutable format scope and service-role-only execution. Run `python3 backend/test/check-solana-compressed-migration.py BACKUP_DIRECTORY` to repeat; it never connects to a remote database. The unchanged format editor passed browser checks at 1280/393/320 pixels, including light mode. Browser coverage is `frontend`'s `test:solana-compressed-smoke` after building.

October 30 validation passed: 1,670 backend tests across 81 suites, including 75 focused Solana tests, and the backend production build. Provider-backed regressions cover V1/V2 collection/creator/ID rules, inherited royalties, owner changes, burns, traits, missing data, stale inventories, malformed batches, lookup bounds and unchanged feature gates. Batches of 100/100/1 and within-check reuse are exercised without proof/tree RPCs. Read-only mainnet Helius checks passed explicit IDs and collection counts for public V1 and V2 samples (89 and 15 inventory entries), with zero proof or tree requests; the checks took approximately 2.2 and 1.6 seconds in this run. Public holdings and timings can change. No wallet was connected or signed and no member/database state was modified.

Deferred release acceptance: actual community V1/V2 holdings through Phantom/Discord, movement/burns, role preservation, combined groups and privacy-respecting fresh exports. Existing smart-wallet/OpenSea and mobile acceptance remain deferred at the user's request.

Provider references: [Helius asset details](https://www.helius.dev/docs/api-reference/das/getasset), [Helius asset batches](https://www.helius.dev/docs/api-reference/das/getassetbatch), [Metaplex compressed-NFT discovery](https://www.metaplex.com/docs/dev-tools/das-api/guides/find-compressed-nfts).


## Compressed NFT production migration (October 30, 2026)

The user authorized the compressed-NFT release. Fresh private roles/schema/data backups were saved under `backup/compressed-release-20261030T130732Z/`, outside version control. The exact guarded migration passed against a disposable restore, including canonical criteria, rule creation/edits and service-role-only RPC checks. The production transaction then applied and recorded `20261029020000_solana_compressed_nfts` and notified PostgREST.

Within one repeatable-read transaction, every application value in all 23 public tables was compared before/after. All 361 wallet records, 53 rules and existing function permissions were preserved. Independent SQL checks confirmed the migration record, acceptance of standard and compressed criteria, service-role execution and denial for ordinary clients. Private SQL, hashes and receipts are retained with the backup. The subsequent printed-edition release removes the temporary format flag. Compressed support follows `SOLANA_ENABLED` automatically after that code is deployed. No Railway setting was changed here and deployment monitoring was not performed.


## Printed edition rules (October 30, 2026)

Implemented and validated; the production migration was applied October 30, 2026. The feature and flag-retirement code are included in the same release. The original Solana capability remains required. The `20261030010000_solana_print_editions.sql` migration follows the initial Solana and compressed-format migrations. Deploying this release exposes printed-edition rules automatically under `SOLANA_ENABLED=1`. No frontend environment variable, new provider key or wallet signature format is needed. The capability is separate from compressed NFT support.

Select **Solana NFTs → Printed editions**, enter up to 20 master NFT **mint** addresses and choose a minimum. Multiple master addresses mean OR. These rules count each distinct directly owned Token Metadata print mint once across saved wallets; owning the master NFT itself does not count. Existing same-asset trait AND/OR filters and combined collectible groups apply. Core and compressed assets do not use Token Metadata print ancestry and cannot be included in this scope. Existing rules retain their scope.

The implementation reads only the member's inventoried NFTs. It reuses finalized SPL/Token-2022 ownership reads, then the existing batched `getMultipleAccounts` path to read their canonical Token Metadata edition accounts. Each print's parent must match the edition PDA derived from a selected master mint. Master-edition records are excluded; a missing edition account means that mint is not a print. Wrong program ownership, malformed accounts, incomplete responses, stale contexts and request failures remain unavailable and preserve roles. It recognizes `V1_PRINT` as a Metadata inventory interface alongside `V1_NFT` and `ProgrammableNFT`; an interface name alone does not establish print ancestry. This path introduces no compressed Merkle proofs and does not enumerate every print in an entire project.

The Control Room offers the scope when Solana is enabled, labels master mint input clearly and fixes formats to Metadata. Discord's `/setup add-solana-nft-rule` accepts `scope: master_edition`; omitted/standard formats resolve to Metadata only, and incompatible explicit formats are rejected. Setup diagnostics reuse the single Solana mainnet provider check. The migration only expands the service-only criteria validator; it changes no table, wallet or saved rule.

Validation passed: 1,686 backend tests across 82 suites (including 91 focused Solana tests), 53 targeted frontend tests, backend/frontend production builds and print editor smoke at 1280/393/320 pixels in dark/light mode. Coverage includes master exclusion, several masters, distinct print counts, traits, owner changes/burns, immutable scope, unsupported formats, the overall Solana pause switch, malformed responses and shared read caching. The disposable migration rehearsal preserved every existing application value, including saved criteria and EVM wallet scopes, and exercised print creation/edits and service-only permissions. Repeat with `python3 backend/test/check-solana-editions-migration.py BACKUP_DIRECTORY`; it never connects to production. Browser checks are `frontend`'s `test:solana-editions-smoke` after building.

Read-only Helius mainnet checks used its documented public master mint. The derived master edition PDA matched the provider's edition endpoint, and the actual compiled ownership service found one qualifying print in a public wallet inventory of 428 entries. DAS described that real print as `V1_NFT`, so relationship checks correctly use the edition account rather than relying on a print-specific interface name. These checks connected no wallet, requested no signature and changed no member or database state. Actual Phantom/Discord role and fresh export acceptance remain on the deferred checklist.

References: [Metaplex printed editions](https://www.metaplex.com/docs/smart-contracts/token-metadata/print), [Edition parent layout](https://github.com/metaplex-foundation/mpl-token-metadata/blob/main/programs/token-metadata/program/src/state/edition.rs), [Helius edition discovery](https://www.helius.dev/docs/api-reference/das/getnfteditions). The discovery endpoint was used to select a public validation sample; normal rule checks reuse the member inventory and account reads.


## Printed-edition release and flag retirement (October 30, 2026)

The user authorized releasing printed editions and removing both format-specific switches. A fresh private roles/schema/data backup was saved under `backup/editions-release-20261030T135648Z/`. The exact guarded transaction passed on a disposable restore, including print/standard/compressed criteria, guarded rule creation/edits, immutable master scope and service-role-only RPC permissions. The production transaction applied and recorded `20261030010000_solana_print_editions` and notified PostgREST.

Every application value in all 23 public tables was compared before/after within one repeatable-read transaction. All 361 wallet records, 53 rules and existing function permissions were preserved. Independent SQL verification confirmed the migration record, valid print criteria, rejection of incompatible print formats and service-only function execution. Private SQL, hashes and receipts remain with the backup outside version control.

Release cleanup is complete in the code: the compressed and edition-specific environment variables, creation/count guards and duplicate setup probes are removed. Both formats follow the overall Solana switch. The editor's existing edition capability field is derived from that same switch; it is not another operator setting. Automated pause tests now exercise only `SOLANA_ENABLED`. Existing saved rules retain their scope and unsupported-format behavior. Owner-assisted wallet/Discord acceptance remains deferred; no Railway configuration was changed or deployment monitored.

Final flag-retirement checks passed: all 1,686 backend tests across 82 suites, the backend and frontend production builds, and compressed/printed-edition editor browser checks at 1280/393/320 pixels. Both editor fixtures omit format-specific environment gates, while backend creation/count/setup tests verify that the overall Solana pause switch still prevents checks and preserves unavailable behavior.
