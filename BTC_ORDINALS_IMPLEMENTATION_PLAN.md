BTC Ordinals support — implementation plan

Branch: `feat/btc-ordinals-verification`, based on `main` at `7e3ccfe`.
Research date: 2026-10-07. Implementation date: 2026-10-08. Provider: Xverse. The local implementation includes wallet proof, collection/count rules, wallet stacking, role monitoring and a tested migration. The production database migration was applied on 2026-10-08 after a fresh backup and successful restore rehearsal; app deployment remains pending. Authenticated ownership lookups passed for Pizza Comrades, and one wallet-summary request was measured at 40 credits. Additional collections, transfer freshness, listing behavior and other endpoint costs still need confirmation.

Start with Bitcoin mainnet, collection ownership and minimum inscription counts. Support Xverse only, using its Taproot Ordinals address (`bc1p…`). Keep the current Discord setup command, verification page, wallet stacking and role monitoring.

1. Use Xverse ownership lookups, with the live proof as the starting point.

   Authenticate against `https://api.secretkeylabs.io` using `XVERSE_API_KEY` in the `x-api-key` header. The key is already present in Git-ignored `backend/.env`; keep it on the backend, including in Railway configuration at deployment.

   Live proof on 2026-10-07:
   - Target: [Pizza Comrades on Satflow](https://www.satflow.com/ordinals/pizza-comrades).
   - Wallet: `bc1pqq7gz5dnkmqa2w4c8tgt8j0wk2zl4umh49kmctykuf9njugp785srx2arl`.
   - Xverse collection metadata identifies `pizza-comrades` as Pizza Comrades.
   - The collection-filtered endpoint reported 76 inscriptions; reading all four pages returned 76 distinct IDs.
   - The confirmed wallet endpoint returned the same 76 IDs, all tagged `pizza-comrades`, with the supplied wallet as `currentAddress`.
   - A single wallet-collections summary request also returned Pizza Comrades with a collection-specific `total` of 76. Its `inscriptionSubset` contained only four examples; use the collection's `total` for its count, not the subset length or the wallet-wide `totalInscriptions`.
   - A separate address from Xverse's documentation returned zero inscriptions for this collection.
   - A batch detail request for two Pizza Comrades inscriptions returned ownership and collection information, but no trait, attribute or metadata fields. The documented single-inscription schema also has no collection-trait fields. Collection/count rules are supported by this proof; trait rules require a separately verified metadata source keyed by inscription ID. Do not treat inscription `charms` as collection artwork traits.
   - Metadata returned supply `0`, despite returning ownership data. Use stable ID/name for setup; do not rely on that supply field for ownership or completeness.

   Start with `GET /v1/ordinals/address/{address}/collections`, which returns collection IDs and per-collection ownership counts. The supplied wallet needed one request, rather than four inscription pages. Fetch the complete collection summary once per wallet per verification or monitoring run and reuse it across applicable rules, roles and servers. [Wallet collections](https://docs.xverse.app/api/ordinals/ordinals-by-address/collections)

   The live summary returned 25 collections per page, even when requesting `limit=60`. Paginate using the returned page size and `totalCollections`; require stable totals, expected offsets, unique collection IDs and a complete result before treating an absent collection as zero. Wallets holding more than 25 different collections may require more requests.

   The implementation's live test found a summary HTTP 500 for an empty Taproot address while its collection-specific endpoint returned a complete response with `total: 0`. For this summary error, fall back to the collection-specific IDs endpoint and require complete pagination. Never infer zero from an HTTP error. Share fallback reads across matching rules too.

   For a user with one verified Bitcoin address, use the summary's collection count directly. To preserve distinct-inscription counting when stacking multiple Bitcoin addresses, fetch the relevant inscription IDs and deduplicate across those addresses; do not attempt to deduplicate with the summary's incomplete `inscriptionSubset`. Share these reads too. `GET /v1/ordinals/address/{address}/inscriptions/collection/{collectionId}` supplies the collection-filtered IDs, total and offset pagination. [Address-and-collection lookup](https://docs.xverse.app/api/ordinals/ordinals-by-address/inscriptions-of-a-collection)

   `GET /v1/ordinals/address/{address}/inscriptions` is also available for complete wallet IDs and current addresses. Its live responses were paginated at 25 items despite the published full-list description. Implement against observed responses, reject repeated pages and unexpected offsets, and bound pagination. Collection-filtered reads must have stable totals matching the unique IDs received. Their response uses `inscriptions` and `currentLocation`; wallet responses use `items` and `currentAddress`. [Confirmed wallet inscriptions](https://docs.xverse.app/api/ordinals/ordinals-by-address/inscriptions)

   Deduplicate concurrent requests and addresses, and cache collection metadata separately. The current monitor evaluates individual role assignments, so the shared lookup cache must cover the entire monitoring run, rather than just one role evaluation. The code defaults to checks every six hours, but deployments can override the schedule. Preserve the current schedule initially and confirm the deployed value before budgeting.

   An alternative is fetching a collection's holder list once and sharing its address-to-count map across all users. Pizza Comrades reported 456 holder addresses at 25 per page, implying 19 requests for a complete scan. However, the test found one holder address repeated across pages, so the scan failed completeness validation. Defer this optimization until pagination and ownership freshness are validated; do not use an incomplete holder list to remove roles. Its credit cost has not been independently measured. [Collection holders](https://docs.xverse.app/api/ordinals/collections/holders-by-collection)

   The proof encountered a 429 during rapid consecutive requests; slower requests succeeded. Add request throttling, bounded backoff, timeouts and pagination limits. Treat provider failure or quota exhaustion as unavailable and retain existing roles. Do not pay for requests or change plans automatically.

   Store Xverse's stable collection ID in the existing `slug` field and validate setup through collection metadata. Confirm coverage for each collection; missing tags do not establish zero ownership for an unindexed collection. Test transfer freshness and listed inscriptions before release. The frontend connects only to the Xverse provider.

   Published API-key pricing offers a free 10-day trial with 250,000 credits and 100 requests per minute. Prepaid access has no subscription fee and credits do not expire; the rate is $1 per 100,000 credits. The user reports a $20 minimum purchase, matching the first advertised package of two million credits. Developer subscription pricing is $59/month billed monthly. [Pricing](https://www.xverse.app/api/pricing), [dashboard](https://api-dashboard.xverse.app/login)

   The initial proof used 480 credits across 12 API attempts, including one rate-limited response. A subsequent isolated wallet-collections summary request increased dashboard usage from 480 to 520 credits: 40 credits for that tested request, or $0.0004 at the prepaid rate. This does not establish the cost of other endpoints or failed requests.

   Budget using the measured summary request: one Bitcoin wallet needing one page, checked four times per day for 30 days, uses 120 requests and 4,800 credits ($0.048 per month). If all 123 users have one such Bitcoin wallet, that is 14,760 requests and 590,400 credits, about $5.90 per month. A $20/two-million-credit balance covers about 3.4 months at that workload. These estimates assume sharing across roles and exclude initial verifications, metadata reads, retries, empty-wallet fallbacks, extra collection pages and multi-wallet inscription reads. Users with only Ethereum verification do not require Xverse ownership calls. Initial verification and its “Additional Roles Available” message share the same ownership context too.

   Xverse is the selected provider. Configure ongoing backend API access before production rollout.

2. Extend the existing `/setup add-rule` flow.

   Add `Ordinals` as an `asset_type` choice, stored as `ordinal`. Reuse `slug`, `collection_name` and `min_items`. Require an explicit collection slug and validate it through the provider; minimum defaults to one. Start with manual slug entry and obtain the display name from collection metadata when available.

   Example:

   ```text
   /setup add-rule channel:#verify role:Holder asset_type:Ordinals slug:pizza-comrades min_items:1
   ```

   Bitcoin mainnet is implicit for Ordinals rules. Existing NFT network choices continue to apply to NFT rules. Keep the existing confirmation, duplicate warning, undo, list and removal flows; show “Bitcoin · Ordinals” alongside the collection. The first release uses whole-collection rules; reject trait filters explicitly during Ordinals setup so they cannot silently grant a collection-wide role. Trait support requires verified metadata, such as an official collection manifest mapping inscription IDs to traits, alongside live ownership checks. Individual inscription selection and an “any Ordinal” rule can follow later.

3. Add Bitcoin wallet proof to the current verification page.

   Keep the existing two steps: connect wallet, then sign to verify. Determine the allowed wallet families from the channel's rules using the server's nonce context. Select Bitcoin automatically for an Ordinals-only channel; show a small Ethereum/Bitcoin choice for mixed channels. Users can verify additional wallets through the existing Discord flow.

   Add a `BitcoinWalletService` for Xverse using `@sats-connect/core` with the explicit `XverseProviders.BitcoinProvider` provider. Connect and sign with the address holding the Ordinals. Xverse distinguishes Ordinals and payment addresses; request the Ordinals address explicitly. Recheck the connected account before and after BIP-322 signing. [Xverse signing](https://docs.xverse.app/sats-connect/bitcoin-methods/signmessage)

   Add a backend Bitcoin signature verifier using `bip322-js`, tested against official valid/invalid vectors and signed server challenges. Accept supported prefixed and older unprefixed simple, single-key Taproot signatures; reject legacy and script-path proofs. A real Xverse wallet signing smoke test remains part of release validation. [BIP-322 specification](https://github.com/bitcoin/bips/blob/master/bip-0322.mediawiki)

   The server builds the exact challenge with the app/domain, wallet family, address, Discord user/server/channel, cryptographic nonce and expiry. Verify against that saved challenge and consume it once before linking the wallet. Reuse the current nonce context and expiry flow, with cryptographic randomness and atomic consumption for the new proof path. Provider API authentication is handled separately by the backend; users sign a Verethier verification message.

4. Extend the existing database tables.

   Add `wallet_type` to `user_wallets`, defaulting existing rows to `evm`; new Bitcoin rows use `bitcoin`. Retain the unique-address ownership guard and the existing transfer-to-new-Discord-user behavior after a valid wallet proof. Validate and canonicalize addresses by family: validate Bitcoin checksums/network before normalizing Bech32 case. Avoid applying the current unconditional Ethereum lowercase logic to future Bitcoin address formats.

   Extend `verifier_rules.asset_type` to accept `ordinal`. Store the provider's collection identifier in `slug` and reuse `collection_name` and `min_items`. Require Ordinals rules to have a specific slug and empty NFT contract/token fields. Allow `chain_id` to be null for Ordinals; keep existing EVM values and defaults intact. Add an Ordinals-specific duplicate index using server, channel, role, slug and minimum count. No separate rules table or locally indexed inscription table is needed initially.

   Add optional typed wallet lookup. The shared engine loads both families and `AssetOwnershipService` selects Bitcoin addresses for Ordinals and EVM addresses for existing providers. Manual verification, monitors, wallet claims and audit links support both families. Bitcoin normalization is safe for this release's Bech32 Taproot addresses; future Base58 support requires separate handling.

5. Plug ownership checks into the shared role engine.

   Add `OrdinalsOwnershipService` and route Ordinals rules through `AssetOwnershipService`. Use collection-summary counts for a single verified Bitcoin address, and the union of complete inscription IDs when stacking multiple Bitcoin addresses. Deduplicate addresses and IDs, reject repeated pages, and retain the current distinct-item semantics. An Ethereum signature proves an Ethereum wallet; a Bitcoin signature proves a Bitcoin wallet. Existing verified wallets of both families can contribute to their respective rules during a shared role check.

   Keep the current OR behavior for multiple rules granting the same role, and reuse scheduled re-verification. Use only ownership semantics verified with the provider, including the agreed handling of listings and confirmed transfers.

   API failure, expiry, rate limiting, incomplete pagination, stale ownership or unresolved owners should yield an unavailable check, with existing roles retained and check timestamps left unchanged. Do not publish partial scans as a complete ownership count. Use bounded retries, pagination/time limits and per-run request sharing. Keep provider credentials on the backend.

6. Validate and release in the existing order.

   Test valid/invalid Bitcoin signatures, wrong addresses, expiry/replay, wallet account changes, checksum/network validation and wallet ownership transfers. Test invalid API keys, quota/rate limits, summary counts versus subset lengths, collection pagination, complete inscription pagination, duplicate IDs, multiple verified wallets, transferred/listed inscriptions, unknown owners and provider failures. Verify that one wallet-summary lookup is shared across applicable rules, roles and servers within a run. Test Bitcoin-only and mixed-family channels, including roles with alternative EVM and Bitcoin rules, plus all existing Ethereum/Robinhood tests.

   The disposable PostgreSQL migration/backup rehearsal passes: existing rules, wallets and role assignments are preserved, new constraints and duplicates are tested, and custom/SQL backups restore correctly. A fresh production backup at `backup/ordinals-20261008171842-UTC` was restored locally and every value in its 43 rules, 237 wallets and 1,113 role assignments matched. The exact guarded rollout transaction passed locally, then was applied remotely with atomic checks preserving existing records, permissions and indexes. Version `20261008010000` was recorded in production migration history.

   Release order: confirm API access and run a small read-only ownership proof → implement and test locally → fresh backup/restore rehearsal → apply the reviewed migration → configure backend provider credentials → deploy backend and frontend through a PR → test a known holder, non-holder and subsequent transfer on a test Discord role.

The user confirmed `XVERSE_API_KEY` was added to the Railway backend on 2026-10-08. The fresh backup, restore rehearsal and production migration are complete. Release work remaining: deploy backend/frontend, then verify in Xverse on a test Discord role with a holder, non-holder and subsequent transfer/listing. Use Node.js 20.19+ and the existing frontend origin for backend `BASE_URL`. No Bitcoin RPC or frontend provider API key is required.
