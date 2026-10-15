# Bouncer Backend

NestJS API and Discord bot for wallet verification, rule evaluation, and role assignment.

## Stack

- NestJS 9
- Supabase / Postgres
- Discord.js 14
- Jest

## What It Does

- Registers and manages Discord verification rules
- Verifies wallet ownership with EIP-712 signatures
- Evaluates collection-level, category-level, and trait-level rules
- Tracks assigned roles in `verifier_user_roles`
- Supports scheduled dynamic re-verification via `DYNAMIC_ROLE_CRON`

## Requirements

- Node.js `20.19+` or `22.12+` recommended for the repo as a whole
- Yarn `1.22.x`
- Supabase CLI for local database work

## Setup

```bash
yarn install
cp env.example .env
```

Then fill in `backend/.env`.

For local development that matches the checked-in frontend dev config:

```bash
PORT=3200 yarn start:dev
```

If `PORT` is unset, the app listens on `3000`.

## Environment Variables

See [env.example](env.example) for the full list. The main ones are:

```bash
BASE_URL=http://localhost:4200

DISCORD=1
DISCORD_CLIENT_ID=...
DISCORD_BOT_TOKEN=...

DATA_SUPABASE_URL=...
DATA_SUPABASE_ANON_KEY=...

DB_SUPABASE_URL=...
DB_SUPABASE_KEY=...

NONCE_EXPIRY=300000
DYNAMIC_ROLE_CRON=EVERY_6_HOURS
```

Notes:
- `BASE_URL` is used for CORS and verification flow URLs.
- `DATA_*` and `DB_*` can point at separate Supabase projects.
- `DB_SUPABASE_KEY` must be the backend database's service-role key. Wallet restrictions are inaccessible to anonymous and authenticated public clients.
- `DYNAMIC_ROLE_CRON` accepts either the named presets in [environment.config.ts](src/config/environment.config.ts) or a raw cron expression.

## Wallet Blocks

`/setup block-wallet address:… reason:…`, `/setup unblock-wallet address:…`, and `/setup list-blocked-wallets` are administrator-only commands. The list is private and paginated. Blocks cover EVM and Bitcoin mainnet Ordinals wallets and apply only in the current Discord server. Blocked wallets cannot complete signature verification or contribute to stacked holdings. The same address stays blocked if it changes Discord accounts.

Blocking or unblocking rechecks the linked member's previously earned roles in that server immediately. Eligible unblocked wallets still count; unavailable checks preserve existing roles for retry. Blocks are stored in `verifier_wallet_blocks` with the server, canonical address, wallet type, reason, administrator, and timestamp. Apply `20261013010000_add_wallet_blocklist.sql` before deploying. Local migration and access-control checks are in `test/wallet-blocks-migration.sql`.

## Verification Messages

Use `/setup verification` with a required `channel` and `action`:

- **Refresh existing** (`action:refresh`): Update the current message to the Bouncer style while preserving its link, pins, and position.
- **Create new** (`action:new`): Post another message while leaving existing messages working.
- **Recover missing** (`action:recover`): Post a message only if the bot cannot find one already in the channel.

For example: `/setup verification channel:#verify action:refresh`. Refresh and recovery look for the bot's verification button in the latest 100 messages, then in pinned messages. Read or edit failures are reported without automatically posting a replacement.

All messages use the channel's existing rules. These actions require Administrator permissions and do not change rules, linked wallets, or assigned roles. This command cleanup needs no database migration.

## NFT Trait Rules

Use `/setup add-nft-rule` with the contract address, and the existing `attribute_key`, `attribute_value`, and `min_items` options. For example, `attribute_key:Color attribute_value:Red min_items:2` requires two matching NFTs across linked wallets. Leaving the value empty matches any value for the selected key. Trait keys and values match without regard to letter case.

Ethereum and Robinhood rules use their existing `RPC_URL` and `ROBINHOOD_RPC_URL`. When these are full Alchemy URLs, the backend reuses their keys for Alchemy's NFT API. Other RPC providers need the optional `ALCHEMY_API_KEY`; enable the required networks for that key. Autocomplete samples the first 100 collection tokens and supports manual entry for other traits. The collection must have readable `attributes` metadata in Alchemy.

ERC-721 collection trait checks discover token IDs through Alchemy, then confirm every current owner and the complete wallet balance through RPC. A specified ERC-721 ID skips discovery. ERC-1155 rules retain their configured ID scope (0–99 by default) and count matching copies. Quantity-only rules continue using RPC alone.

