Run these commands from the repository root. The NFT database migration was applied to the linked remote Supabase project `cpwubaszhjdtqlvfdlbx` on 2026-10-06. The user confirmed `RPC_URL` is configured on the Railway backend. The backend and frontend code changes still need deployment.

Remote verification passed: all six NFT rule columns, the validated asset constraint, four new indexes, and the NFT ID helpers are present. All 42 existing rules remain Ethscriptions rules on chain 1. The transaction compared all existing application records and table permissions before and after the migration and confirmed they were preserved: 234 wallets and 1,108 role assignments, with RLS still enabled.

The remote migration history contains older versions absent from this checkout. This upgrade applied only `20261006223000_add_nft_verification_rules.sql` directly and recorded version `20261006223000`, its name and source SQL in `supabase_migrations.schema_migrations` in the same transaction. A PostgREST schema reload was requested. Existing history was retained. Reconcile the older local/remote migration history before using a general `supabase db push` in future.

PostgreSQL tools, Supabase CLI and Docker are already installed on this machine.

For the `roles.sql`, `schema.sql`, and `data.sql` backup created with the Supabase CLI, test the actual backup from the repository root:

```bash
python3 backend/test/check-backup.py backup
```

This creates a disposable local Supabase PostgreSQL container, restores the schema, custom roles and `public` application data, and compares every backed-up application value with the restored values. It then applies the NFT migration to that copy and checks that existing rules, wallets and role assignments stay intact. The container is removed on completion. It never connects to the remote database or starts the bot.

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

Production order: back up → test the actual backup → apply `backend/supabase/migrations/20261006223000_add_nft_verification_rules.sql` → set the backend `RPC_URL` to an Ethereum mainnet provider → deploy the backend/frontend. The backup, restore test, remote migration and Railway `RPC_URL` configuration are complete for this upgrade. The remaining step is deploying the backend/frontend code changes. The bot registers the updated `/setup add-rule` options on startup. Existing Ethscriptions rules retain their values and default to `asset_type=ethscription`.

The NFT migration is already applied remotely; do not apply it again. It was transactional. Do not run the old universal migration on production as part of this upgrade.

Connection and backup references: [Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).
