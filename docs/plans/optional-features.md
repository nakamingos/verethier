# Optional feature backlog

Ideas for later consideration. Core work remains in the [implementation plan](halcyon-core-implementation-plan.md).

## Portal and verification options

- [ ] **Funding-chain wallet blocks.** Offer an optional action alongside wallet blocking to review upstream funding addresses and explicitly select additional addresses to block in the same server. Preview the exact addresses before confirmation and reuse the existing block reasons, audit history and role reconciliation. Stop tracing at recognized exchanges or shared services; blocking an exact exchange address does not imply blocking its customers or other recipients. Funding alone is not proof of common ownership. Decide supported networks, data providers, traversal depth and handling of uncertain service labels before implementation. Ordinary Block remains limited to the selected address.
- [ ] **Public community discovery.** Let members discover participating communities beyond the servers they have already joined, with explicit community visibility settings. [Source: portal roadmap](../portals.md#following-releases).
- [ ] **Recheck saved wallets without a new signature.** Consider an authenticated member action that checks fresh holdings for already-proven saved addresses and respects server blocks. Linking or claiming a wallet still requires proof. This would be a separate verification-policy decision; the current fresh-signature policy remains in place. [Source: member portal plan](halcyon-core-implementation-plan.md#5-member-portal-and-saved-wallet-management).

## Waiting on provider clarification

- [ ] **ord.net linked-wallet lookup — on hold October 27, 2026.** The user has asked ord.net whether Bouncer can authenticate with its funded API wallet, supply another member's address, and retrieve that member's publicly linked wallets. Resume after their response. The [published API](https://developers.ord.net/openapi.json) documents the authenticated account's `/me` wallet bindings, but no lookup of another address's public links. Member-authenticated access has a payment-address balance requirement; it has not established whether one wallet login returns every wallet linked to the profile. A temporary local Xverse test was prepared and its challenge-format mismatch corrected; the member reported the funding requirement blocked the test. No successful linked-wallet lookup or production integration has been established. The temporary test server was stopped when this investigation was tabled.

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

- [ ] **Broader Bitcoin payment-address proofs — deferred October 28, 2026.** Keep the current Taproot Ordinals flow. Revisit only if a concrete community need warrants it, with appropriate address-specific proof validation and wallet tests. Supporting additional formats should not encourage storing inscriptions in ordinary payment wallets; the immediate benefit for current users is limited. See [core phase 6](halcyon-core-implementation-plan.md#6-evm-coverage-marketplace-entry-and-additional-wallet-proofs).

- [ ] **Native Tezos support.** Consider a Beacon/Taquito wallet proof and FA1.2/FA2 adapter, with precise contract/token or validated creator scopes, edition quantities and fresh indexed ownership. Solana remains in the core network plan. Implementation considerations for both are in the [non-EVM assessment](non-evm-network-assessment.md); this note does not authorize their implementation.

- [ ] **Token-bound NFT account holdings.** Count assets held inside an NFT's ERC-6551 account after validating the account relationship and current control. Ordinary parent-NFT ownership already works; contract-wallet proof support is tracked in the core plan. [Source: NFT plan](../../NFT_IMPLEMENTATION_PLAN.md).
- [ ] **Staking integrations.** Define supported protocols and how staked positions qualify, alongside the current directly held asset rules. [Source: NFT plan](../../NFT_IMPLEMENTATION_PLAN.md).
- [ ] **“Any Ordinal” rule.** Allow a minimum inscription count without selecting a collection or specific IDs/numbers, using complete wallet inventories and distinct inscription counting. [Source: original Ordinals plan](../../BTC_ORDINALS_IMPLEMENTATION_PLAN.md).
- [ ] **Xverse collection-holder lookup optimization.** Revisit the specific shared holder-list strategy only after validating pagination completeness and transfer freshness. Compare its usefulness and request costs against the current provider flow; the original experiment found incomplete results. [Source: original Ordinals plan](../../BTC_ORDINALS_IMPLEMENTATION_PLAN.md).

## Related core work and completed items

Multi-trait AND/OR rules and expanded ERC-721 ID selections are complete; see [core phase 3](halcyon-core-implementation-plan.md#3-rule-editor-and-consistent-role-change-behavior) and the [current implementation status](halcyon-core-implementation-plan.md#current-implementation-status). Contract-wallet proofs are implemented with deferred live acceptance. OpenSea marketplace entry and bounded token-ID discovery passed read-only Ethereum/Base checks; durable API access and live rule-saving/holdings acceptance remain pending. Broader Bitcoin payment-address support is explicitly deferred above. Follow those checkpoints and the remaining networks in [core phase 6](halcyon-core-implementation-plan.md#6-evm-coverage-marketplace-entry-and-additional-wallet-proofs) and [phase 7](halcyon-core-implementation-plan.md#7-remaining-chain-and-asset-families).

Older plans also deferred NFT/Ordinals trait rules and specific inscription selection. Those have since shipped; see [NFT trait rules](../../backend/README.md#nft-trait-rules), [Ordinals usage](../../README.md#environment-overview) and [specific inscription rules](../../backend/README.md#specific-inscription-rules).
