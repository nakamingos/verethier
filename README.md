# Bouncer

**Verify your wallet. Get your roles.**

Bouncer is a Discord bot and web app that assigns Discord roles to members who prove they own a wallet holding the right assets. It supports Ethscriptions, EVM NFTs and ERC-20 tokens (Ethereum, Base and Robinhood), Bitcoin Ordinals, Bitcoin Stamps and Solana tokens/NFTs.

Bouncer is split into two deployable apps:

- `backend/`: NestJS API, Discord bot, scheduled role checks and Supabase migrations
- `frontend/`: Angular app for the verification page, the admin **Control Room** (`/admin`) and the **member portal** (`/member`)

## Features

- **Wallet proofs.** EIP-712 signatures for EVM wallets, including deployed (ERC-1271) and undeployed (ERC-6492) smart wallets and Base Account; BIP-322/legacy message proofs for Bitcoin (Xverse, UniSat); Ed25519 signatures for Solana (Phantom). Signing never requests approvals or transactions.
- **Rules.** Collection, trait (up to ten AND/OR conditions), specific-ID/number and quantity rules for Ethscriptions, Ordinals, EVM NFTs (ERC-721/1155) and Stamps; exact-unit minimum balances for ERC-20 and Solana tokens; Solana Token Metadata, Core, compressed and printed-edition NFTs. One rule can grant up to 20 roles.
- **Stacking and combined counts.** Holdings stack across a member's saved wallets. Collectible rules sharing a channel, role and minimum combine their counts, even across protocols; each asset counts once.
- **Role upkeep.** Scheduled checks restore eligible previously earned roles and remove roles that are no longer earned. Newly eligible roles still need the member to verify. Provider failures never count as zero holdings, so uncertain checks keep existing roles.
- **Control Room.** Discord-authenticated admin dashboard: rules with review, Undo/Redo and duplicate; channel setup and **Check Setup**; verification messages; member lookup and repairs; wallet blocks; role actions; audit log; activity feed; privacy-aware exports; operator-only bulk role checks.
- **Member portal.** Manage saved wallets across communities, link or transfer wallets with a fresh signature, see earned and available roles, control per-community sharing.
- **Privacy.** Wallets are private by default; community sharing and exports need member permission. The public policy is the app's `/privacy` page; see also [privacy operations](docs/privacy-operations.md).

## Project layout

```text
verethier/
├── backend/    # NestJS API, Discord bot, Supabase migrations, tests
├── frontend/   # Angular verification page, Control Room and member portal
├── docs/       # Feature, operations and planning documentation
└── handoff/    # Styling reference package (integrated November 2026)
```

## Requirements

- Node.js `22.12+` (22.x) for both apps
- Yarn `1.22.x`
- Supabase CLI and Docker for local database work
- A Discord application with a bot user, and Supabase project(s)

## Quick start

### Backend

```bash
cd backend
yarn install
cp env.example .env   # then fill it in; see backend/env.example
PORT=3200 yarn start:dev
```

The checked-in frontend development config ([env.dev.ts](frontend/src/env/env.dev.ts)) expects the API at `http://localhost:3200/api`. Without `PORT`, the backend listens on `3000`.

### Frontend

```bash
cd frontend
yarn install
yarn ng serve
```

The dev server runs on `http://localhost:4200`.

### Local database

```bash
cd backend
npx supabase start
npx supabase db reset   # applies every migration in backend/supabase/migrations
```

## Configuration

Backend settings are documented in [backend/env.example](backend/env.example) (local) and [backend/.env.production.example](backend/.env.production.example) (production). The main groups:

- **Discord:** `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` (portal sign-in), `DISCORD_BOT_TOKEN`
- **Databases:** `DB_SUPABASE_*` (application database, service-role key) and `DATA_SUPABASE_*` (Ethscriptions market data)
- **EVM:** `RPC_URL` (Ethereum), `BASE_RPC_URL`, `ROBINHOOD_RPC_URL`; full mainnet URLs. Alchemy URLs also provide NFT metadata.
- **Bitcoin:** `XVERSE_API_KEY`, `ORDINALS_PROVIDER`, ord.net wallet settings and fallback providers for Ordinals; optional Stamps provider overrides
- **Solana:** `SOLANA_ENABLED`, `SOLANA_RPC_URL`, `SOLANA_DAS_URL` (Helius in production)
- **Optional:** `OPENSEA_API_KEY` (collection lookup), `BOUNCER_OPERATOR_DISCORD_IDS`, `CLIENT_IP_HEADER`

