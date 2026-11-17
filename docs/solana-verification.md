# Solana verification

Solana is live in production with Helius as the RPC/DAS provider. Members verify with any Solana wallet that supports the Wallet Standard, such as Phantom, Solflare or Backpack; admins create Solana token and NFT rules in the Control Room or with `/setup add-token-rule` and `/setup add-nft-rule` using `network: Solana`.

## Coverage

- Mainnet Solana wallets discovered through the Wallet Standard, with a Phantom injected-provider fallback for older Phantom builds. The connector signs an exact, readable Bouncer message; it never signs transactions or pays fees. SIWS/off-chain envelopes, hardware-wallet and multisig/program-account authorization are not enabled in this slice.
- SPL Token and explicitly allowlisted transparent Token-2022 balances by mint, token program and minimum. Sum all directly owned accounts across saved wallets using raw integer units. Reject unknown balance-affecting extensions, mismatched mint configuration, overlapping accounts and incomplete responses. Frozen ownership can count; spending capability is not the criterion. Confidential, interest/scaled display and protocol-deposit balances are excluded.
- NFTs using collection, verified creator or explicit asset-ID scopes, minimum counts and existing same-asset AND/OR trait filters. Scope addresses are case-sensitive; multiple addresses in a scope mean OR. Token Metadata/programmable NFTs and Core assets are the only advertised formats in this slice. Collection relationships are read from Token Metadata PDAs or Core's on-chain update authority, with batched reads. An indexed collection name/group alone is insufficient.
- Wallet linking/transfers/removal, proof activity/history, privacy and deletion behavior, server wallet blocks/audits, member lookup/explorer links, rule edits/revisions, combined collectible counts, background checks, setup diagnostics and fresh exports use the new family. Solana fungible balances never join collectible item-count groups.
- In the Control Room, choose **NFTs** or **Tokens** as the asset type and **Solana** as the network (offered when Solana is enabled). The rules are still saved as `solana_nft`/`solana_token`, and the rule list's NFTs/Tokens filters include them. In Discord, use `/setup add-nft-rule` (with `scope`, `addresses` and optional `formats`) or `/setup add-token-rule` (the mint goes in `contract_address`; SPL Token or Token-2022 is read from the mint) with `network: Solana`. Both use the same validated creation operations, and `/setup list-rules` includes Solana rules under NFTs and Tokens.

Compressed (Bubblegum V1/V2) and printed-edition NFT rules are described below. Native SOL minimums, staking/escrow, other wallet apps and marketplace slugs remain separate follow-ups. A Solana address can start with `bc1p`; prefix alone must not classify it as Bitcoin or cause lowercasing.

## Configuration

Configure these only on the backend:

| Variable | Purpose |
| --- | --- |
| `SOLANA_RPC_URL` | HTTPS Solana mainnet JSON-RPC endpoint with finalized account/mint reads. |
| `SOLANA_DAS_URL` | HTTPS mainnet RPC/DAS endpoint supporting `getAssetsByOwner` and ordinary cluster-identity RPC. It may equal `SOLANA_RPC_URL`, for example with Helius. |
| `SOLANA_ENABLED=1` | Explicit opt-in after migration/provider readiness. Unset or other values leave new Solana proofs/rule creation disabled and existing Solana checks unavailable. |

`SOLANA_ENABLED` is the single Solana enable/pause switch. Supported ordinary, compressed and printed-edition rules are available automatically. The former `SOLANA_COMPRESSED_ENABLED` and `SOLANA_EDITIONS_ENABLED` variables have been retired; any leftover environment entries are ignored. No operator action is needed for those old entries. Existing rules keep their saved format/scope selections.

Future per-feature flags are temporary staging controls, with removal included in the release after the matching migration is ready. They must not accumulate as permanent operator configuration.

Existing `BASE_URL` supplies the public verification origin for challenge messages. Endpoint credentials are never exposed to the frontend or returned in provider errors. No frontend secret or Solana environment variable is needed.

Migrations `20261029010000_solana_verification.sql`, `20261029020000_solana_compressed_nfts.sql` and `20261030010000_solana_print_editions.sql` were applied to production on October 29–30, 2026. The first expands wallet/block/flow constraints and adds typed Solana rule criteria; the others only widen the criteria validator. Solana links have no EVM chain scope.

