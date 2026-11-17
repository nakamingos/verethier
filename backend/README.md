# Bouncer Backend

NestJS API and Discord bot for wallet verification, rule evaluation, role assignment and the Control Room/member portal APIs.

When Discord is enabled, startup waits up to 60 seconds for the gateway and aborts if it cannot connect. Once running, `/api/health` returns HTTP 503 if the bot becomes unavailable, so a running HTTP server cannot mask broken verification buttons. When Discord is intentionally disabled, the health check covers the API alone.

## Stack

- NestJS 11, TypeScript (strict null checks)
- Discord.js 14
- Supabase / Postgres
- viem (EVM), bitcoinjs-lib and bip322-js (Bitcoin), @noble/curves (Solana Ed25519)
- Jest

## Requirements

- Node.js `22.12+` (22.x)
- Yarn `1.22.x`
- Supabase CLI and Docker for local database work

## Setup

```bash
yarn install
cp env.example .env
PORT=3200 yarn start:dev   # matches the checked-in frontend dev config; default port is 3000
```

## Environment variables

[env.example](env.example) lists every variable with comments; [.env.production.example](.env.production.example) shows the production set. Notes:

- `BASE_URL` is the verification/portal origin with no trailing slash. It drives CORS, verification links and wallet-proof origins.
- `DATA_*` and `DB_*` can point at separate Supabase projects. `DB_SUPABASE_KEY` must be the application database's service-role key; wallet restrictions and other private tables are inaccessible to public clients.
- `DISCORD_CLIENT_SECRET` enables Discord sign-in for the portals. Register `{BASE_URL}/api/portal/auth/callback` as the OAuth2 redirect.
- `DYNAMIC_ROLE_CRON` accepts the named presets in [environment.config.ts](src/config/environment.config.ts) or a raw cron expression (default every six hours).
- `CLIENT_IP_HEADER` names the header your hosting edge overwrites with the caller's IP; anonymous requests (wallet verification, sign-in) are rate-limited per caller using it. On Railway, set `CLIENT_IP_HEADER=x-real-ip`. Leave it unset when nothing in front of the backend overwrites a header, otherwise callers could choose their own rate-limit key. If the header is missing or isn't a single IP, the backend logs one warning and falls back to the connection address. Signed-in portal users are always limited per Discord account.
- `BOUNCER_OPERATOR_DISCORD_IDS` appoints Bouncer Operators; see [privacy operations](../docs/privacy-operations.md).

## Deployment: run one instance

Run exactly one backend instance. Verification nonces, the Discord replies they update, per-account action locks, `/setup edit-rule` sessions and slash-command pagination are held in process memory.

- A second replica would receive verification steps for links created by the other process, and they would fail. Keep the replica count at 1.
- A restart or deploy clears that state. Verification links issued in the last `NONCE_EXPIRY` (5 minutes by default) stop working, and members see "This verification link is no longer active" and request a new one. Wallets, earned roles, jobs and settings are stored in Postgres and are unaffected.
- If the host overlaps the old and new deployment, both processes briefly connect to Discord with the same bot token. Disable deployment overlap, or accept that links created during the overlap may need to be requested again.
- Prefer deploying outside busy periods such as mints or announcements.

Running more than one instance would first require moving nonces and pending verification state to Postgres or Redis. Slash commands are registered on startup; reload Discord if a new command or option does not appear.

## Scripts

```bash
yarn build          # Compile NestJS to dist/
yarn start          # Start once
yarn start:dev      # Start in watch mode
yarn start:debug    # Start with Nest debug mode
yarn start:prod     # Run dist/main

yarn typecheck      # Type-check source and tests
yarn test           # Full backend test suite
yarn test:watch     # Jest watch mode
yarn test:coverage  # Coverage report
yarn test:verbose   # Verbose Jest output

yarn ordnet:wallet  # Create a dedicated ord.net API wallet (see below)
yarn ordnet:check   # Inspect live ord.net collection scans
yarn ordinals:grant-once --server SERVER_ID   # One-time Ordinals grant catch-up (see below)
```

Optional read-only live checks (build first; some use paid provider credits):

