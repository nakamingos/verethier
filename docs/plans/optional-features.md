# Optional feature backlog

Ideas for later consideration. Core work remains in the [implementation plan](halcyon-core-implementation-plan.md).

## Portal and verification options

- [ ] **Funding-chain wallet blocks.** Offer an optional action alongside wallet blocking to review upstream funding addresses and explicitly select additional addresses to block in the same server. Preview the exact addresses before confirmation and reuse the existing block reasons, audit history and role reconciliation. Stop tracing at recognized exchanges or shared services; blocking an exact exchange address does not imply blocking its customers or other recipients. Funding alone is not proof of common ownership. Decide supported networks, data providers, traversal depth and handling of uncertain service labels before implementation. Ordinary Block remains limited to the selected address.
- [ ] **Public community discovery.** Let members discover participating communities beyond the servers they have already joined, with explicit community visibility settings. [Source: portals](../portals.md).
- [x] **Recheck saved wallets without a new signature.** Done November 18, 2026, as **Check saved wallets** on the private Verify Now reply in Discord: one wallet family at a time, with a cooldown. Linking or claiming a wallet still requires proof, and inactive wallets still need a signature. See [saved-wallet checks](../saved-wallet-checks.md). A member-portal version remains optional. [Source: member portal plan](halcyon-core-implementation-plan.md#5-member-portal-and-saved-wallet-management).

## Dropped

- **ord.net linked-wallet lookup — dropped November 15, 2026.** Put on hold October 27, 2026 while waiting on ord.net; no longer planned.

## Privacy, sharing and registration

The accepted October 27 implementation is recorded in the [privacy implementation plan](privacy-implementation-plan.md), with recovery procedures in [privacy operations](../privacy-operations.md).

- [x] **Privacy policy and verification disclosures.** Operator identity/contact, actual collection, community/operator visibility, retention/deletion and backup handling.
- [x] **Per-community wallet sharing and export choices.** Private defaults, new permission epochs, signed verification notices, backend operator allowlist and audited export override; guild mutations retain live Discord permission checks.
- [x] **Fresh server wallet snapshot exports.** Network/family, role Any/All and exclusions, channel, rule/collection, proof date and join cutoff, blocked-wallet exclusion, optional authorized identity columns, and latest proven wallet per member/network. Provider failures abort the snapshot; permission changes are rechecked at download.

- [ ] **Wallet-first accounts with optional X registration.** Introduce a platform-independent Bouncer account with wallet sign-in and optional Discord/X links, supporting people who want neither social platform. Existing accounts are keyed to Discord IDs, so define an account-layer migration rather than inventing Discord identities or a separate wallet registry. X OAuth proves control of the X account; a separate fresh wallet signature proves wallet ownership. Use OAuth 2.0 Authorization Code with PKCE, minimal login permissions and purpose-bound proofs. Define safe account linking, explicit wallet transfers and recovery before implementation. [References: X OAuth flow](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361).

## Optional ideas from the Halcyon guide

The [core plan's scope](halcyon-core-implementation-plan.md#scope) explicitly excluded these ideas. They remain unprioritized; adding them here records the ideas without changing that scope. The guide's names and examples do not establish Bouncer requirements or working integrations.

- [ ] **Rule Blender add-on.** Define its role-composition behavior separately from Bouncer's existing combined collectible counts.
- [ ] **LinkWarden add-on.** Define the behavior first; the checked-in plan names it but does not specify its features.
- [ ] **Social-profile extras.** Define which profile features and account connections would be useful.
- [ ] **Tipping.** Define the intended member/admin flow and supported payment method.
- [ ] **Marketing email collection.** Consider whether there is a product need for an optional email subscription flow.
- [ ] **Rule descriptions.** Add explanatory text alongside rule requirements; keep descriptions distinct from existing selection labels.
- [ ] **Maximum-balance requirements.** Consider upper bounds alongside the existing minimum-balance criteria.
- [ ] **URL-hosted token/inscription ID lists.** Define list formats, validation, size limits and how remote changes affect saved rules.
- [ ] **TON NFT token-ID filters.** Depends on the core TON integration.
- [ ] **XRPL NFT taxon and trait filters.** Depends on the core XRPL integration.

## Asset capabilities and optimizations

- [ ] **Independent compressed Solana NFT proof verification — deferred October 30, 2026.** Routine compressed-NFT checks use Helius/DAS ownership, burn status and verified collection/creator fields, with complete pagination, indexed freshness, bounded fresh asset lookups and role preservation on unavailable data. Consider an additional cryptographic verification layer only if a concrete need justifies reducing trust in provider-reported positive holdings. We still rely on the index for discovery, negatives and mutable traits; proof validation does not eliminate that dependency. Measure API cost, latency and false unavailable results on active trees before adopting it.

  The working V1/V2 prototype is recoverable from Git commit `df0234f`: `backend/src/utils/solana-compressed.util.ts`, the compressed methods in `backend/src/services/solana-ownership.service.ts`, `backend/test/solana-compressed.spec.ts`, the earlier ownership tests and `backend/test/fixtures/{generate-solana-compressed-vectors.cjs,solana-compressed-vectors.json}`. It included independently generated official SDK 6.0.0 vectors, registered TreeConfig/program checks, leaf/metadata/creator hashing and current-finalized-root proofs. Revisit proof/root timing, burn evidence and inherited V2 royalties before reuse; accepting any historical tree root is insufficient to establish current ownership. The source reference was Metaplex Bubblegum commit `accedabc5f162f456bb3421ade7e49a517ece092`. The prototype and proof-only fixtures were removed from active code by user request; no strict mode is currently shipped.

- [ ] **Broader Bitcoin payment-address proofs for Ordinals — deferred October 28, 2026.** Keep the current Taproot Ordinals flow. Revisit only if a concrete community need warrants it, with appropriate address-specific proof validation and wallet tests. Supporting additional formats should not encourage storing inscriptions in ordinary payment wallets; the immediate benefit for current users is limited. Stamps-specific P2PKH/SegWit proofs were subsequently authorized and implemented October 30; see the [Stamps notes](../bitcoin-stamps.md). See [core phase 6](halcyon-core-implementation-plan.md#6-evm-coverage-marketplace-entry-and-additional-wallet-proofs).

- [ ] **Native Tezos support.** Consider a Beacon/Taquito wallet proof and FA1.2/FA2 adapter, with precise contract/token or validated creator scopes, edition quantities and fresh indexed ownership. Solana remains in the core network plan. Implementation considerations for both are in the [non-EVM assessment](non-evm-network-assessment.md); this note does not authorize their implementation.

- [ ] **Token-bound NFT account holdings.** Count assets held inside an NFT's ERC-6551 account after validating the account relationship and current control. Ordinary parent-NFT ownership already works; contract-wallet proof support is tracked in the core plan. [Source: NFT plan](NFT_IMPLEMENTATION_PLAN.md).
- [ ] **Staking integrations.** Define supported protocols and how staked positions qualify, alongside the current directly held asset rules. [Source: NFT plan](NFT_IMPLEMENTATION_PLAN.md).
- [ ] **“Any Ordinal” rule.** Allow a minimum inscription count without selecting a collection or specific IDs/numbers, using complete wallet inventories and distinct inscription counting. [Source: original Ordinals plan](BTC_ORDINALS_IMPLEMENTATION_PLAN.md).
- [ ] **Xverse collection-holder lookup optimization.** Revisit the specific shared holder-list strategy only after validating pagination completeness and transfer freshness. Compare its usefulness and request costs against the current provider flow; the original experiment found incomplete results. [Source: original Ordinals plan](BTC_ORDINALS_IMPLEMENTATION_PLAN.md).

## Dependency maintenance

- [ ] **Upgrade the EVM wallet stack to Wagmi 3 together with AppKit 2.0 — deferred November 16, 2026.** `frontend/package.json` pins `@wagmi/connectors` 6.2.0 (set in #36), which locks WalletConnect `ethereum-provider` to exactly 2.21.1. That old WalletConnect is the only source of the `decode-uri-component` 0.2 advisories, and the same connectors release brings the MetaMask SDK's old `uuid`. `@wagmi/connectors` 8 makes those SDKs optional, so neither would be installed.

  Attempted November 16, 2026 with AppKit kept at 1.8.24 (#155, `@wagmi/core` 3.6.9 and `@wagmi/connectors` 8.2.4). Unit tests, build and all browser smoke suites passed, and MetaMask on desktop, Base Account (desktop, reload and phone) and portal linking passed live. Rainbow on Android connected over WalletConnect, but signing hung with the page waiting and Rainbow not opening, so it was reverted (#156). After the revert, signing also struggled until Rainbow was updated, so the Rainbow app may have been the cause; that was not re-tested on #155. The frontend README already said AppKit 1.8.24 is supported only on Wagmi 2.22.1 / Connectors 6.2.0. Do the upgrade with AppKit 2.0, which Reown built for Wagmi 3 and released November 16, 2026, once it has had some patch releases. Its adapter lists the React `wagmi` package as a peer; check what that pulls in. Connectors 8 restores Base Account sessions without the popup, so remove the #143 restore override in `frontend/src/app/services/base-account.connector.ts`, and switch to the Wagmi 3 names (`getConnection`, `watchConnection`). Before merging, run the build and smoke tests, then live-test MetaMask, WalletConnect signing on mobile (an up-to-date Rainbow) and Coinbase/Base Account, including a reload with Base Account.

  The `zod` 3 advisories can't be fixed from here: AppKit 1.8.24 locks `zod` 3.22.4 exactly, and `@coinbase/cdp-sdk` (via Base Account) requires `^3.25.76`. Recheck when those packages move to `zod` 4. All of these are browser-side denial-of-service issues from oversized input, so they are low priority.

## Related core work and completed items

Multi-trait AND/OR rules and expanded ERC-721 ID selections are complete; see [core phase 3](halcyon-core-implementation-plan.md#3-rule-editor-and-consistent-role-change-behavior) and the [current implementation status](halcyon-core-implementation-plan.md#current-implementation-status). Contract-wallet proofs are implemented and passed live acceptance in November 2026. OpenSea marketplace entry and bounded token-ID discovery passed read-only Ethereum/Base checks; durable API access and live rule-saving/holdings acceptance remain pending. Broader Bitcoin payment-address proofs for Ordinals remain deferred above. Stamps-specific P2PKH/SegWit proofs are implemented in the [Stamps integration](../bitcoin-stamps.md); they do not expand Ordinals ownership coverage. Follow those checkpoints and the remaining networks in [core phase 6](halcyon-core-implementation-plan.md#6-evm-coverage-marketplace-entry-and-additional-wallet-proofs) and [phase 7](halcyon-core-implementation-plan.md#7-remaining-chain-and-asset-families).

Older plans also deferred NFT/Ordinals trait rules and specific inscription selection. Those have since shipped; see [NFT trait rules](../../backend/README.md#evm-nfts), [Ordinals rules](../../backend/README.md#bitcoin-ordinals) and [specific inscription rules](../../backend/README.md#specific-inscription-rules).