The proof binds the Discord member, server/channel context, nonce, account, origin, purpose, issue/expiry times and signed privacy choices. Fresh verification consumes its nonce before linking. Portal wallet linking uses the existing expiring, single-use flow and explicit transfer confirmation. Connection/account changes invalidate pending client signatures.

## Wallet connection

The verify page and member portal list every Solana wallet the browser announces through the Wallet Standard (Phantom, Solflare, Backpack, Coinbase Wallet, MetaMask and others) that supports Solana mainnet message signing. With one wallet, **Connect** uses it; with several, a **Solana wallet** menu chooses. Older Phantom builds without the Wallet Standard use Phantom's injected provider. The backend verifies the Ed25519 signature and doesn't depend on which wallet made it.

Desktop browsers without a Solana wallet get extension guidance. Phones without a detected wallet get **Open in Phantom**, **Open in Solflare** and **Open in MetaMask** instead of **Connect**, because a phone browser can't reach a Solana wallet app directly. The buttons reopen the page in that app's browser (`phantom.com/ul/browse/…`, `solflare.com/ul/v1/browse/…`, `link.metamask.io/dapp/…`) with `?wallet=solana`, keeping the Solana selection; older `?wallet=phantom` links still work. Other wallet apps work when the page is opened in their own browser. Inside a wallet's browser the wallet is detected and **Connect** returns. Desktop: MetaMask connected, signed and followed account switches on Nov 17, 2026; the Solflare and MetaMask mobile links are still untested.

Wallets connect whichever account is active in the wallet, and they remember approving the site, so connecting again doesn't prompt. Bouncer follows account switches made in the wallet when the new account is approved for the site, and otherwise asks to connect again. To use a different account, switch accounts in the wallet. **Disconnect wallet** in the member portal also asks the wallet to disconnect the site, so it stops signing until you connect again; to make the wallet ask for approval again, remove the site from the wallet's connected apps. If a wallet reports that the account isn't approved (error 4100), Bouncer explains and asks you to connect again.

## Evidence and provider limits

The adapter validates both endpoints' mainnet genesis identity. Token reads use finalized commitment and mint/account program/decimals checks. NFT inventory needs a usable indexed-slot signal at least as recent as the finalized slot read before scanning. It validates each page's reported count against its items and rejects duplicate identities, unexpected owners, malformed pages and incomplete inventories. Token Metadata holdings are independently checked through finalized SPL and Token-2022 account reads, so stale index rows for closed or transferred NFTs do not count or block unrelated collection checks. The shared binary account prefix avoids RPC JSON-parser failures for accounts whose mint was closed. Required missing traits are unavailable. No arbitrary metadata URLs are fetched.

Each request is bounded to ten seconds and four megabytes. A foreground operation has a thirty-second budget, at most two upstream requests run concurrently, and requests start no faster than twice per second per process. Inventory is capped at 50 pages of 500 entries; on-chain NFT account reads are batched in groups of up to 100. Inventories and balances are reused only within the existing check context. Exhausted limits or provider uncertainty never become a definitive zero or a partial export. Setup checks cluster identity/finalized-slot access only, not a member's complete inventory.

Helius pagination/count semantics and freshness availability were checked live. Repeat these checks when changing providers. These safeguards are not an atomic snapshot guarantee across changing chain/index pages. Independently deployable instances also need a shared provider quota large enough for their combined traffic; the initial limiter is local to one process.

Live testing uncovered two adapter issues: DAS `total` is the page count, and a fresh global index watermark does not guarantee that individual asset ownership/burn rows are current. The adapter now handles page counts correctly and filters Token Metadata assets through finalized token-account ownership before collection, ID, creator or trait checks. Reads use the common SPL/Token-2022 binary prefix, including frozen holdings, rather than relying on mint-dependent JSON parsing. Invalid or unavailable ownership evidence still preserves uncertainty. On the large public sample, indexed records for 39 nonexistent mint/metadata accounts had previously prevented unrelated collection checks; the finalized ownership filter resolved this without treating incomplete reads as zero. A 1,000-item request also repeatedly hit the ten-second timeout; smaller pages completed that large inventory in approximately five seconds while retaining the 25,000-entry cap.

