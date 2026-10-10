# Verethier Backend

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
- `DYNAMIC_ROLE_CRON` accepts either the named presets in [environment.config.ts](src/config/environment.config.ts) or a raw cron expression.

## NFT Trait Rules

Use `/setup add-rule` with `asset_type:NFT`, the contract address, and the existing `attribute_key`, `attribute_value`, and `min_items` options. For example, `attribute_key:Color attribute_value:Red min_items:2` requires two matching NFTs across linked wallets. Leaving the value empty matches any value for the selected key. Trait keys and values match without regard to letter case.

Ethereum and Robinhood rules use their existing `RPC_URL` and `ROBINHOOD_RPC_URL`. When these are full Alchemy URLs, the backend reuses their keys for Alchemy's NFT API. Other RPC providers need the optional `ALCHEMY_API_KEY`; enable the required networks for that key. Autocomplete samples the first 100 collection tokens and supports manual entry for other traits. The collection must have readable `attributes` metadata in Alchemy.

ERC-721 collection trait checks discover token IDs through Alchemy, then confirm every current owner and the complete wallet balance through RPC. A specified ERC-721 ID skips discovery. ERC-1155 rules retain their configured ID scope (0–99 by default) and count matching copies. Quantity-only rules continue using RPC alone.

For each owned token, verification reads ERC-721 `tokenURI` or ERC-1155 `uri` at the ownership block. Embedded JSON attributes are decoded fresh on every run, so evolving NFTs use their current traits. Hosted metadata uses Alchemy with `refreshCache:true` when the local ten-minute cache expires. The bot does not fetch arbitrary token URI URLs itself.

The `nft_token_metadata` table caches hosted attributes for ten minutes by network, contract, and token ID, and records fresh embedded attributes for reference. Use a backend Supabase service-role key for cache access; verification falls back to Alchemy if the cache is unavailable. Ownership is checked fresh on every run. Missing metadata or incomplete ownership results produce an unavailable check and preserve existing roles during re-verification.

## ord.net Provider Experiment

`ORDINALS_PROVIDER=xverse` is the default. Set it to `ordnet` to use ord.net for all Ordinals collection/count rules. Discord still uses `/setup add-rule`, and members still connect and sign with Xverse. Existing rules and stored collection names remain in the database; new ord.net rules use the canonical slug as their label because its public API does not document a collection display-name endpoint. Confirm that your collection slugs resolve on ord.net before switching the backend. No migration is needed.

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

The generated `.env.ordnet` is gitignored, created with mode `0600`, and never overwritten. It contains the signing key: retain it privately for wallet recovery. It uses one key with a Taproot Ordinals address and a native SegWit payment address. The check command reads this private file and then the normal `.env`; it does not start Discord or access Supabase. Its output includes complete collection size, owned count, unknown owners, missing/empty trait coverage, owned trait values/counts, and elapsed time. Trait inspection is diagnostic in this release; Ordinals trait-based Discord rules remain unsupported.

For an existing dedicated wallet, set `ORDNET_ORDINALS_ADDRESS`, `ORDNET_PAYMENT_ADDRESS`, and `ORDNET_ORDINALS_WIF` (a compressed mainnet WIF key). Set `ORDNET_PAYMENT_WIF` when the payment address uses a different key; otherwise the Ordinals key is used for both. Payment addresses may be native SegWit, Taproot, or nested SegWit. The backend checks that the keys control the configured addresses before requesting a challenge. As an optional manual test, `ORDNET_SESSION_TOKEN` takes precedence over automatic login; leave it empty for automatic renewal.

The application itself reads the normal `.env`, not `.env.ordnet`. To test locally with the generated wallet, launch Node with `--env-file=.env.ordnet` after building; the normal `.env` supplies other application settings. For Railway, put the generated `ORDNET_*` values and `ORDINALS_PROVIDER=ordnet` in **backend** variables. Credentials stay on the backend. Setting `ORDINALS_PROVIDER=xverse` selects Xverse again.

ord.net has no documented arbitrary-wallet holdings endpoint. Verification reads an entire collection in 100-item cursor pages, then matches current owner addresses. Every wallet and role using that collection shares one read within a verification/monitoring run. New runs read fresh ownership; there is no ownership cache across runs. Reads are serialized at least 2.1 seconds apart to stay under its documented 30 reads per profile per minute. Scans are bounded at 200 pages (20,000 items); large collections may take several minutes. Duplicate IDs, cursor loops, invalid responses, or any unknown owner make the check unavailable and preserve existing roles. The live check command reports these limitations before enabling the provider for real roles.

Sources: [authentication](https://developers.ord.net/reference/authentication/), [collection owners and traits](https://developers.ord.net/reference/collections/), [rate limits](https://developers.ord.net/reference/errors-rate-limits/).

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
