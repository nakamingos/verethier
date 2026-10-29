# Solana verification scope

Prepared October 29, 2026. The user subsequently authorized implementation. The initial ordinary-wallet, fungible-token and Token Metadata/Core NFT slice is implemented; see [Solana implementation and deployment notes](../solana-verification.md). Helius read-only provider acceptance passed and the production migration was applied October 29. Railway flag enablement and real-wallet acceptance remain pending. Existing OpenSea and smart-wallet live acceptance stays deferred at the user's request. Compressed NFTs and other later capabilities below remain follow-ups.

## Recommended product scope

Add Solana mainnet as a separate wallet family and asset adapter. Keep Discord as the member identity and reuse Bouncer's wallet linking, fresh verification, transfers, role reconciliation, privacy and exports. A member connects a supported wallet, signs a readable ownership challenge and receives eligible roles under the existing channel rules. Signing requires no transaction, token approval, fee or asset transfer.

| Capability | Initial release target | Later scope |
| --- | --- | --- |
| Wallets | Wallet Standard discovery; Phantom as the first explicitly supported desktop/mobile wallet. Add Solflare acceptance before advertising it. | Other wallets, hardware compatibility and program/multisig account proofs need their own acceptance. |
| Fungible tokens | Minimum holdings of a specific mint, summed across all directly owned token accounts and saved Solana wallets. Original Token Program plus explicitly supported transparent Token-2022 balances. | Confidential balances, protocol staking, LP/deposit receipts and extension-specific economic balances. |
| NFT rules | Verified collection, verified creator, or explicit asset IDs; positive integer minimum and optional existing AND/OR trait matching. Multiple addresses within one selected scope mean OR. | Master-edition/print ancestry, mixed creator-and-collection expressions and marketplace slug lookup. |
| NFT formats | Token Metadata ordinary/programmatic NFTs and Core assets are initial targets, enabled independently once their ownership and relationship checks are implemented. | Compressed Bubblegum NFTs are a separate second delivery stage; do not label them supported until complete. |
| SOL | Not part of the initial fungible-token rule. Wrapped SOL is an ordinary mint rule with its own scope. | Native SOL minimums are a separate possible addition. |

These are proposed defaults, not claims that all formats are interchangeable or already supported. Creator filtering applies only when that format exposes a validated verified-creator relationship. Core collection membership uses Core's own relationship, not an assumed Token Metadata field. Never infer NFT identity solely from decimals, supply, name or symbol.

## Proof and wallet identity

Use Wallet Standard features without bringing a React wallet UI into Angular. Prefer supported Sign-In with Solana (SIWS); use a precisely specified message-signing fallback where needed. Bind every challenge to purpose (verification/link/transfer), Discord member, authenticated session or verification flow, mainnet cluster, domain/URI, selected account, nonce, issue time and expiry. Preserve current one-time consumption and concurrent-transfer guarantees.

Backend Ed25519 verification must compare the exact expected message and signer. Wallet Standard can return plain SIWS or an off-chain message envelope; verify the declared format explicitly and reject unsupported versions, extra signers or altered fields. Do not pass an envelope to a plain-SIWS verifier. No transaction-signing fallback in the initial release. Reuse connections, never a consumed proof; cancellation and account changes leave the flow resumable.

Solana addresses are case-sensitive base58 public keys. Decode and validate 32 bytes and round-trip canonical encoding; never lowercase them. Proven ordinary signer accounts must have a supported Ed25519 proof. A program-derived address or multisig asset account is not proven by one controller's personal signature. A proven owner is a wallet address, not its associated token account.