## Compressed NFTs

The new-rule editor and `/setup add-nft-rule network:Solana` offer Token Metadata + Core (the existing default), compressed NFTs (Bubblegum V1/V2), or all supported formats. Existing format scopes stay unchanged and cannot be broadened by editing a rule. Collection, verified creator and explicit asset-ID scopes retain their existing OR-address, minimum, trait and combined-count behavior. Canonical asset IDs identify compressed holdings and contribute one item each. Inherited collection royalty recipients do not become verified asset creators.

Routine compressed NFT checks trust provider-reported ownership and relationships:

- Discover assets through the complete, fresh indexed owner inventory. Re-read selected candidates through `getAsset` or `getAssetBatch`, checking response identities, supported V1/V2 interface, compressed format and explicit burn state. Missing, malformed, duplicate or unexpected entries are unavailable.
- Count a directly owned asset only when the returned owner is one of the member's saved wallets. A delegate does not count as owner. Exclude a lookup reporting a different owner or a burned asset. Frozen holdings can count; program-held/staked assets need a separate adapter.
- Match collection/creator scopes using explicit provider-reported verified relationships. Missing verification evidence is unavailable. For V2 inherited royalties, use raw asset creators when supplied, rather than resolved collection recipients. Trait conditions use the same existing provider metadata and AND/OR behavior.
- Preserve roles on unavailable provider data; fresh required exports cannot use a partial result. No Merkle proof request, leaf hashing, TreeConfig validation or compressed tree-account read runs in this path. Existing SPL/Token-2022, Token Metadata and Core checks keep their previous behavior.

Compressed candidates need `getAssetsByOwner`, `getAsset` and `getAssetBatch`, plus the existing mainnet identity/finalized-slot calls for inventory freshness. Detail reads use batches of up to 100 and within-check caching, capped at 1,000 selected compressed lookups per evaluation. Existing ten-second/four-megabyte request limits, thirty-second foreground budget, inventory limits and rate limiting remain. Setup diagnostics check capability configuration/cluster access; they do not claim independent cryptographic verification of member holdings.

A fresh API request and global indexed slot do not guarantee every individual row has caught up with an ownership change. This provider-backed approach deliberately accepts indexing delay. Re-reading selected details can catch a stale inventory row but is not independent proof against blockchain state. Discovery, positive/negative results and mutable traits depend on the provider, and pagination is not an atomic snapshot.

