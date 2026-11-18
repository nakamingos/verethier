# Database migrations and backups

Bouncer's application database is the Supabase project `cpwubaszhjdtqlvfdlbx` (`verethier`). Migrations live in [backend/supabase/migrations](../backend/supabase/migrations).

## Current state

As of November 18, 2026, production has every migration in the repository applied, through `20261118010000_counterparty_rules.sql`. Check with:

```bash
cd backend
supabase migration list --linked
```

The remote history also contains six early versions (`20250101000000`–`20250706000002`) that predate the repository's migration files. Don't repair or erase them to make `supabase db push` proceed. Production migrations are applied one at a time with the guarded workflow below.

## Workflow for a new migration

1. **Back up** production (below) into a new private directory under `backup/` (gitignored).
2. **Rehearse.** Most migrations have a rehearsal script, `backend/test/check-<feature>-migration.py BACKUP_DIRECTORY [GUARDED_APPLY_FILE]`. It restores the backup into a disposable local PostgreSQL container, applies the migration (or the exact guarded production script), checks that every existing application value is preserved, and exercises the feature's constraints and permissions. It never connects to production. Write one for any migration that changes existing data or permissions.
3. **Apply** the migration in one guarded transaction that checks its prerequisites, records the version, name and source SQL in `supabase_migrations.schema_migrations`, and asks PostgREST to reload its schema.
4. **Verify** the result read-only (migration ledger entry, constraints, RLS and grants).
5. **Deploy** the backend/frontend code that depends on it. Additive migrations must be applied before deploying their code.

Keep private receipts (dumps, guarded SQL, hashes and apply logs) in the backup directory, outside version control.

## Backups

Log in with `supabase login` (personal access token) and link the project from `backend` with `supabase link --project-ref cpwubaszhjdtqlvfdlbx`; leave the database password blank if prompted. Then:

```bash
umask 077
dir=../backup/$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$dir"
supabase db dump --linked --role-only -f "$dir/roles.sql"
supabase db dump --linked -f "$dir/schema.sql"
supabase db dump --linked --data-only --use-copy -f "$dir/data.sql"
```

Test that a backup restores, from the repository root:

```bash
python3 backend/test/check-backup.py backup/DIRECTORY
```

This restores the schema, roles and `public` application data into a disposable local container and compares every value. Supabase-managed Auth and Storage data are outside this check. Keep backups private (directory `0700`, files `0600`).

For a full database recovery, follow the ordered procedure in [privacy operations](privacy-operations.md#backup-recovery): restored data must have completed account deletions re-applied before the service is reopened.

## Local development

```bash
cd backend
npx supabase start
npx supabase db reset   # applies all migrations to the local database
```

References: [Supabase backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).
