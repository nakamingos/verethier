# Counterparty rules

Counterparty asset rules grant roles for assets on Bitcoin's Counterparty protocol. They have their own asset type (`counterparty`) beside Ordinals and Stamps, with the network fixed to Bitcoin.

## Scopes

Each rule has exactly one scope (`counterparty_criteria`):

| Scope | Example | Requirement |
|---|---|---|
| `{"asset": "PEPECASH"}` | one asset, divisible or not | `min_balance`, such as `1000` or `0.5` |
| `{"assets": ["RAREPEPE", …]}` | up to 100 indivisible assets | `min_items` copies in total |
| `{"issuer": "1…"}` | indivisible assets first issued by an address | `min_items` copies |
| `{"parent": "PEPE"}` | indivisible subassets `PEPE.*` | `min_items` copies |

Rule setup resolves each name through Counterparty: names are upper-cased, subasset long names (`PEPE.kek`) are stored as their numeric asset, and lists reject divisible assets. Single-asset rules store the minimum in raw units (`min_balance`), with `token_decimals` 0 or 8 and the display name in `token_symbol`, like token rules.

Holdings are summed across the member's verified Bitcoin wallets (`1…`, `3…`, `bc1q…`, `bc1p…`), including UTXO-attached balances. Assets escrowed in open orders or dispensers are not held and don't count. Collectible scopes share a combined-count domain with Stamps and key holdings by asset, so a stamp counted by both a Stamps rule and a Counterparty rule counts once. Single-asset rules, like token rules, don't combine.

## Setting up

- Discord: `/setup add-counterparty-rule` with one of `asset` (plus `min_balance`), `assets`, `issuer` or `parent` (plus optional `min_items`).
- Control Room: asset type **Counterparty**.

Members verify with a Bitcoin wallet. Counterparty channels accept every single-key address type and offer **Other wallet** (pasted signature or **Sign with Freewallet**), as Stamps channels do.

## Data source and failure behavior

Balances come from the same confirmed Counterparty API v2 inventory as Bitcoin Stamps (`COUNTERPARTY_API_URL`, default `https://api.counterparty.io:4000/v2`), so a check reads each wallet once for both. The adapter's readiness, block-height, pagination and consistency checks apply; stacked wallets must describe the same block. Failures are **unavailable** and keep previously earned roles. Balance rows carry each asset's issuer and subasset long name; an unusual issuer value only excludes that asset from issuer scopes. Quantities too large for a JSON number are read from the API's exact decimal string.

**Check Setup** probes Counterparty mainnet readiness.

## Database

`backend/supabase/migrations/20261118010000_counterparty_rules.sql` adds the nullable `counterparty_criteria` column, its validator, a constraint branch, and the column in rule definitions, duplicate checks, the rule mutation RPC and the wallet-network mapping. It also makes `min_items` explicitly nullable, which token rules already rely on. No existing values change.

- `backend/test/counterparty-migration.sql` exercises the migration; it passes on a fresh database built from every migration, together with the Stamps test.
- `backend/test/check-counterparty-migration.py BACKUP_DIRECTORY` rehearses it against a private production backup and checks that every existing value is preserved.

Read-only live check (November 18, 2026): setup resolved PEPECASH (divisible, minimum 1000 → `100000000000` raw) and RAREPEPE, and the compiled checker read a public wallet's balances and issuer-scoped copies.
