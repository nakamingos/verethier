# Bouncer

**Verify your wallet. Get your roles.**

Discord-based wallet verification for Ethscriptions, NFTs, ERC-20 tokens and Bitcoin Ordinals communities.

Bouncer is split into two deployable apps:
- `backend/`: a NestJS API and Discord bot
- `frontend/`: an Angular verification app used by Discord users when they follow a verify link

## Features

- Wallet verification with EIP-712 signatures
- Collection-level, category-level, and trait-level verification rules
- ERC-20 token balance rules with exact decimal amounts and wallet stacking on Ethereum and Robinhood mainnet
- ERC-721 and ERC-1155 NFT rules on Ethereum and Robinhood mainnet
- Bitcoin mainnet Ordinals quantity and trait rules using Xverse or UniSat wallet signatures, persistent collection metadata, and ordered ownership API fallbacks
- Wallet stacking across multiple verified addresses
- Scheduled reconciliation of previously earned roles: restore eligible roles, remove ineligible roles, and retry failed Discord changes. New roles still require explicit wallet verification.
- Rich Discord verification result messages

## Requirements

- Node.js `22.12+` (22.x) for the frontend; the backend also supports `20.19+`
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

The collection label comes from the configured provider. Bitcoin mainnet is implicit; connect the Taproot Ordinals address (`bc1p…`) holding your inscriptions with Xverse or UniSat. Ordinals-only channels select Bitcoin automatically; mixed channels offer Ethereum, Xverse, or UniSat within the existing verification page. Multiple verified Bitcoin wallets stack distinct inscriptions. Add `attribute_key` and optionally `attribute_value` for a trait rule; `min_items` counts matching inscriptions. Trait setup requires ord.net and saves the collection's complete matching ID list on the rule.

