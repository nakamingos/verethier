# Bouncer

**Verify your wallet. Get your roles.**

Discord-based wallet verification for Ethscriptions, NFTs and Bitcoin Ordinals communities.

Bouncer is split into two deployable apps:
- `backend/`: a NestJS API and Discord bot
- `frontend/`: an Angular verification app used by Discord users when they follow a verify link

## Features

- Wallet verification with EIP-712 signatures
- Collection-level, category-level, and trait-level verification rules
- ERC-721 and ERC-1155 NFT rules on Ethereum and Robinhood mainnet
- Bitcoin mainnet Ordinals quantity and trait rules using Xverse wallet signatures, ord.net traits, and Xverse ownership fallback
- Wallet stacking across multiple verified addresses
- Dynamic role re-verification and revocation
- Rich Discord verification result messages

## Requirements

- Node.js `20.19+` or `22.12+`
- Yarn `1.22.x`
- Supabase CLI for local database work
- A Discord application/bot and Supabase project(s)

## Project Layout

```text
verethier/
├── backend/    # NestJS API, Discord bot, Supabase migrations, tests
├── frontend/   # Angular verification app
└── README.md
```

## Quick Start

### 1. Backend

```bash
cd backend
yarn install
cp env.example .env
```

Fill in `backend/.env` using [backend/env.example](backend/env.example).

If you want the checked-in frontend dev config to work without changes, run the backend on port `3200`:

```bash
PORT=3200 yarn start:dev
```

If `PORT` is unset, the backend defaults to `3000`.

### 2. Frontend

```bash
cd frontend
yarn install
yarn ng serve
```

The Angular dev server runs on `http://localhost:4200`.

The checked-in dev environment file, [env.dev.ts](frontend/src/env/env.dev.ts), currently points to `http://localhost:3200/api`.

### 3. Local Supabase

Migrations live in [backend/supabase/migrations](backend/supabase/migrations).

For a fresh local database:

```bash
cd backend
npx supabase start
npx supabase db reset
```

## Environment Overview

- Backend runtime config is documented in [backend/env.example](backend/env.example) and [backend/.env.production.example](backend/.env.production.example).
- Frontend API/RPC settings live in [env.ts](frontend/src/env/env.ts) and [env.dev.ts](frontend/src/env/env.dev.ts).
- NFT checks use the backend's `RPC_URL` for Ethereum and `ROBINHOOD_RPC_URL` for Robinhood. Both require full HTTP(S) URLs for their respective mainnets.

Create rules with `/setup add-nft-rule`, `/setup add-ordinals-rule`, or `/setup add-ethscription-rule`. The command selects the asset type and shows only its relevant options; existing rules, confirmations and Undo use the same flow. Refresh slash commands after deploying this change.

Use `/setup list-rules` to show all server rules, or add `asset_type:NFT`, `asset_type:Ordinals`, or `asset_type:Ethscriptions` to filter the list. Pagination keeps the selected filter.

For a Robinhood NFT rule:

```text
/setup add-nft-rule channel:#verify role:Holder network:Robinhood contract_address:0x…
```

Omitting `network` defaults NFT rules to Ethereum. Wallet verification uses the existing signing flow; the backend checks the verified address on the rule's network. ERC-1155 rules still check IDs 0–99 by default, or the configured token ID list/range.

NFT rules also support the existing `attribute_key` and `attribute_value` options. For example, `attribute_key:Color attribute_value:Red min_items:2` counts two matching NFTs or ERC-1155 copies. Traits use Alchemy metadata through the existing backend RPC keys; see [NFT trait configuration](backend/README.md#nft-trait-rules).

For an Ordinals rule, configure `XVERSE_API_KEY` on the backend and use the collection's Xverse slug:

```text
/setup add-ordinals-rule channel:#verify role:Holder slug:pizza-comrades min_items:10
```

The collection label comes from the configured provider. Bitcoin mainnet is implicit; connect the Xverse Ordinals address (`bc1p…`). Ordinals-only channels select Bitcoin automatically; mixed channels offer Ethereum or Bitcoin within the existing verification page. Multiple verified Bitcoin wallets stack distinct inscriptions. Add `attribute_key` and optionally `attribute_value` for a trait rule; `min_items` counts matching inscriptions. Trait setup requires ord.net and saves the collection's complete matching ID list on the rule.

Xverse remains the default API provider. Set `ORDINALS_PROVIDER=ordnet` for live traits and automatic Xverse fallback when ord.net is unavailable; retain `XVERSE_API_KEY` on the backend. A dedicated API wallet can renew its one-hour sessions automatically. Valid trait snapshots last 24 hours and are combined with fresh ownership checks. Uncertain checks retain existing roles; a complete collection count below a trait rule's minimum can still prove ineligibility. Apply `20261011010000_add_ordinal_trait_snapshots.sql` before deploying this feature. See [ord.net setup and testing](backend/README.md#ordnet-provider-experiment).

For specific **Ordinals or Ethscriptions**, use `/setup add-ordinals-rule` or `/setup add-ethscription-rule` with either `inscription_ids` (full ID or comma-separated IDs) or `inscription_numbers` (global numbers or inclusive ranges). Leave `slug` and attributes empty:

```text
/setup add-ordinals-rule channel:#verify role:EarlyHolder inscription_numbers:0-99999 min_items:1
/setup add-ethscription-rule channel:#verify role:EthscriptionHolder inscription_numbers:5853618,6000000-6000099 min_items:1
```

Ordinals IDs have the `transactionhashi0` format; Ethscription IDs are `0x` transaction hashes. `min_items:1` accepts any selected asset; three selected IDs with `min_items:3` require all three across linked wallets. These checks also support assets outside collections. Ordinals selections use Xverse because ord.net's documented ownership routes require a collection; specific Ethscriptions use the public Ethscriptions API, with marketplace escrow handling. Collection and trait rules keep their existing providers. Apply `20261011020000_add_inscription_selection_rules.sql` before deployment. See [selection limits and storage](backend/README.md#specific-inscription-rules).

## Testing

```bash
cd backend
yarn test --runInBand --testPathIgnorePatterns=live_test

cd ../frontend
yarn test --watch=false --browsers=ChromeHeadless
```

An optional, read-only provider smoke test uses the local backend key and API credits:

```bash
cd backend
yarn build
node test/check-ordinals-live.cjs
```

## Deployment Notes

- Backend and frontend deploy separately.
- The frontend is built output plus static serving: `yarn build` then `yarn start`.
- On Railway, prefer `Railpack` for both services.
- The frontend `start` script serves `dist/frontend/browser` and expects a build to exist first.
- For Ordinals, back up the application database and apply `20261008010000_add_ordinals_verification.sql` before deploying the updated apps. Set `XVERSE_API_KEY` on the Railway backend; `BASE_URL` must be the verification page's origin. Use Node.js 20.19+ for Bitcoin signature verification. No Bitcoin RPC URL or frontend API key is needed.

## Docs

- [Backend README](backend/README.md)
- [Frontend README](frontend/README.md)

## License

[CC0 1.0 Universal](LICENSE)
