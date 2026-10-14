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

Ordinals selections use Xverse's inscription batch lookup (25 IDs per request) or paginated wallet inventory. They require `XVERSE_API_KEY` even when `ORDINALS_PROVIDER=ordnet`, whose documented ownership routes are collection-scoped. Quantity and trait collection rules continue through the selected provider.

Ethscription selections use the free [public Ethscriptions API](https://api-docs.ethscriptions.com/reference), including assets absent from the marketplace database. Exact hashes use its `transaction_hash[]` batch filter (50 per request); number rules read a wallet's complete direct and escrow inventories, then compare global `ethscription_number` values. The existing marketplace address and previous-owner policy are retained. Collection and trait Ethscription rules continue querying the existing data Supabase.

Selections are stored only on `verifier_rules.inscription_criteria` as `{ "kind": "ids", "ids": [...] }` or `{ "kind": "numbers", "ranges": [[start, end], ...] }`. Ranges stay compact, and these administrator selections do not expire. Member check records omit the selection list and keep rule IDs, count, status and a bounded display summary. No collection metadata import or new member table is needed.

Apply `20261011020000_add_inscription_selection_rules.sql` after backing up the application database, then deploy the backend and refresh slash commands (restart registers them). The migration preserves existing rules, wallets, assignments and trait snapshots. No frontend change or new environment variable is required.

Inputs accept up to 1,000 entries within Discord's 6,000-character option limit. Number checks are capped at 1,000 owned inscriptions per wallet (including escrow for Ethscriptions), with bounded pagination and request timeouts. Larger or incomplete inventories produce an unavailable check instead of an incorrect count. Ownership is fetched fresh for every verification/recheck; overlapping ID batches and number inventories are shared only within that run. API errors, missing selected IDs and malformed/partial pages preserve existing roles; a complete non-match allows removal. Run `yarn test --runInBand test/inscription-rules.spec.ts test/ethscriptions-ownership.spec.ts` and `python3 test/check-nft-migration.py` for the ownership and disposable database checks.

## ord.net Provider Experiment

`ORDINALS_PROVIDER=xverse` is the default. Set it to `ordnet` to use ord.net for live Ordinals quantity and trait rules, with automatic Xverse fallback when ord.net cannot finish a check. Keep `XVERSE_API_KEY` configured for fallback. Discord uses `/setup add-ordinals-rule`, and members connect and sign with Xverse or UniSat. Both wallets use the same Bitcoin mainnet Taproot address checks, BIP-322 proof verification, and `wallet_type:bitcoin` records; adding UniSat does not require a schema change or new API key. Existing rules and stored collection names remain in the database; new ord.net rules use the canonical slug as their label because its public API does not document a collection display-name endpoint. Confirm that your collection slugs resolve on ord.net before switching the backend. Trait rules require migration `20261011010000_add_ordinal_trait_snapshots.sql`; changing providers alone does not require a migration.

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

ord.net has no documented arbitrary-wallet holdings endpoint. Verification reads an entire collection in 100-item cursor pages, then matches current owner addresses. Every wallet and role using that collection shares one read within a verification/monitoring run. New runs read fresh ownership; there is no ownership cache across runs. Reads are serialized at least 2.1 seconds apart to stay under its documented 30 reads per profile per minute. Scans are bounded at 200 pages (20,000 items); large collections may take several minutes. Duplicate IDs, cursor loops, invalid responses, or any unknown owner make the check unavailable and preserve existing roles. The live check command reports these limitations before enabling the provider for real roles.

Sources: [authentication](https://developers.ord.net/reference/authentication/), [collection owners and traits](https://developers.ord.net/reference/collections/), [rate limits](https://developers.ord.net/reference/errors-rate-limits/).

### Ordinals trait rules

Use the existing `attribute_key`, `attribute_value`, and `min_items` options. Matching is case-insensitive; leave the value empty or use `ALL` to match any value for that key. Autocomplete starts with the first page of ord.net traits and fills its cache from the remaining pages in the background, including rare values. For Pizza Comrades, the first fill can take about a minute; re-open the field or type the exact value while it finishes. The distinct key/value menu stays in memory for seven days and is refreshed by complete verification scans, so cached autocomplete adds no API requests. A backend restart clears this menu. Ownership is still fetched fresh for each verification. Typed entries remain available when suggestions time out. Rule creation validates a complete collection scan before saving the rule.

Each rule's nullable `ordinal_trait_snapshot` JSONB stores only the matching `inscription_ids`, `criteria_hash`, and `fetched_at`. Live ord.net scans refresh it once per rule per run; changed collection/trait criteria invalidate it. Member check details record provider and status without copying IDs or trait metadata. Snapshot persistence failure does not interrupt an otherwise successful live check.

During ord.net outages, individual verification intersects Xverse wallet collection IDs with the saved list; scheduled checks share batches of up to 25 current-owner lookups across members/rules. Snapshot age is limited to 24 hours; Xverse ownership does not renew its timestamp. A valid snapshot can qualify new members or replacement inscriptions. A failed cached match alone cannot revoke a role. Only a complete collection count below the trait threshold proves ineligibility during an outage; otherwise the rule is unavailable. Roles use OR across their rules, retaining existing roles whenever a remaining rule is uncertain. Both providers must recognize the same collection slug for fallback.

Switching to `ORDINALS_PROVIDER=xverse` keeps existing trait snapshots usable for their remaining lifetime. Live trait refresh and new trait setup require ord.net credentials. Fallback uses the last known traits; subsequent trait changes are confirmed when live ord.net scans resume.

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