The frontend has no secrets. Its API URL lives in [env.ts](frontend/src/env/env.ts); the public WalletConnect/Reown project ID is in `frontend/src/app/services/evm-wallet.config.ts`.

## Setting up verification

Admins can do everything from the Control Room at `/admin`, or with `/setup` slash commands:

| Command | Purpose |
| --- | --- |
| `/setup add-ethscription-rule`, `add-ordinals-rule`, `add-stamps-rule`, `add-nft-rule`, `add-token-rule` | Create a rule for that asset family; NFT and token rules take a `network` (Ethereum, Base, Robinhood or Solana) |
| `/setup list-rules`, `edit-rule`, `remove-rule` | Browse (filter with `asset_type`), edit with Undo/Redo, or remove rules |
| `/setup verification` | Refresh, re-post or recover a channel's verification message |
| `/setup block-wallet`, `unblock-wallet`, `list-blocked-wallets` | Server-scoped wallet restrictions |
| `/setup refresh-collection` | Refresh a saved Ordinals collection catalog |
| `/setup audit-log` | Recent role assignment activity |
| `/help`, `/join` | Member-facing shortcuts; admins also get **Check Setup** from `/help` |

Creating a rule posts a verification message in its channel if there isn't one already. Members click the message's button, open their personal link, connect a wallet and sign. Examples:

```text
/setup add-nft-rule channel:#verify role:Holder network:base contract_address:0x… min_items:1
/setup add-token-rule channel:#verify role:Whale contract_address:0x… min_balance:1000
/setup add-ordinals-rule channel:#verify role:Holder slug:pizza-comrades min_items:10
/setup add-ordinals-rule channel:#verify role:Early inscription_numbers:0-99999 min_items:1
```

Rule details for each family are in the [backend README](backend/README.md) and the feature docs below.

## Testing

```bash
cd backend
yarn typecheck
yarn test --runInBand --testPathIgnorePatterns=live_test

cd ../frontend
yarn test --watch=false --browsers=ChromeHeadless
yarn build && node test/wallet-connection.smoke.cjs   # one of the browser smoke suites in frontend/test
```

Browser smoke suites use Playwright's Chromium (`CHROME_BIN`), simulated wallets and mocked APIs. Optional read-only live checks are listed in the backend README; some use paid provider credits.

## Deployment

Both apps run on Railway (Railpack, Node 22) and deploy from `main`.

- **Backend:** run exactly one instance; see [Deployment: run one instance](backend/README.md#deployment-run-one-instance).
- **Frontend:** `yarn build`, then Caddy serves `dist/frontend/browser` using [frontend/Caddyfile](frontend/Caddyfile), which also forwards `/api/*` to the backend so portal cookies stay on the frontend origin.
- **Database:** production has every migration in [backend/supabase/migrations](backend/supabase/migrations) applied, through `20261116010000_community_wallet_visibility.sql`. Apply new migrations to production before deploying code that depends on them; see [database migrations and backups](docs/DATABASE_MIGRATION.md).

## Documentation

- [Backend README](backend/README.md): configuration, rule behavior per asset family, providers, scripts
- [Frontend README](frontend/README.md): wallet connections, diagnostics, smoke tests
- Features: [portals (Control Room and member portal)](docs/portals.md) and [portal styling](docs/portal-styling.md) · [smart wallets](docs/smart-wallet-verification.md) · [Solana](docs/solana-verification.md) · [Bitcoin Stamps](docs/bitcoin-stamps.md) · [NFT collection lookup](docs/nft-collection-lookup.md) · [multiple role outputs](docs/multi-role-rules.md) · [bulk role checks](docs/bulk-role-checks.md) · [wallet checking and dormancy](docs/wallet-checking.md) · [activity feed](docs/bouncer-activity-log.md) · [wallet signing privacy](docs/wallet-signing-privacy.md)
- Operations: [database migrations and backups](docs/DATABASE_MIGRATION.md) · [privacy operations](docs/privacy-operations.md) · [verification incidents](docs/verification-reliability.md) · [domain reputation review](docs/blockaid-domain-review.md)
- Plans: [optional feature backlog](docs/plans/optional-features.md) · [core implementation plan](docs/plans/halcyon-core-implementation-plan.md) and earlier feature plans in [docs/plans](docs/plans)

## License

[CC0 1.0 Universal](LICENSE)
