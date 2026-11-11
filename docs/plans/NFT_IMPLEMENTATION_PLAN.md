# NFT verification implementation plan

Add Ethereum mainnet NFT rules to the existing verification flow. Users continue to click the same Discord button, connect a wallet, sign the same message, and receive their eligible roles. Existing Ethscriptions rules keep their current behavior.

1. **Extend the current rules table.**

   Add a new Supabase migration for `verifier_rules`:

   | Field | Behavior |
   | --- | --- |
   | `asset_type` | `ethscription` or `nft`; existing rules default to `ethscription` |
   | `chain_id` | Default `1`; mainnet only for this release |
   | `contract_address` | Lowercase contract address for NFT rules |
   | `token_standard` | `erc721` or `erc1155`, checked when creating an NFT rule |
   | `token_ids` | Canonical decimal strings in a text array; represents the configured IDs to check |
   | `collection_name` | Resolved NFT display label: admin override, available contract name, or abbreviated address |

   Reuse `min_items`, Discord scope, and role fields. Keep the current Ethscriptions slug and attribute fields; NFT rules use a null slug and no attribute filter. For ERC-721, null `token_ids` means the whole contract; a one-element array can select a specific token. For ERC-1155, store the actual configured ID list, including the default `0–99`, when creating the rule.

   Validate positive thresholds, valid addresses and uint256 IDs, and valid field combinations. Normalize, deduplicate, and sort ID lists before saving. Replace rule uniqueness with separate indexes for Ethscriptions criteria, NFT collection rules, and NFT rules with configured IDs. Include the chain, contract, standard, IDs, and threshold in NFT duplicate detection.

   Keep `user_wallets` and `verifier_user_roles`. Use the existing `verification_data` JSON field for matched rule IDs and latest check details. A new tracking table is unnecessary for this release.

2. **Add NFT ownership reads behind a small shared service.**

   Add `AssetOwnershipService` to route Ethscriptions checks to the existing `DataService` and NFT checks to a new `NftOwnershipService`. Keep Ethscriptions queries and marketplace escrow handling in `DataService`.

   The frontend already uses an RPC provider for its wallet integration. The backend currently recovers signatures locally and reads Ethscriptions ownership from Supabase. Use the backend's existing `viem` dependency and add a server-side `RPC_URL` setting, which can use the existing RPC provider. Ethscriptions-only installations continue to work without that setting; NFT setup reports a clear configuration error when it is missing.

   - ERC-721 collection rules sum `balanceOf` across the user's verified wallets. A specific-token rule uses `ownerOf` and requires one item.
   - ERC-1155 rules call `balanceOfBatch` for the configured IDs across verified wallets. Default to IDs `0–99` and batches of 100 wallet/ID pairs. Start with a maximum of 1,000 configured IDs per rule to bound request work.
   - Reuse `min_items`. ERC-1155 quantities count copies across the configured IDs, not distinct designs; the default threshold of one implements "owns anything" within that ID list.
   - Deduplicate wallets and use one block snapshot for each NFT verification run. Use `bigint` for calculations and decimal strings for JSON and saved evidence.
   - Eligibility-only checks may stop once the threshold is met. Existing result and potential-role counters use complete counts within the configured scope, so an early result is never displayed as a full inventory count.

   Reuse holdings within the same verification run. No indexer, persistent NFT ownership database, or new cache infrastructure is needed.

3. **Use the shared evaluator everywhere roles are checked.**

   Update `VerificationEngine`, `DynamicRoleService`, `SimpleRoleMonitorService`, engine-based assignment re-verification, and potential-role analysis in `DiscordVerificationService`. All ownership checks use the same routing and threshold logic.

   Evaluate applicable rules together for each role. Any passing rule grants or retains the role. Revoke only when all applicable rules conclusively fail; an unavailable check leaves an existing role in place. Keep these outcomes distinct and do not mark an unavailable check as a successful verification.

   Re-evaluate the current rules for a role instead of relying on the assignment's single saved `rule_id`. Keep that legacy field for compatibility and save the matched rule IDs in `verification_data`. Scheduled removal remains limited to roles managed by the bot. Preserve the existing channel scopes and re-verification schedule.

4. **Extend `/setup add-rule` with optional NFT inputs.**

   Keep `/setup add-rule`, required `channel` and `role`, and all existing Ethscriptions options. Add optional inputs:

   - `asset_type`: choices `Ethscriptions` and `NFT`; defaults to Ethscriptions so existing commands work as before.
   - `contract_address`: required by validation when `asset_type` is NFT.
   - `token_ids`: accepts a single ID, a comma-separated list, or a range such as `0-199`. Omitted means the whole ERC-721 contract or the default ERC-1155 range `0–99`.
   - `collection_name`: optional admin override for the friendly collection label.

   Detect and validate the supported NFT standard from the contract during setup. Require a supported, unambiguous standard for this release. ERC-721's optional selector accepts one ID. Reject options for the wrong asset type using the current admin feedback pattern. Keep existing Ethscriptions autocomplete and explain NFT options in `/setup help`.

   Resolve the display label once during setup: use an admin-provided name first, otherwise try the contract's `name()`, otherwise use an abbreviated address. ERC-721 metadata can provide a collection name; ERC-1155 does not require a collection-wide `name()`. Missing names do not block rule creation. Store the resolved label and skip token-metadata fetching in this release.

   Preserve role creation, duplicate confirmations, remove/list rules, recovery, and undo. Carry the new fields through every save, confirmation, and restoration path. Show the configured ERC-1155 ID scope in admin rule details.

   Example: `/setup add-rule channel:#verify role:Member asset_type:NFT contract_address:0x…`

5. **Keep the current verification UI and message layout.**

   Keep the Angular page, wallet connection, EIP-712 payload, nonce handling, API endpoint, loading states, and Discord verification button.

   Change the page's Ethscriptions-specific sentence to: "Sign a message with your wallet to check your collection for eligible roles in this server."

   Extend existing rule labels, requirement counters, and role-result messages to describe NFTs using the saved collection label. Keep the existing embed layout and error presentation. An NFT RPC failure produces a retry message through that flow; other successfully evaluated rules can still grant roles.

6. **Verify and release in order.**

   Extend the existing Jest tests to cover legacy rule defaults, NFT rule creation and undo, automatic names and admin overrides, missing names, ERC-721 counts, ERC-1155 default/custom IDs, ID zero, wallet stacking, batching, exact counters, and RPC failures. Verify that two rules granting one role cannot cause that role to be removed while either rule still passes.

   Run the relevant backend tests and both app builds. Smoke-test the existing connect/sign/result flow and a mixed Ethscriptions/NFT channel in staging, including scheduled and manual role checks. Apply the migration, deploy the backend and frontend, and refresh the existing slash-command registration.

   First-release scope: Ethereum mainnet, basic NFT ownership/quantity rules, configured ERC-1155 ID scanning, and the existing wallet and role workflows. An ERC-721 NFT with an ERC-6551 account still qualifies through normal parent-NFT ownership checks. Automatically counting assets inside its token-bound account requires additional account linking and current-control checks. Authenticating directly as that smart-contract wallet requires ERC-1271 signature validation. Defer those features. NFT traits, automatic token discovery, staking integrations, and additional chains can also follow separately.
