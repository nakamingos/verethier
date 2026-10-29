# Solana and Tezos integration assessment

Reviewed October 28, 2026. This records implementation considerations, not authorization to add either adapter now. Base is prepared separately as an EVM addition. Solana is already in core phase 7; native Tezos is an additional candidate.

## Common Bouncer work

Both need new wallet families with purpose-bound, expiring account/domain challenges and backend signature validation, plus browser/mobile connection handling. Extend saved wallet identities, transfers, blocks, removal history, privacy/retention, member/admin displays and export filters together. Preserve case-sensitive addresses rather than routing them through EVM lowercasing. Validate asset identity, pagination completeness and exact integer quantities before integrating combined collectible counts. Fungible token amounts stay separate from item counts.

Use the existing verification/reconciliation policy: complete non-matches can remove roles; provider/indexer uncertainty retains them. Fresh exports must fail on required incomplete evidence. Wallet registration and message signing require no payment, approval or asset transfer. Staked, escrowed and custodial positions need explicit protocol-specific support rather than inferred ownership.

## Solana

Solana implementation was subsequently authorized October 29, 2026. The initial slice is implemented; see [deployment/acceptance notes](../solana-verification.md) and the [dedicated plan](solana-verification-plan.md). Helius read-only acceptance passed and the production migration was applied October 29. Railway flag enablement and user-assisted live tests remain pending.

- **Wallet proof:** start with a Wallet Standard-compatible wallet and Sign-In with Solana where supported. Verify the exact signed message, account, domain, nonce and expiry on the backend using Ed25519. Phantom documents message signing and origin checks; having its Bitcoin connector does not provide a Solana connector. [Phantom signing](https://docs.phantom.com/solana/signing-a-message).
- **Fungible assets:** identify a token by mint address and token program. Aggregate its owner's token accounts using raw integer amounts and mint decimals. Plan separately for the original Token Program and Token-2022 extensions; define frozen/restricted balance semantics rather than assuming they behave like ERC-20. [Solana tokens](https://solana.com/docs/tokens).
- **NFTs:** collection identity must come from verified collection/creator/edition relationships, never a display name. Token Metadata, Core and compressed Bubblegum assets need deliberate provider coverage. Metaplex DAS offers one interface for these standards, but provider support, freshness, pagination, limits and cost still need validation. [DAS overview](https://www.metaplex.com/docs/dev-tools/das-api).
- **Suggested first release:** proven ordinary wallets, directly held fungible tokens by mint, and a clearly scoped NFT collection/creator rule. Explicitly test supported NFT formats, transfers, stale indexes, delegated accounts and repeated mobile signatures before enabling them. Native SOL minimums would be an additional rule type, not an ERC-20 alias.

## Native Tezos

- **Wallet proof:** use Beacon with Taquito and a documented packed message-signing format, with backend signature/public-key/address verification. Beacon distinguishes message data from operation payloads; request a message proof, not a signed transaction. Test each supported wallet and key type explicitly. [Beacon signing](https://docs.walletbeacon.io/guides/sign-payload/).
- **Assets:** implement FA1.2 fungible balances and FA2 contract-plus-token-ID rules separately. FA2 supports fungible tokens, unique NFTs and editions in one contract, so retain balances/copy counts and integer decimals. A contract alone may be broader than the intended art collection; allow precise token IDs/ranges or a validated creator/collection scope. [FA2 documentation](https://docs.tezos.com/architecture/tokens/FA2).
- **Ownership and metadata:** TzKT is a candidate for paginated token balances and metadata; validate its indexed block freshness, rate limits and response completeness against RPC/representative contracts. Decide how dynamic/IPFS metadata and marketplace escrow qualify. Shared-contract creator filtering is a product/provider decision, not an assumption that every FA2 contract equals one collection. [TzKT API](https://api.tzkt.io/).
- **Suggested first release:** ordinary proven accounts and directly held FA2 tokens/NFT editions with explicit scopes. Treat contract accounts, staking, escrow and native XTZ thresholds as later capabilities unless demanded by the initial communities.

## Recommended sequencing

Ship and validate Base first, then choose one non-EVM integration using real community collections and test wallets. For Solana, provider coverage across NFT formats is the main ownership complication. For Tezos, precise FA2/edition scope and metadata/indexer semantics require particular attention. Both need the wallet-family migration and mobile proof work; neither should be presented as a network-menu-only change. A representative wallet signature, known-positive ownership, transfer/non-match and provider-failure test is a release gate, not something a mocked browser test establishes.