- `node test/check-ordinals-live.cjs`: Xverse Ordinals metadata and holdings
- `node test/check-smart-wallet-rpc.cjs`: smart-wallet RPC capability for given `RPC_URL`/`BASE_RPC_URL`/`ROBINHOOD_RPC_URL`; see [smart wallets](../docs/smart-wallet-verification.md)
- `node test/check-smart-wallet-evm.cjs`: smart-wallet proofs against a disposable local EVM

### One-time Ordinals grant catch-up

`yarn ordinals:grant-once --server SERVER_ID` (after `yarn build`) checks saved Bitcoin users who are still server members and adds missing Ordinals roles. It uses the linked Supabase CLI login and `DISCORD_BOT_TOKEN` from the environment or gitignored local env files. The default is a dry run; `--apply` rechecks eligibility and grants. Existing roles are preserved, new grants are tracked normally, and a private journal is written under `backend/temp` (or `--report PATH`). It does not enable recurring grants or start another bot.

- `--data-workdir PATH`: the separately linked holdings project, to include combined Ethscription/Ordinals minimums
- `--retry-report FILE`: retry only members with failed/unavailable checks in an earlier journal
- `--user DISCORD_USER_ID`: check one saved holder
- `--collections-only`: only collection rules and their shared minimums, skipping specific inscription selections
- `--shared-evm-only`: only the EVM paths of shared roles, without Ordinals lookups. Candidates still need a saved Bitcoin wallet.

## Database

Migrations live in [supabase/migrations](supabase/migrations); production has all of them applied. Locally:

```bash
npx supabase start
npx supabase db reset
```

Backups, rehearsals and the production migration workflow are in [database migrations and backups](../docs/DATABASE_MIGRATION.md).

## Rules and verification

### Verification messages

Use `/setup verification` with `channel` and `action`:

- **Refresh existing** (`action:refresh`): update the current message to the Bouncer style while preserving its link, pins and position.
- **Create new** (`action:new`): post another message; existing messages keep working.
- **Recover missing** (`action:recover`): post a message only if the bot cannot find one in the channel.

Refresh and recovery look for the bot's verification button in the latest 100 messages, then pinned messages. Every message uses the channel's current rules. Creating a rule with `/setup` or in the Control Room also posts a message when the channel has none.

Verification links use a dedicated in-memory cache (10,000 entries) separate from autocomplete, with expiry, replacement and single-use checks. Restarting the backend clears pending links.

The completion message recommends only roles configured in the channel where verification started, excluding roles the member already has or just received. It reuses that verification's ownership results.

Interactive verification checks only the proven wallet family: EVM checks Ethereum, Base and Robinhood NFT/token rules plus Ethscriptions; Bitcoin checks Ordinals and Stamps; Solana checks Solana rules. Earned roles that depend on another family are left for complete scheduled checks.

### Editing rules

`/setup edit-rule rule_id:173` opens a prefilled form; search the selector by ID, role name or collection. Review the before/after preview, then Save or Cancel. Editors expire after ten minutes, and another administrator's changes require reopening. The Control Room offers the same editing with more options (multi-trait conditions, role changes, multiple roles).

After saving, Undo restores the original requirements and offers Redo, repeatable, each with a fresh five-minute button window. Buttons belong to the administrator who opened the editor; an old button or a newer edit cannot overwrite the rule.

The editor changes requirements within the existing rule type: collection and traits, specific IDs or numbers, NFT token IDs, minimum count, ERC-20 minimum balance or a selection label. Rule ID, channel, asset type, network and contract stay fixed. Saving rechecks everyone who previously earned the affected role against all rules for that role. Alternative qualifying rules preserve the role; newly eligible members must verify themselves; provider errors preserve existing roles.

### Combined minimums and one collection per rule

Collectible rules in the same server with the same channel, role and `min_items` combine matching holdings. For example, two rules with minimum 10 can qualify a member holding 7 matching Ethscriptions and 3 matching Ordinals. Rules with different minimums remain alternatives. Initial verification uses the verification channel's rules; scheduled checks consider all rules for the earned role.

