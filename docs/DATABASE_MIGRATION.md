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

## New Supabase project — migration preparation

The November 22, 2026 migration moves the application database from `cpwubaszhjdtqlvfdlbx` to `tlundfjfwioejwdlbbqf`. The operator clarified that Railway, the Discord application, and the public domain remain unchanged. No frontend routing, OAuth redirect, Reown allowlist or Railway-account change is needed. The earlier portable-routing changes were withdrawn from this branch.

### Prepare and rehearse

- Preserve the existing source CLI link. Target the destination explicitly or use a separate CLI work directory/profile. Inspect the destination before writing and stop if it contains existing application data; no source or destination deletion is part of this migration.
- Export roles, schema, COPY data, migration history and an independent privacy-deletion ledger to a private gitignored backup directory. Rehearsal snapshots taken while production runs are not final cutover backups.
- Preserve functions, RLS, grants, constraints, sequences and migration history as well as rows. Six early migration versions have no corresponding repository files: replaying only the repository migrations is not a replacement for the production schema. Follow Supabase's new-project restore procedure for managed objects; do not overwrite managed role passwords or Auth/Storage internals blindly.
- Rehearse with `backend/test/check-backup.py`. Inspect actual Auth/Storage/extension use separately; the checker covers public application data only. Restore into the isolated destination and verify public values, RPCs, permissions, sequences, and migration history. Preserve privacy deletions and retention cleanup before reopening access.
- Keep the existing backend connected to the source throughout preparation. Do not launch a second backend: `DISCORD=0` does not stop scheduled jobs or queue workers.
- Use the new account's token only for destination management access (`SUPABASE_TARGET_ACCESS_TOKEN` in the gitignored local backend `.env`); preserve the existing source login. A management token is not a backend service-role key. Never put credentials in Git, commands, diagnostic output or chat.

### Coordinated cutover

1. Verify destination readiness and arrange a short maintenance window. Pause the existing Railway backend and let in-flight work finish so all application writes and workers stop. The frontend can remain hosted but API requests will be unavailable during the pause.
2. Take the final consistent source export, migration history and current deletion ledger after writes stop. Restore/validate this final copy in the destination, including privacy retention/deletions and queued/claimed jobs.
3. Update **only** the application database credentials on the existing Railway backend: `DB_SUPABASE_URL=https://tlundfjfwioejwdlbbqf.supabase.co` and the destination service credential in `DB_SUPABASE_KEY`. Audit any legacy fallback variables referencing the old application database. `DATA_SUPABASE_*` belongs to the external Ethscriptions provider and stays unchanged; `BASE_URL`, Discord credentials, operator IDs, provider/RPC keys and the frontend stay unchanged.
4. Restart/redeploy the backend once. Confirm health plus application database/RPC access, Discord connection, portal sign-in, rules/history, privacy boundaries, and single execution of background work. Health alone does not establish a successful migration. Outstanding verification interactions may need fresh links after a process restart.
5. Retain the old database offline from the app until acceptance. Once destination writes start, switching to the stale source would lose changes; reconcile destination writes before rollback. Do not delete the source as part of initial cutover.

### Preparation results

On November 22, 2026 a private roles/schema/COPY-data export, separate migration-history export, and independent deletion-ledger snapshot were created while production remained online. The disposable local restore checker passed and compared every backed-up public application value. This does not validate Supabase-managed Auth/Storage data, the destination project or a final write-frozen cutover copy. The original CLI account received HTTP 403 from the destination; the operator will supply destination access through the local `.env`. No remote destination restore, production credential update, source shutdown or production deployment has occurred.

Reference: [Supabase CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

Destination rehearsal completed November 22, 2026: the corrected scoped personal token successfully accessed `tlundfjfwioejwdlbbqf`. Initial inspection found PostgreSQL 17.12, zero public tables, zero Auth users and zero Storage objects. The source is PostgreSQL 15.8 with no Vault secrets. A guarded SQL-API restore copied the validated preflight snapshot into the isolated destination, preserving typed values without client-side numeric conversion. All 32 table fingerprints and row counts matched (28,459 rows across 30 public tables plus two migration tables), sequence values were restored, all 30 public tables had RLS enabled and all 51 migration records were present. All 76 source public function identities and bodies were preserved; the destination additionally has Supabase's default `rls_auto_enable()` helper. The supplied destination service key passed a count-only REST request using Bouncer's installed client. Private receipts/import journals remain in the gitignored backup directory.

This destination is a rehearsal snapshot, not the live database. Final write-frozen backup/restore, privacy-ledger reconciliation, Railway credential changes and post-cutover acceptance remain outstanding. The assistant has no configured Railway management token; the operator must stop the running backend and later update its two application-database variables. The source CLI login/link and running application configuration remain unchanged.

Final copy completed November 22, 2026 after the operator stopped the Railway backend. The backend health URL returned HTTP 404. A fresh private roles/schema/data/history export and deletion ledger were saved; the ledger contained zero completed-deletion markers. The new snapshot passed the local restore/value checks. Before replacement, source schema exports were byte-identical to the rehearsed schema, all destination fingerprints still matched our rehearsal copy, and the backend was still offline. Only the 32 explicitly named rehearsal tables in the destination were emptied and reloaded; no source data was changed and no schemas were dropped. The destination then matched all 28,459 final snapshot rows across all 32 tables. All five backed-up sequence states matched. The new service credential returned matching exact counts through REST for wallets, rules, earned-role history and the deletion ledger, and passed a read-only `get_ordinal_collection` RPC probe. Private final receipts are under the gitignored `backup/account-migration-final-*` directory.

Remaining cutover: operator updates `DB_SUPABASE_URL` and `DB_SUPABASE_KEY` together on the existing Railway backend and deploys it. The value for the latter is the local `TARGET_DB_SUPABASE_KEY`, not the personal access token. Public/backend health and live application acceptance, local configuration/CLI relinking, and final documentation of the live project remain pending until restart is confirmed. The source project and source CLI link are retained for now.