The initial cryptographic prototype was tested on October 29 and is preserved in Git commit `df0234f`. On October 30 the user requested its removal from the normal ownership path. Proof requests, tree parsing, hashing and proof-only tests/SDK fixtures were removed; the independent verification idea and recovery pointers are filed in the [optional feature backlog](plans/optional-features.md#asset-capabilities-and-optimizations).

Provider references: [Helius asset details](https://www.helius.dev/docs/api-reference/das/getasset), [Helius asset batches](https://www.helius.dev/docs/api-reference/das/getassetbatch), [Metaplex compressed-NFT discovery](https://www.metaplex.com/docs/dev-tools/das-api/guides/find-compressed-nfts).

## Printed editions

Select **NFTs**, network **Solana**, then match by **Printed editions**, enter up to 20 master NFT **mint** addresses and choose a minimum. Multiple master addresses mean OR. These rules count each distinct directly owned Token Metadata print mint once across saved wallets; owning the master NFT itself does not count. Existing same-asset trait AND/OR filters and combined collectible groups apply. Core and compressed assets do not use Token Metadata print ancestry and cannot be included in this scope. Existing rules retain their scope.

The implementation reads only the member's inventoried NFTs. It reuses finalized SPL/Token-2022 ownership reads, then the existing batched `getMultipleAccounts` path to read their canonical Token Metadata edition accounts. Each print's parent must match the edition PDA derived from a selected master mint. Master-edition records are excluded; a missing edition account means that mint is not a print. Wrong program ownership, malformed accounts, incomplete responses, stale contexts and request failures remain unavailable and preserve roles. It recognizes `V1_PRINT` as a Metadata inventory interface alongside `V1_NFT` and `ProgrammableNFT`; an interface name alone does not establish print ancestry. This path introduces no compressed Merkle proofs and does not enumerate every print in an entire project.

The Control Room offers the scope when Solana is enabled, labels master mint input clearly and fixes formats to Metadata. Discord's `/setup add-nft-rule network:Solana` accepts `scope: master_edition`; omitted/standard formats resolve to Metadata only, and incompatible explicit formats are rejected. Setup diagnostics reuse the single Solana mainnet provider check. The migration only expands the service-only criteria validator; it changes no table, wallet or saved rule.

Read-only Helius mainnet checks used its documented public master mint. The derived master edition PDA matched the provider's edition endpoint, and the actual compiled ownership service found one qualifying print in a public wallet inventory of 428 entries. DAS described that real print as `V1_NFT`, so relationship checks correctly use the edition account rather than relying on a print-specific interface name. These checks connected no wallet, requested no signature and changed no member or database state. Actual Phantom/Discord role and fresh export acceptance remain on the deferred checklist.

References: [Metaplex printed editions](https://www.metaplex.com/docs/smart-contracts/token-metadata/print), [Edition parent layout](https://github.com/metaplex-foundation/mpl-token-metadata/blob/main/programs/token-metadata/program/src/state/edition.rs), [Helius edition discovery](https://www.helius.dev/docs/api-reference/das/getnfteditions). The discovery endpoint was used to select a public validation sample; normal rule checks reuse the member inventory and account reads.

## Testing

Automated coverage uses real synthetic Ed25519 keys/signatures, replay/concurrent-proof rejection, context/account/privacy changes, exact token amounts, extension handling, stale/incomplete inventories, verified collection/Core relationships, creator/trait filters and wallet-family separation. The migration rehearsal compares every existing application value, including EVM proof scope, before/after and exercises Solana links, transfer confirmation/history, guarded rule creation/edits and RPC permissions in a disposable restore.

The Solana browser smoke tests (`frontend/test/solana*.smoke.cjs`) sign the built UI with a synthetic Phantom wallet and verify the exact Ed25519 signature at a mocked API. They are not actual Phantom or provider acceptance.

## Live acceptance

- [x] Configure real RPC/DAS access and confirm token programs, pagination/count semantics and indexed freshness with Helius.
- [x] Rehearse against a fresh backup and apply the production migration through the normal release workflow (October 29, 2026).
- [x] Test Phantom desktop/mobile connection, cancellation, repeat signatures, linking/transfer and Discord verification (passed November 17, 2026). Found and fixed: the portal's **Change wallet** didn't prompt Phantom again, and signing with an account Phantom hadn't approved showed Phantom's raw "not been authorized" error.
- [ ] Check representative SPL/Token-2022, Token Metadata/programmable and Core assets: positive/negative holdings, movement/burns, traits, stale providers, role preservation and permission-respecting exports.
- [x] Operator enabled Solana with the accepted Helius endpoint; Solana appears in verification and the user confirmed the corrected desktop Phantom connection works.

Technical references: [Solana messages](https://solana.com/docs/frontend/messages-and-auth), [token account reads](https://solana.com/docs/rpc/http/gettokenaccountsbyowner), [Token-2022 extensions](https://solana.com/docs/tokens/extensions), [DAS owner inventory](https://www.helius.dev/docs/api-reference/das/getassetsbyowner), [Core account layout](https://github.com/metaplex-foundation/mpl-core/blob/main/clients/rust/src/generated/accounts/base_asset_v1.rs), and [Token Metadata layout](https://github.com/metaplex-foundation/mpl-token-metadata/blob/main/programs/token-metadata/program/src/state/metadata.rs).

## Release history

- **October 29, 2026:** Alchemy's DAS endpoint returned HTTP 503 for NFT inventory, so Helius was chosen. Helius read-only checks passed for tokens, Token-2022, a 3,691-entry inventory, Token Metadata and Core collections. The initial migration was applied after a fresh backup and guarded rehearsal, and the operator enabled Solana.
- **October 30, 2026:** compressed NFT and printed-edition migrations applied; the temporary `SOLANA_COMPRESSED_ENABLED` and `SOLANA_EDITIONS_ENABLED` flags were retired, so both formats follow `SOLANA_ENABLED`. Private backups and receipts are kept under `backup/`, outside version control.