Overlapping rules count each asset once. NFT identity includes network, contract and token ID; ERC-1155 copies keep their quantity. ERC-20 and Solana token balances don't combine with collectible counts. An incomplete combined check preserves an earned role unless confirmed holdings already meet the minimum.

Use one collection per rule; add another rule with the same role and minimum to include another collection. The database rejects comma-separated slugs. `/setup list-rules` labels combined groups and their shared minimum, even when an asset filter hides other members of the group.

Collection slug input is trimmed, lowercased and has whitespace runs converted to one hyphen (` PIZZA   COMRADES ` → `pizza-comrades`). Ethscriptions collection names and trait keys/values match without case sensitivity and save the data source's spelling.

### Wallet blocks

`/setup block-wallet address:… reason:…`, `/setup unblock-wallet address:…` and `/setup list-blocked-wallets` (also in Control Room → Member Lookup) are administrator-only. Blocks apply only in the current server and cover EVM, Bitcoin and Solana wallets. A blocked wallet cannot complete verification or contribute to stacked holdings, and stays blocked if it moves to another Discord account. Blocking or unblocking immediately rechecks the linked member's previously earned roles; other eligible wallets still count. This blocks a wallet, not a Discord account. Blocks are stored in `verifier_wallet_blocks`.

### Audit log

`/setup audit-log days:7` shows recent assignment activity with pagination (up to 20 rows per page). Each view belongs to its requesting administrator and expires after five minutes. The log shows the latest saved record per user/role pair rather than an immutable event history. The Control Room's Audit Log adds rule changes, role checks and setup activity.

### Ethscriptions

Collection and trait rules share one paginated read of linked wallets' holdings and attributes from the market database (`DATA_SUPABASE_*`). The data stays in memory for that verification. Missing attributes do not exclude an asset from collection-wide counts, and failed pages make the check unavailable rather than using a partial count.

Trait values may be strings, numbers, booleans or lists. AND conditions must match the same item; OR matches count the item once. Missing metadata stays unknown: enough proven matches can still establish eligibility, otherwise uncertainty preserves existing roles.

### EVM NFTs

