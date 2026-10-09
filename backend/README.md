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