For each owned token, verification reads ERC-721 `tokenURI` or ERC-1155 `uri` at the ownership block. Embedded JSON attributes are decoded fresh on every run, so evolving NFTs use their current traits. Hosted metadata uses Alchemy with `refreshCache:true` when the local ten-minute cache expires. The bot does not fetch arbitrary token URI URLs itself.

The `nft_token_metadata` table caches hosted attributes for ten minutes by network, contract, and token ID, and records fresh embedded attributes for reference. Use a backend Supabase service-role key for cache access; verification falls back to Alchemy if the cache is unavailable. Ownership is checked fresh on every run. Missing metadata or incomplete ownership results produce an unavailable check and preserve existing roles during re-verification.

## Specific Inscription Rules

`/setup add-ordinals-rule` and `/setup add-ethscription-rule` support exact IDs, lists of IDs, global inscription numbers and inclusive number ranges. Set one of `inscription_ids` or `inscription_numbers`, with optional `min_items`. Leave `slug` and attributes empty. IDs and numbers are separate inputs; they cannot be combined in one rule. Overlapping ranges and duplicate IDs are normalized so each asset counts once across linked wallets. Historical negative Ordinals numbers are accepted (`-10--1`); Ethscription numbers must be nonnegative.

Ordinals selections use the configured wallet ownership fallback chain. Exact IDs intersect a fresh wallet ID inventory. Number/range rules use a provider with complete numbered inventory (Ordiscan, then Xverse by default); ID-only ord nodes are skipped for these rules. Each wallet inventory is shared across applicable rules within a verification. Large ranges remain predicates and are never expanded into individual requests. Keep `XVERSE_API_KEY` for final fallback and validation of exact IDs at setup. No permanent ID-to-number lookup table is stored.

