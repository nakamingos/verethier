Run these commands from the repository root. The initial NFT database migration was applied to the linked remote Supabase project `cpwubaszhjdtqlvfdlbx` on 2026-10-06. That upgrade is deployed, and the user confirmed NFT rule creation, wallet verification and role assignment work in production.

The NFT trait migration `20261008020000_add_nft_trait_verification.sql` was applied remotely on 2026-10-08. It allows NFT attribute filters, adds attributes to the existing NFT duplicate indexes, and creates a private `nft_token_metadata` cache accessible to the backend service role. The cache key includes network, contract and token ID; ownership is never cached there. Ethereum and Robinhood use the Alchemy keys from their existing backend RPC URLs, with optional `ALCHEMY_API_KEY` for other RPC providers.

The fresh private backup is in `backup/nft-traits-20261008231218-UTC/`, with checksums and restore results. All 45 rules, 239 wallets and 1,115 role assignments restored with every value matching. The exact guarded migration transaction passed in the disposable database before production application, then confirmed existing application records, permissions, RLS settings and unrelated indexes were preserved remotely. Both updated NFT indexes and the rule constraint are valid; the cache denies anonymous access. Migration history records the source SQL. Live Alchemy metadata testing uses the active Railway credentials after deployment.

The Robinhood extension adds `backend/supabase/migrations/20261007033000_add_robinhood_nft_rules.sql`. It expands the NFT network constraint from Ethereum (`1`) to Ethereum and Robinhood mainnet (`4663`); it changes no rule values or indexes. This migration was applied remotely on 2026-10-07, and the user confirmed `ROBINHOOD_RPC_URL` is set on the Railway backend. Deploy the backend code to activate the new network option. The existing `RPC_URL` remains the Ethereum endpoint. No frontend changes are required for this extension.

A fresh private backup was saved in `backup/robinhood-20261007035422-UTC/` and restored successfully before the Robinhood migration. Every backed-up application value matched: 43 rules (42 Ethscriptions rules and one Ethereum NFT rule), 234 wallets, and 1,109 role assignments. The remote migration transaction compared every application record, table permissions, RLS settings and index definitions before and after the change, and confirmed they were preserved. The new constraint is validated and the migration is recorded in Supabase history.

Alchemy's Robinhood mainnet endpoint is `https://robinhood-mainnet.g.alchemy.com/v2/YOUR_KEY`; enable the network for the key in Alchemy. A separate compatible Robinhood RPC provider also works. The bot verifies the endpoint's chain ID before accepting a rule or checking balances. See [Alchemy's supported endpoints](https://www.alchemy.com/docs/reference/node-supported-chains) and [Robinhood's network details](https://docs.robinhood.com/chain/add-network-to-wallet/).

Initial NFT release verification passed: all six NFT rule columns, the validated asset constraint, four new indexes, and the NFT ID helpers were present. All 42 rules at that time remained Ethscriptions rules on chain 1. The transaction compared all existing application records and table permissions before and after the migration and confirmed they were preserved: 234 wallets and 1,108 role assignments, with RLS still enabled.

The remote migration history contains older versions absent from this checkout. The initial NFT upgrade applied only `20261006223000_add_nft_verification_rules.sql` directly and recorded version `20261006223000`, its name and source SQL in `supabase_migrations.schema_migrations` in the same transaction. The Robinhood upgrade used the same process for version `20261007033000`. Both requested a PostgREST schema reload and retained existing history. Reconcile the older local/remote migration history before using a general `supabase db push` in future.

PostgreSQL tools, Supabase CLI and Docker are already installed on this machine.

For the `roles.sql`, `schema.sql`, and `data.sql` backup created with the Supabase CLI, test the actual backup from the repository root:

```bash
python3 backend/test/check-backup.py backup
```

This creates a disposable local Supabase PostgreSQL container, restores the schema, custom roles and `public` application data, and compares every backed-up application value with the restored values. It applies the initial NFT migration if the backup predates that upgrade, then applies the Robinhood migration and checks that existing rules, wallets and role assignments stay intact. The container is removed on completion. It never connects to the remote database or starts the bot.

This checks the bot's application tables; Supabase-managed Auth and Storage data are outside this test. The three SQL files successfully restored on 2026-10-06 with 234 wallets, 42 rules and 1,108 role assignments, and the NFT migration preserved those records. The older `verethier-before-nft.dump` file is empty and must not be used as a backup.

To create another SQL backup without resetting the database password, run `supabase login` and `supabase link --project-ref YOUR_PROJECT_REF` from `backend` (run `supabase init` first if no config exists), then:

```bash
umask 077
mkdir -p ../backup
supabase db dump --linked --role-only -f ../backup/roles.sql
supabase db dump --linked -f ../backup/schema.sql
supabase db dump --linked --data-only --use-copy -f ../backup/data.sql
```

Log in with a Supabase account personal access token; leave the database password blank if linking prompts for it. The linked CLI obtains temporary database credentials through the account. Keep the SQL files private; `backup/` is ignored by Git. Save future snapshots in a separate directory if the previous backup must be retained.

The remaining instructions cover the alternative custom-format `pg_dump` backup.

Back up the remote database before migrating. Copy the host and user from the Supabase **Connect** panel's **Direct connection** or **Session pooler** details (port 5432). With the session pooler, the user usually includes the project reference. The command prompts for the database password.

```bash
mkdir -p backup
chmod 700 backup

PGSSLMODE=require pg_dump \
  --host="YOUR_SUPABASE_HOST" \
  --port=5432 \
  --username="YOUR_DATABASE_USER" \
  --dbname=postgres \
  --password \
  --format=custom \
  --file="backup/verethier-before-nft.dump"

pg_restore --list backup/verethier-before-nft.dump > /dev/null
```

Only continue after `pg_dump` succeeds. Listing the archive checks readability; it does not prove a successful restore. Keep the dump private; `backup/` is ignored by Git. This is a logical database backup; Storage file contents are separate.

The automated local check creates its own disposable Docker database, applies the existing migrations, saves a custom-format backup, restores the `public` application schema into an empty database, and checks that the NFT migration preserves existing rules, wallets and assignments. It also checks NFT constraints and duplicate prevention, including a 1,000-ID rule.

```bash
cd backend
python3 test/check-nft-migration.py
```

Before production migration, restore the actual remote dump's app schema into an **empty disposable local database** and inspect the existing rules, wallets and assignments. For example, once that empty database exists:

```bash
pg_restore \
  --host="YOUR_LOCAL_TEST_HOST" \
  --port=5432 \
  --username="YOUR_LOCAL_TEST_USER" \
  --dbname="YOUR_EMPTY_TEST_DATABASE" \
  --password \
  --schema=public \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  backup/verethier-before-nft.dump
```

The initial NFT release followed this order: back up → test the actual backup → apply `backend/supabase/migrations/20261006223000_add_nft_verification_rules.sql` → set the backend `RPC_URL` to an Ethereum mainnet provider → deploy the backend/frontend. Those steps are complete. The bot registers the updated `/setup add-rule` options on startup. Existing Ethscriptions rules retain their values and default to `asset_type=ethscription`.

The NFT migration is already applied remotely; do not apply it again. It was transactional. Do not run the old universal migration on production as part of this upgrade.

Connection and backup references: [Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).