Official background: [Solana message authentication and SIWS](https://solana.com/docs/frontend/messages-and-auth) and [Wallet Standard SIWS](https://github.com/phantom/sign-in-with-solana). This is a proposed Bouncer proof policy; feature availability must be checked on the actual wallet connection.

## Rule and ownership semantics

For fungible rules, save the canonical mint, owning token program, verified decimals and decimal-string minimum. Query by owner and mint, validate account program/mint/owner, and sum raw integer amounts with bigint. Compare exact base units; never use a floating UI balance or price. Missing token accounts yield zero only after a successful complete response. Use finalized RPC reads and verify the configured cluster identity.

Token-2022 is an extension-bearing program, not a promise that every extension has ordinary balance semantics. Inspect mint/account extensions and use an explicit allowlist. Count transparent recorded holdings, including publicly visible frozen balances, as ownership rather than spendability. Exclude withheld transfer fees, confidential balances and amounts outside the proved owner's accounts. Unknown or unsupported balance-affecting extensions prevent a definitive result. Interest/scaled UI displays need explicit handling; do not silently substitute their displayed amount for base-unit holdings. Show this ownership policy in setup/review.

For NFT rules, store a discriminated scope (`collection`, `verified_creator`, `asset_ids`; later `master_edition`) with addresses and asset format capability. Bound explicit addresses/IDs using editor/server limits; proposed starting limits are 20 scope addresses or 1,000 explicit asset IDs, subject to request-size validation. Solana asset IDs are addresses, not EVM numeric token ranges. Do not overload `contract_address`, EVM chain IDs or the ERC-1155 IDs 0–99 default.

Read current owner and validated collection/creator relationship. Ignore burned assets and exclude a collection account itself from item counts. Delegated authority is not ownership; a directly owned frozen/programmatic NFT may count, while an escrowed/staked/listed asset held by a program does not count without a separate protocol adapter. Any ambiguous ownership/relationship returns unavailable. Traits filter the same asset with existing case-insensitive AND/OR semantics; unavailable required metadata is unavailable, not a non-match. Treat trait metadata as mutable provider evidence, not a permanent identity guarantee.

Deduplicate by mainnet plus canonical asset ID across wallets, pages, rules and standard transitions before existing combined-count aggregation. Ordinary unique NFTs contribute one each; never turn token balances into NFT counts merely because a mint has zero decimals. Future edition support must validate the actual master/print relationship and count distinct owned prints, not invent an ERC-1155-style quantity.

References: [token accounts by owner](https://solana.com/docs/rpc/http/gettokenaccountsbyowner), [Token-2022 extensions](https://solana.com/docs/tokens/extensions), [Core collection relationships](https://www.metaplex.com/docs/smart-contracts/core/collections), and [indexed edition discovery](https://www.helius.dev/docs/api-reference/das/getnfteditions). Edition discovery does not by itself establish current ownership.

## Provider and failure policy

Recommend Helius as the initial RPC/Digital Asset Standard (DAS) provider behind an internal adapter. This is a recommendation, not a subscription purchase or a coverage guarantee. Use backend-only `SOLANA_RPC_URL` and `SOLANA_DAS_URL`; both may initially point at a Helius endpoint. Keep credentials in backend configuration and redact credential-bearing URLs from logs. Devnet fixtures may aid development, but only mainnet rules/wallets appear in the initial product.

Use RPC for mint/account balances and validation, DAS for owner inventories, asset details and indexed relationships. Fetch one reusable inventory per wallet/check rather than a separate scan per rule. Validate each returned owner, interface, relationship and asset ID instead of trusting provider query filters alone. DAS advertises owner discovery across NFT formats, verified-creator queries and pagination, but those claims still need format-specific validation: [owner API](https://www.helius.dev/docs/api-reference/das/getassetsbyowner), [creator API](https://www.helius.dev/docs/api-reference/das/getassetsbycreator).

Proposed initial operational bounds: ten-second request timeout, thirty-second foreground evaluation budget, two concurrent upstream requests per process and a provider-wide rate limiter configurable to the actual account quota. Background/export work uses bounded resumable jobs. Page sizes/cursors follow documented provider limits; enforce duplicate, repeated-cursor, count and maximum-page checks. Hitting a limit is incomplete/unavailable, never a partial zero. Final request budgets must be measured against selected collections and server size before enabling production.

Require provider provenance and an indexed slot/freshness signal where available; record evidence time/slot separately from proof time. RPC finalized commitment is not evidence that a DAS inventory is current. If the selected DAS method cannot demonstrate sufficient freshness/completeness for a negative result, confirm through a suitable supported path or return unavailable. Never claim a fully atomic snapshot across paginated index reads. Retry or mark unavailable when movement/duplicates make results inconsistent. Provider fallback must independently satisfy the same rules.

An incomplete check cannot revoke an existing role or produce an authoritative export. Retain existing Bouncer behavior for positive/negative/unavailable outcomes and alternative rules. Fresh exports may refresh public holdings without demanding a new signature, but must preserve saved proof scope and member permissions. Provider errors never widen a rule, silently skip unsupported holdings or use partial inventory as exhaustive evidence.

## Bouncer integration and migration

The current `WalletType` union is `evm | bitcoin`; `wallet-block.service.ts` also infers Bitcoin from any non-`0x` address. Both must become explicit family-aware operations. Audit every binary EVM/Bitcoin branch, including scope helpers, before adding Solana.

Add `solana` through wallet identity/uniqueness constraints, proof records, challenges, current/history RPCs, server blocks, activity, removal/transfer reconciliation, retention/deletion, shared-wallet audits and explorer links. Preserve all current identities and history; historical EVM/Bitcoin rows retain their original interpretation. Do not automatically reclassify stored values from their spelling. Keep public key case in database comparisons and exports. Family plus cluster plus canonical address identifies a Solana wallet; avoid accidentally treating it as an EVM chain-scoped smart wallet.

Use additive validated Solana rule fields or a dedicated typed criteria structure, with equivalent DB constraints and adapters. Determine the minimal schema against existing migrations during implementation; this plan does not introduce an unchecked generic criteria blob. Carry the family/network through review, save, revisions, undo/redo, bulk reconciliation, diagnostics and authorization. Migration rehearsal must preserve existing wallet/rule counts and verify backward-compatible service-role RPC signatures and permissions before production changes.

UI work includes a Solana wallet choice in verification and member management; network-appropriate NFT and fungible editors; clear scope/standard review; member lookup, privacy choices, history and explorer links; server blocks/audits; and Solana network/mint export filters. Include Solana in setup diagnostics and background checks. Add a `/setup` Solana command path calling the same validated operations if slash-command rule creation remains supported. Keep existing styles and touch behavior.

## Delivery sequence

1. **Foundation:** finalize provider contract and typed criteria, family-safe identity helpers, additive migration, challenge/proof validation and Phantom connector. Keep the Solana capability disabled while incomplete.
2. **Fungible release slice:** original Token Program plus allowlisted transparent Token-2022 balances, rule editor, reconciliation and permission-respecting exports. Include unit/fixture/browser regression coverage.
3. **NFT release slice:** verified collection/creator and explicit IDs for Token Metadata/programmatic NFTs, then Core with its own relationship validation. Add existing trait/count/combined-group behavior and diagnostics; independently gate unsupported format/scope combinations.
4. **Compressed NFTs:** Bubblegum ownership/identity/version handling, collection/creator semantics, burns/transfers and pagination/freshness checks. Compressed assets need their own capability gate; do not silently ignore them in a rule advertised to cover them.
5. **Deferred acceptance and enablement:** later owner-assisted mainnet signing/mobile checks, representative positive/negative holdings, transfers, cancellation, provider outages and privacy/export regression. Run migrations and enable supported slices only after the separate release decision.

Master editions, native SOL, protocol staking/escrow, Squads/program accounts, hardware wallets and more wallet apps remain explicit follow-ups. No Solana owner testing is requested now. Development can use deterministic signatures and RPC/DAS fixtures; those do not replace later live acceptance.

## Inputs needed later

Before provider-backed implementation, arrange a backend RPC/DAS endpoint with an adequate quota. Before live release acceptance, select representative community collection/mint addresses and willing wallet owners. Those inputs are not needed for this planning step. No recurring paid provider plan, production migration or live member/rule mutation is implied by this proposal.