UniSat browser-extension users choose UniSat and connect normally. Mobile users choose UniSat, then **Open in UniSat app**, and connect/sign inside the app's browser. The same verification link and selected wallet are retained. This uses UniSat's HTTPS `openDapp` link from its [developer guidance](https://github.com/unisat-wallet/dev-support/issues/105#issuecomment-5307886170); use a current UniSat app release. Mainnet is checked using `getChain()` so Fractal mainnet cannot be mistaken for Bitcoin mainnet. Both wallets sign the backend's exact message as a BIP-322 simple proof. Wallet selection does not change `ORDINALS_PROVIDER`, collections, role checks, or API billing. No additional API key or database migration is required for UniSat support.

Set `ORDINALS_PROVIDER=ordnet` to store collection IDs and traits in Supabase, refreshing each unique collection with scheduled role checks every six hours by default. Fresh ownership uses **Ordiscan → SUBFROST → Sandshrew → Xverse**, configurable through `ORDINALS_OWNERSHIP_PROVIDERS`. Set backend-only `ORDISCAN_API_KEY`, `SANDSHREW_API_KEY`, and `XVERSE_API_KEY`; SUBFROST uses its public endpoint. Unavailable or exhausted providers are skipped, and uncertain checks retain existing roles. Back up Supabase and apply `20261015010000_add_ordinal_collection_cache.sql` before deploying. Admins can refresh early with `/setup refresh-collection collection_slug:pizza-comrades`. See [catalogs and fallback behavior](backend/README.md#persistent-catalogs-and-wallet-ownership-fallbacks).

For specific **Ordinals or Ethscriptions**, use `/setup add-ordinals-rule` or `/setup add-ethscription-rule` with either `inscription_ids` (full ID or comma-separated IDs) or `inscription_numbers` (global numbers or inclusive ranges). Leave `slug` and attributes empty:

```text
/setup add-ordinals-rule channel:#verify role:EarlyHolder inscription_numbers:0-99999 min_items:1
/setup add-ethscription-rule channel:#verify role:EthscriptionHolder inscription_numbers:5853618,6000000-6000099 min_items:1
```

Ordinals IDs have the `transactionhashi0` format; Ethscription IDs are `0x` transaction hashes. `min_items:1` accepts any selected asset; three selected IDs with `min_items:3` require all three across linked wallets. These checks also support assets outside collections. Ordinals selections use fresh wallet inventories through the ownership fallback chain; number/range rules skip ID-only providers and use Xverse when necessary. Specific Ethscriptions use the public Ethscriptions API, with marketplace escrow handling. Apply `20261011020000_add_inscription_selection_rules.sql` before deployment. See [selection limits and storage](backend/README.md#specific-inscription-rules).

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

For a one-time grant-only Ordinals catch-up, build the backend and run
`yarn ordinals:grant-once --server SERVER_ID` from `backend`. It uses the linked
Supabase CLI login and the live `DISCORD_BOT_TOKEN` from the environment or the
gitignored local env files. Add `--data-workdir PATH` pointing to the separately
linked holdings project to include combined Ethscription/Ordinals minimums.
The default is a dry run; `--apply` rechecks eligibility and adds missing roles.
Only saved Bitcoin users who are still server members are checked. Existing
roles are preserved, new grants are tracked normally, and a private journal is
written under `backend/temp` (or the path supplied with `--report`). This does
not enable recurring grants or start another bot/scheduled role monitor.
Use `--retry-report FILE` to retry only members with failed/unavailable checks
in an earlier journal, or `--user DISCORD_USER_ID` to check one saved holder.
Use `--collections-only` to restrict the Ordinals scope to collection rules and
their shared collectible minimums, skipping specific inscription selections.
Use `--shared-evm-only` to check only the EVM paths of those shared roles, without
an Ordinals ownership lookup. The candidate members still need a saved Bitcoin
wallet; roles available only through EVM rules remain outside this command.

- [Backend README](backend/README.md)
- [Frontend README](frontend/README.md)

## License

[CC0 1.0 Universal](LICENSE)

## ERC-20 token rules

Use `/setup add-token-rule` with `channel`, `role`, `contract_address`, and a required `min_balance` such as `1000` or `0.5`. Set `network:robinhood` for Robinhood mainnet; otherwise Ethereum is used. Existing backend `RPC_URL` and `ROBINHOOD_RPC_URL` settings apply.

The bot reads token decimals, name, and symbol from the contract. Amounts are compared as exact base-unit integers; excess decimal precision is rejected. Linked EVM wallets are deduplicated and summed at one block per network. These rules check tokens held directly in wallets. Tokens without readable `decimals`, `balanceOf`, and `totalSupply` are rejected. Name and symbol are optional.

`/setup list-rules asset_type:erc20` filters token rules. Scheduled checks follow assignment history: newly eligible roles require explicit verification, previously earned roles can be restored, and RPC failures preserve existing roles. Database `min_balance` stores canonical base units as text; `token_decimals` and `token_symbol` describe display amounts. Token rules leave `min_items` null.

## Audit log

`/setup audit-log days:7` displays recent assignment activity with Previous/Next buttons, page numbers, and entry ranges. Pages contain up to 20 complete rows and adjust to Discord’s description limit without cutting rows or wallet links. Each view belongs to its requesting administrator and expires after five minutes; rerun the command to refresh it.

The log uses the latest saved record for each user/role pair, rather than an immutable event history. Larger result sets and wallet lookups are paginated in Supabase.

## Wallet blocks

Server administrators can manage wallet restrictions:

```text
/setup block-wallet address:0x… reason:Temporarily shared asset across accounts
/setup unblock-wallet address:0x…
/setup list-blocked-wallets
```

Blocks apply only to the server where the command runs and cover EVM wallets across supported networks and Bitcoin mainnet Ordinals wallets (`bc1p…`). Blocked wallets cannot complete verification or contribute to stacked holdings. Blocking or unblocking immediately rechecks the linked member’s previously earned roles in that server. Other eligible wallets still count, and provider failures preserve existing roles for retry. Blocks remain attached to the address when it is unlinked or linked to another Discord account. The administrator list includes the full address, reason, blocking administrator, and date, with Previous/Next buttons. This blocks a wallet; it does not ban a Discord account or block an inscription from moving to another wallet.

Apply `20261013010000_add_wallet_blocklist.sql` before deploying. `DB_SUPABASE_KEY` must be a backend service-role key; anonymous/public keys cannot access wallet restrictions. No new environment variables are required.

## Editing rules

Use `/setup edit-rule rule_id:173` to open a prefilled form. Search the rule selector by ID, role name, or collection. Review the before/after preview, then Save or Cancel. Editors expire after ten minutes; another administrator's changes require reopening the form. Long previews attach the complete values, and lists use two text fields without dropping entries. Lists too long for both fields are rejected; numeric ranges can shorten them.

After saving, Undo restores the original requirements and offers Redo. Redo reapplies the edit and offers Undo again. This cycle can repeat; each successful action opens a fresh five-minute button window. Buttons belong to the administrator who opened the editor, and an old button or a newer edit cannot overwrite the rule. Undo and Redo restore the same rule row and recheck previously earned roles each time. Previously validated definitions can be restored during provider outages; fresh ownership checks preserve existing roles when results are uncertain. Only a matching, unexpired Ordinals trait snapshot is reused.

The editor changes requirements within the existing rule type: collection and traits, specific IDs or numbers, NFT token IDs, minimum item count, or ERC-20 minimum balance. IDs stay IDs and numeric rules stay numeric rules. Rule ID, channel, role, asset type, network, and contract remain fixed. NFT collection labels also stay fixed; changing an Ordinals collection refreshes its label and trait snapshot.

Saving rechecks everyone who previously earned the affected role against all rules for that role in the server. Alternative qualifying rules preserve the role; newly eligible members who never earned it must verify themselves. Provider errors preserve existing roles for a later scheduled check. No database migration or new environment variables are needed. Restarting the backend registers the command; reload Discord if it does not appear.

### Combined collectible minimums

Collectible rules in the same server with the same Discord role and `min_items` combine their matching holdings. For example, two rules with minimum 10 can qualify a member holding 7 matching Ethscriptions and 3 matching Ordinals across their verified wallets. Rules with different minimums remain alternative ways to earn the role. Initial verification uses the rules in that verification channel; scheduled checks consider all rules for the earned role.

Overlapping rules count each asset once. NFT identity includes its network, contract, and token ID; ERC-1155 copies retain their quantity without counting the same copies twice. ERC-20 balances remain independent. An incomplete combined check preserves an earned role unless confirmed holdings already meet the minimum. Use one collection per rule; add another rule with the same role and minimum to include another collection. `/setup list-rules` labels combined channel groups and their shared minimum, including when an asset filter hides other members of the group. The single-collection migration splits existing comma-separated rules and the database rejects new comma-separated slugs.