`/setup add-nft-rule` takes `contract_address`, optional `network` (Ethereum by default, Base, Robinhood), optional `token_ids`, trait options and `min_items`. With `network: Solana` it takes `scope`, `addresses` and `formats` instead; see [Solana](#solana). The Control Room also supports up to ten AND/OR trait conditions and [OpenSea collection lookup](../docs/nft-collection-lookup.md).

- **Token IDs:** comma-separated IDs, inclusive ranges or both (`1,5,20-30`), up to 1,000 unique IDs with full uint256 precision. Blank means any token for ERC-721, and IDs 0–99 for ERC-1155. A minimum can exceed a selection's size so other combined rules can contribute.
- **Ownership:** read fresh at one block per network, in batches of up to 100. Burned/unminted IDs count as zero; transport failures make the check unavailable.
- **Traits:** keys and values match without case sensitivity; an empty value (or `ALL`) matches any value. ERC-721 trait checks discover IDs through Alchemy, then confirm owners through RPC. For each owned token, `tokenURI`/`uri` is read at the ownership block; embedded JSON is decoded fresh, and hosted metadata uses Alchemy with a ten-minute cache in `nft_token_metadata`. The bot never fetches arbitrary token URLs itself.
- **Providers:** `RPC_URL`, `BASE_RPC_URL` and `ROBINHOOD_RPC_URL` must be full mainnet URLs. When they are Alchemy URLs, their keys are reused for the NFT API; other providers need `ALCHEMY_API_KEY` with the networks enabled. A missing or wrong-chain RPC fails that network only; it never falls back to another chain.

### ERC-20 token rules

`/setup add-token-rule` takes `contract_address`, a required `min_balance` such as `1000` or `0.5`, and optional `network`. With `network: Solana`, `contract_address` is the token mint. The bot reads decimals, name and symbol from the contract; tokens without readable `decimals`, `balanceOf` and `totalSupply` are rejected. Amounts are compared as exact base-unit integers (excess precision is rejected), and linked EVM wallets are summed at one block per network. Database `min_balance` stores canonical base units as text. Only tokens held directly in wallets count.

### Smart wallets

Deployed ERC-1271 and undeployed ERC-6492 accounts are verified with the same RPC settings on Ethereum, Base and Robinhood. Contract proofs only count on the network they were signed on; ordinary key proofs, including EIP-7702 delegated accounts signing with their own key, count on every network. See [smart-wallet verification](../docs/smart-wallet-verification.md).

### Specific inscription rules

`/setup add-ordinals-rule` and `/setup add-ethscription-rule` accept `inscription_ids` (IDs or comma-separated lists) or `inscription_numbers` (numbers and inclusive ranges), with optional `min_items` and `label`. Leave `slug` and attributes empty, except that an Ordinals number rule may set `slug` to scope it to an ord.net collection. Ordinals IDs use the `<txid>i0` format; Ethscription IDs are `0x` transaction hashes. Historical negative Ordinals numbers are accepted (`-10--1`).

- Inputs accept up to 1,000 entries within Discord's 6,000-character limit. Overlaps and duplicates are normalized so each asset counts once.
- Selections are stored in `verifier_rules.inscription_criteria` as `{ "kind": "ids", ... }` or `{ "kind": "numbers", "ranges": [...] }`; ranges stay compact and are never expanded into requests.
- **Ordinals** selections use fresh wallet inventories through the ownership fallback chain. Number rules need a provider with complete numbered inventory (Ordiscan, then Xverse). A collection-scoped number rule reads the live ord.net collection instead.
- **Ethscriptions** selections use the [public Ethscriptions API](https://api-docs.ethscriptions.com/reference), including assets outside the marketplace database, with the marketplace escrow policy. Number selections up to 1,000 numbers use its `ethscription_number[]` filter; larger ranges read complete direct and escrow inventories, capped at 1,000 per wallet.
- Labels (up to 100 characters) identify a selection in confirmations, lists and the editor; they never filter holdings. Label-only edits trigger no ownership checks.
- Incomplete inventories, API errors or missing selected IDs are unavailable and preserve roles; a complete non-match allows removal.

### Bitcoin Ordinals

`/setup add-ordinals-rule` takes the collection's slug (`slug:pizza-comrades`), optional trait options and `min_items`. Members connect the Taproot Ordinals address (`bc1p…`) with Xverse or UniSat and sign a BIP-322 simple proof of the backend's exact message. Ordinals-only channels select Bitcoin automatically; mixed channels offer the relevant wallet families. Multiple Bitcoin wallets stack distinct inscriptions.

UniSat extension users connect normally. Mobile users choose UniSat, then **Open in UniSat app**, and connect inside its browser; the link and wallet choice are kept. This uses UniSat's HTTPS `openDapp` link. Mainnet is checked with `getChain()` so Fractal mainnet cannot pass as Bitcoin mainnet.

#### Providers

`ORDINALS_PROVIDER=xverse` uses Xverse for collections. `ORDINALS_PROVIDER=ordnet` uses fresh ord.net collection scans first, with a persistent metadata catalog. Keep `XVERSE_API_KEY` configured either way for validation and final fallback.

The ord.net API is wallet-authenticated: the bot's dedicated API wallet needs at least **0.001 BTC (100,000 sats) confirmed** on its payment address (members' wallets need nothing). The backend signs BIP-322 login challenges and renews one-hour sessions in memory.

```bash
yarn build
yarn ordnet:wallet   # creates gitignored backend/.env.ordnet (mode 0600) once; prints public addresses only
# Fund the printed PAYMENT address with at least 0.001 BTC and wait for confirmation.
yarn ordnet:check    # defaults to Pizza Comrades; add --collection SLUG / --wallet bc1p… to inspect others
```

`.env.ordnet` holds the signing key; keep it privately for recovery. The app reads the normal `.env`; for Railway, copy the `ORDNET_*` values and `ORDINALS_PROVIDER=ordnet` into backend variables. For an existing wallet, set `ORDNET_ORDINALS_ADDRESS`, `ORDNET_PAYMENT_ADDRESS`, `ORDNET_ORDINALS_WIF` and optionally `ORDNET_PAYMENT_WIF`. `ORDNET_SESSION_TOKEN` overrides automatic login for manual tests.

ord.net has no wallet-holdings endpoint: its collection scan supplies membership, owners and traits. Scans use 100-item pages, at least 2.1 seconds apart, bounded at 200 pages, and are shared across simultaneous requests. Bundle ("lot") display cards are validated and excluded from counts; every bundle member must appear individually. During a member's verification, background Ordinals requests pause so the member's work runs first.

Sources: [authentication](https://developers.ord.net/reference/authentication/), [collections](https://developers.ord.net/reference/collections/), [rate limits](https://developers.ord.net/reference/errors-rate-limits/).

#### Catalogs and wallet ownership fallbacks

With `ordnet`, a complete scan is stored in `ordinal_collections` and `ordinal_collection_attributes` (slug, inscription ID and JSONB trait values; no owners). Each collection used by a rule is refreshed at the start of scheduled reverification; failed or incomplete refreshes keep the last complete catalog. `/setup refresh-collection collection_slug:SLUG` refreshes one early. Collection slug autocomplete uses saved rules and the catalog.

Wallet inventories fall back through `ORDINALS_OWNERSHIP_PROVIDERS` (default `ordiscan,subfrost,sandshrew,xverse`); providers without keys are skipped, and SUBFROST uses its public endpoint. Ordiscan use is capped at 1,000 requests per UTC month in `ordinal_provider_usage`. Errors, timeouts and rate limits fall back with cooldowns. Valid empty inventories mean zero; failures don't. If every provider fails, earned roles are kept and no new roles are granted.

#### Ordinals traits

Use `attribute_key`, `attribute_value` and `min_items` (value empty or `ALL` matches any value; case-insensitive). Trait setup requires ord.net. Each trait rule's `ordinal_trait_snapshot` stores the matching inscription IDs (no owners or member data), refreshed by live scans. During an ord.net outage, checks intersect fresh Xverse wallet IDs with a snapshot up to 24 hours old; a failed cached match alone never revokes a role.

#### Automatic rule-save checks

Saving a rule in the Control Room queues a role recheck only if every Ordinals rule contributing to that role can be checked with ord.net (collection/trait rules or collection-scoped number selections). These automatic jobs use fresh ord.net data with no fallback, and outages preserve roles. Unscoped number and exact-ID selections suppress the automatic job for that role; the portal explains when to run an explicit bulk check. Explicit Check Roles, repairs, bulk checks, exports and scheduled checks keep their normal provider policies.

### Bitcoin Stamps

`/setup add-stamps-rule` or the Control Room takes creator addresses, stamp numbers or both, with indivisible-copy minimums. Stamps channels also accept legacy and SegWit Bitcoin proofs; Ordinals-only channels remain Taproot-only. See [Bitcoin Stamps verification](../docs/bitcoin-stamps.md).

### Solana

Solana wallet proofs (any Wallet Standard wallet: Phantom, Solflare, Backpack and others), SPL/allowlisted Token-2022 minimums, and Token Metadata, Core, compressed and printed-edition NFT rules are live. Configure backend-only `SOLANA_RPC_URL` and `SOLANA_DAS_URL` (Helius) and set `SOLANA_ENABLED=1`; unset pauses Solana. Use `/setup add-token-rule` or `/setup add-nft-rule` with `network: Solana`, or the Control Room. See [Solana verification](../docs/solana-verification.md).

### Bulk checks

Operator bulk role checks use twelve member readers, three guarded mutation slots and three background wallet-inventory slots per process; interactive verification bypasses the background gate. See [bulk role checks](../docs/bulk-role-checks.md).

## Project layout

```text
backend/
├── src/
│   ├── config/
│   ├── constants/
│   ├── content/
│   ├── dtos/
│   ├── maintenance/
│   ├── models/
│   ├── portal/      # Control Room and member portal APIs
│   ├── services/
│   ├── types/
│   └── utils/
├── scripts/         # Operator scripts (grant catch-up, ord.net wallet, privacy recovery, …)
├── supabase/
│   └── migrations/
└── test/            # Jest specs, migration rehearsals and live checks
```

## Related docs

- [Project root README](../README.md)
- [Frontend README](../frontend/README.md)
