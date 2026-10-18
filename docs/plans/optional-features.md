# Optional feature backlog

Ideas for later consideration. Core work remains in the [implementation plan](halcyon-core-implementation-plan.md).

## Portal and verification options

- [ ] **Funding-chain wallet blocks.** Offer an optional action alongside wallet blocking to review upstream funding addresses and explicitly select additional addresses to block in the same server. Preview the exact addresses before confirmation and reuse the existing block reasons, audit history and role reconciliation. Stop tracing at recognized exchanges or shared services; blocking an exact exchange address does not imply blocking its customers or other recipients. Funding alone is not proof of common ownership. Decide supported networks, data providers, traversal depth and handling of uncertain service labels before implementation. Ordinary Block remains limited to the selected address.
- [ ] **Public community discovery.** Let members discover participating communities beyond the servers they have already joined, with explicit community visibility settings. [Source: portal roadmap](../portals.md#following-releases).
- [ ] **Recheck saved wallets without a new signature.** Consider an authenticated member action that checks fresh holdings for already-proven saved addresses and respects server blocks. Linking or claiming a wallet still requires proof. This would be a separate verification-policy decision; the current fresh-signature policy remains in place. [Source: member portal plan](halcyon-core-implementation-plan.md#5-member-portal-and-saved-wallet-management).

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

- [ ] **Token-bound NFT account holdings.** Count assets held inside an NFT's ERC-6551 account after validating the account relationship and current control. Ordinary parent-NFT ownership already works; contract-wallet proof support is tracked in the core plan. [Source: NFT plan](../../NFT_IMPLEMENTATION_PLAN.md).
- [ ] **Staking integrations.** Define supported protocols and how staked positions qualify, alongside the current directly held asset rules. [Source: NFT plan](../../NFT_IMPLEMENTATION_PLAN.md).
- [ ] **“Any Ordinal” rule.** Allow a minimum inscription count without selecting a collection or specific IDs/numbers, using complete wallet inventories and distinct inscription counting. [Source: original Ordinals plan](../../BTC_ORDINALS_IMPLEMENTATION_PLAN.md).
- [ ] **Xverse collection-holder lookup optimization.** Revisit the specific shared holder-list strategy only after validating pagination completeness and transfer freshness. Compare its usefulness and request costs against the current provider flow; the original experiment found incomplete results. [Source: original Ordinals plan](../../BTC_ORDINALS_IMPLEMENTATION_PLAN.md).

## Related core work and completed items

Multi-trait AND/OR rules and expanded ERC-721 ID selections remain in [core phase 3](halcyon-core-implementation-plan.md#3-rule-editor-and-consistent-role-change-behavior). New networks, contract-wallet proofs, broader Bitcoin address support and marketplace entry remain in [core phase 6](halcyon-core-implementation-plan.md#6-evm-coverage-marketplace-entry-and-additional-wallet-proofs) and [phase 7](halcyon-core-implementation-plan.md#7-remaining-chain-and-asset-families). Automatic NFT token-ID discovery from the older NFT plan overlaps the marketplace/ERC-1155 discovery work in phase 6; track that overlap there.

Older plans also deferred NFT/Ordinals trait rules and specific inscription selection. Those have since shipped; see [NFT trait rules](../../backend/README.md#nft-trait-rules), [Ordinals usage](../../README.md#environment-overview) and [specific inscription rules](../../backend/README.md#specific-inscription-rules).