Ethscription selections use the free [public Ethscriptions API](https://api-docs.ethscriptions.com/reference), including assets absent from the marketplace database. Exact hashes use its `transaction_hash[]` batch filter (50 per request); number rules read a wallet's complete direct and escrow inventories, then compare global `ethscription_number` values. The existing marketplace address and previous-owner policy are retained. Collection and trait Ethscription rules continue querying the existing data Supabase.

Selections are stored only on `verifier_rules.inscription_criteria` as `{ "kind": "ids", "ids": [...] }` or `{ "kind": "numbers", "ranges": [[start, end], ...] }`. Ranges stay compact, and these administrator selections do not expire. Member check records omit the selection list and keep rule IDs, count, status and a bounded display summary. No collection metadata import or new member table is needed.

Apply `20261011020000_add_inscription_selection_rules.sql` after backing up the application database, then deploy the backend and refresh slash commands (restart registers them). The migration preserves existing rules, wallets, assignments and trait snapshots. No frontend change or new environment variable is required.

Inputs accept up to 1,000 entries within Discord's 6,000-character option limit. Number checks are capped at 1,000 owned inscriptions per wallet (including escrow for Ethscriptions), with bounded pagination and request timeouts. Larger or incomplete inventories produce an unavailable check instead of an incorrect count. Ownership is fetched fresh for every verification/recheck; overlapping ID batches and number inventories are shared only within that run. API errors, missing selected IDs and malformed/partial pages preserve existing roles; a complete non-match allows removal. Run `yarn test --runInBand test/inscription-rules.spec.ts test/ethscriptions-ownership.spec.ts` and `python3 test/check-nft-migration.py` for the ownership and disposable database checks.

## ord.net Provider Experiment

`ORDINALS_PROVIDER=xverse` remains available for direct Xverse collection checks. Set it to `ordnet` to use ord.net as the persistent collection metadata source and the wallet ownership chain described below. Keep `XVERSE_API_KEY` configured for final fallback. Discord uses `/setup add-ordinals-rule`, and members connect and sign with Xverse or UniSat. Both wallets use the same Bitcoin mainnet Taproot address checks, BIP-322 proof verification, and `wallet_type:bitcoin` records. Existing rules and collection names are preserved. New ord.net rules use the canonical slug as their label. Back up the application database and apply `20261015010000_add_ordinal_collection_cache.sql` before deploying this version.

The public ord.net API is wallet-authenticated: the API wallet's payment address needs at least **0.001 BTC (100,000 sats) confirmed**, and sessions last one hour. This is the bot's dedicated API wallet, not a requirement for members' wallets. The backend signs new BIP-322 login challenges, shares concurrent renewals, and renews before expiration or after a rejected session. Sessions stay in memory. Only collection reads and the two authentication routes are used.

Create a dedicated test wallet locally, then inspect the provider:

```bash
cd backend                 # When starting from the repository root
yarn install
yarn build
yarn ordnet:wallet         # Creates backend/.env.ordnet once; prints public addresses only
# Fund the printed PAYMENT address with at least 0.001 BTC and wait for confirmation.
yarn ordnet:check          # Defaults to Pizza Comrades and our known community wallet

# Optional: inspect several collections or another member's Ordinals address.
yarn ordnet:check --collection yonder --collection pizza-comrades --collection idiots --wallet bc1p…
```

The generated `.env.ordnet` is gitignored, created with mode `0600`, and never overwritten. It contains the signing key: retain it privately for wallet recovery. It uses one key with a Taproot Ordinals address and a native SegWit payment address. The check command reads this private file and then the normal `.env`; it does not start Discord or access Supabase. Its output includes complete collection size, owned count, unknown owners, missing/empty trait coverage, owned trait values/counts, and elapsed time.

For an existing dedicated wallet, set `ORDNET_ORDINALS_ADDRESS`, `ORDNET_PAYMENT_ADDRESS`, and `ORDNET_ORDINALS_WIF` (a compressed mainnet WIF key). Set `ORDNET_PAYMENT_WIF` when the payment address uses a different key; otherwise the Ordinals key is used for both. Payment addresses may be native SegWit, Taproot, or nested SegWit. The backend checks that the keys control the configured addresses before requesting a challenge. As an optional manual test, `ORDNET_SESSION_TOKEN` takes precedence over automatic login; leave it empty for automatic renewal.

The application itself reads the normal `.env`, not `.env.ordnet`. To test locally with the generated wallet, launch Node with `--env-file=.env.ordnet` after building; the normal `.env` supplies other application settings. For Railway, put the generated `ORDNET_*` values and `ORDINALS_PROVIDER=ordnet` in **backend** variables. Credentials stay on the backend. Setting `ORDINALS_PROVIDER=xverse` selects Xverse again.

ord.net has no documented arbitrary-wallet holdings endpoint. Its collection scan supplies membership and traits; member ownership is fetched separately. A first scan uses 100-item cursor pages and can still take several minutes. Scans are shared across simultaneous requests, serialized at least 2.1 seconds apart, and bounded at 200 pages (20,000 items). The standalone `ordnet:check` diagnostic continues to inspect live scans; normal verification uses the saved catalog once available.

During a signed member verification, new background requests pause on every Ordinals provider. In-flight requests finish, and a cold collection scan needed by the member is promoted, including its authentication work. Cached autocomplete remains available. A background request waiting at least five minutes can run, at most once every 30 seconds per provider. Background work resumes normally when the last active verification finishes or fails. Intentional pauses do not consume the 45-second queue timeout. There is no overall verification deadline.

The completion message recommends only roles configured in the Discord channel where verification started, excluding roles the member already has or just received. It reuses ownership results from that verification and does not inspect rules in other channels.

Sources: [authentication](https://developers.ord.net/reference/authentication/), [collection owners and traits](https://developers.ord.net/reference/collections/), [rate limits](https://developers.ord.net/reference/errors-rate-limits/).

### Ordinals trait rules

Use the existing `attribute_key`, `attribute_value`, and `min_items` options. Matching is case-insensitive; leave the value empty or use `ALL` to match any value for that key. In ord.net catalog mode, autocomplete and trait validation use the saved complete collection, including rare values, and survive restarts. A first fill can take several minutes; typed entries remain available while suggestions fill. Ownership is always fetched fresh. The seven-day in-memory menu and per-rule snapshots remain available for the direct provider mode and older rules.

Each rule's nullable `ordinal_trait_snapshot` JSONB stores only the matching `inscription_ids`, `criteria_hash`, and `fetched_at`. Live ord.net scans refresh it once per rule per run; changed collection/trait criteria invalidate it. Member check details record provider and status without copying IDs or trait metadata. Snapshot persistence failure does not interrupt an otherwise successful live check.

During ord.net outages, individual verification intersects Xverse wallet collection IDs with the saved list; scheduled checks share batches of up to 25 current-owner lookups across members/rules. Snapshot age is limited to 24 hours; Xverse ownership does not renew its timestamp. A valid snapshot can qualify new members or replacement inscriptions. A failed cached match alone cannot revoke a role. Only a complete collection count below the trait threshold proves ineligibility during an outage; otherwise the rule is unavailable. Roles use OR across their rules, retaining existing roles whenever a remaining rule is uncertain. Both providers must recognize the same collection slug for fallback.

Switching to `ORDINALS_PROVIDER=xverse` keeps existing trait snapshots usable for their remaining lifetime. Live trait refresh and new trait setup require ord.net credentials. Fallback uses the last known traits; subsequent trait changes are confirmed when live ord.net scans resume.

### Persistent catalogs and wallet ownership fallbacks

With `ORDINALS_PROVIDER=ordnet`, the initial complete scan is stored in `ordinal_collections` and `ordinal_collection_attributes`. Attributes follow the marketplace format: `slug`, `inscription_id`, and JSONB `values`, including multiple values for a key. The composite key permits an inscription to belong to more than one collection. No owners, member inventories, or inscription number mappings are stored in these tables.

At the start of scheduled role reverification (every six hours by default), each unique collection used by any server rule is refreshed once, even if no member currently has its role. Checks use the updated catalog after successful refreshes. Member verification can use the previous complete catalog during the refresh. Overdue catalogs encountered between runs trigger a background refresh. All pages, IDs, traits and timestamps are validated before an atomic database replacement; empty or incomplete scans cannot wipe a saved catalog. Failed refreshes retain the last complete version and its original timestamp. This intentionally uses last-known metadata during an ord.net outage; corrections take effect at the next successful refresh. Ownership still comes from a fresh wallet lookup.

Administrators can run `/setup refresh-collection collection_slug:pizza-comrades` for an immediate background refresh of a collection used by their server. This updates the shared catalog, without changing rule definitions or assigning roles. The slash command is registered on backend startup; reload Discord if it is not visible.

The default `ORDINALS_OWNERSHIP_PROVIDERS` is `ordiscan,subfrost,sandshrew,xverse`. It can be reordered or restricted to those provider names. Missing keys are skipped. Ordiscan uses `ORDISCAN_API_KEY`, Sandshrew uses `SANDSHREW_API_KEY` on its working `/v1/` endpoint, and Xverse uses `XVERSE_API_KEY`. SUBFROST uses its public JSON-RPC endpoint without a key. Public endpoints and free-plan eligibility remain subject to their providers' terms and limits; remove a provider from the order to disable it.

Ordiscan requests reserve one slot in `ordinal_provider_usage` before dispatch, capped at 1,000 per UTC calendar month across this installation. This survives restarts; API use outside this bot may exhaust the account earlier. Provider limits and `Retry-After` are also respected. Invalid responses, HTTP/JSON-RPC errors and timeouts cause fallback with cooldowns. Public ord nodes have a shared short-lived health check requiring their Ordinals index to be within two blocks of their Bitcoin node. Wallet inventories are never reused across independent verification runs. Valid empty inventories mean zero; failures do not. If every provider fails, existing earned roles are preserved and new roles are not granted from uncertain ownership.

Migration checks are in `test/ordinal-catalog-migration.sql`; `test/check-backup.py` rehearses the migration on a restored isolated database and verifies every existing application value is preserved.

## Database

Supabase migrations live in [supabase/migrations](supabase/migrations).

Typical local workflow:

```bash
npx supabase start
npx supabase db reset
```

## Scripts

```bash
yarn build          # Compile NestJS to dist/
yarn start          # Start once
yarn start:dev      # Start in watch mode
yarn start:debug    # Start with Nest debug mode
yarn start:prod     # Run dist/main

yarn test           # Full backend test suite
yarn test:watch     # Jest watch mode
yarn test:coverage  # Coverage report
yarn test:verbose   # Verbose Jest output
yarn test:debug     # Verbose, no-cache Jest run
```

## Project Layout

```text
backend/
├── src/
│   ├── config/
│   ├── constants/
│   ├── dtos/
│   ├── models/
│   └── services/
├── supabase/
│   └── migrations/
└── test/
```

## Related Docs

- [Project root README](../README.md)
- [Frontend README](../frontend/README.md)
