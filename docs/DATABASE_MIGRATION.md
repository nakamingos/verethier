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

## New Supabase project and Railway account — migration preparation

The November 22, 2026 move is a new-project migration, not an organization transfer. Destination project IDs, final frontend origin, and continued use of the existing Discord application must be confirmed before restoring or changing production. The existing production project remains the source until cutover. Never relink its working directory to the destination; use a separate CLI work directory/explicit destination connection and verify the target before every write.

### Prepare and rehearse

- Export the current schema, roles, COPY data, migration ledger and an independent current privacy-deletion ledger to a private gitignored backup directory. Rehearsal snapshots taken while production runs are not final cutover backups. Match the source PostgreSQL major version where possible.
- Preserve database functions, grants, RLS, sequences and migration history as well as application rows. The source contains early migration versions without corresponding repository files: replaying only repository migrations is not a substitute for restoring the production schema. Follow Supabase's documented new-project restore procedure for platform-managed objects; do not blindly overwrite destination Auth/Storage internals or source managed-role passwords. Check actual Auth/Storage/extension use separately; the existing local restore checker covers public application data only.
- Rehearse with `backend/test/check-backup.py`, then restore into the isolated destination and compare every application value, row counts, constraints, RLS/grants, RPCs and sequence positions. Verify copied deletion-ledger entries and apply the documented privacy recovery procedure before public access.
- Create frontend and backend Railway services from the same reviewed commit, with roots `/frontend` and `/backend`, correct watch paths and production start commands. Configure the frontend's `BACKEND_UPSTREAM` as the new backend HTTPS origin, without `/api`. Browser API requests use same-origin `/api`, forwarded by Caddy. The Caddy default keeps the existing deployment working until the new variable is set.
- Set the destination backend `DB_SUPABASE_URL` and service credential, and copy the current production environment securely. Local `.env` is not a complete authoritative copy of Railway configuration. Keep `DATA_SUPABASE_*` pointed at the external Ethscriptions provider. Preserve provider keys, RPC URLs, operator IDs, Discord configuration and ord.net wallet credentials without putting them in Git or logs.
- Set backend `BASE_URL` to the final frontend HTTPS origin. Add `${BASE_URL}/api/portal/auth/callback` in the Discord application's OAuth redirects. Update the Reown project origin allowlist, user-facing official-site text and any provider domain restrictions for the new origin. Existing links/cookies and outstanding wallet challenges may require a new verification/sign-in after an origin change. Confirm whether the old Railway hostname can be retained; do not assume a new account can claim it.
- Do not start a second production backend against either database during rehearsal. `DISCORD=0` disables the Discord connection, but scheduled jobs and queue workers are separate: it is not a general maintenance switch. Use isolated local database checks/builds, or explicitly paused workers, until cutover.

### Coordinated cutover

1. Prepare the destination infrastructure and origin configuration; retain the old services and database for recovery.
2. Stop source backend workers and block public database-writing requests. Wait for in-flight work to finish; account for queued/claimed jobs. Take the final consistent database export and current deletion ledger after writes stop.
3. Restore/validate the final copy in the new project, including migration history and privacy retention/deletions. Ensure pending tasks cannot execute in both environments. Do not open the destination merely because its health endpoint returns healthy.
4. Start the destination backend once and route the frontend to it. Confirm the same Discord application connects, OAuth works, existing rules/history are preserved, wallet verification succeeds, privacy/admin boundaries hold, and background work runs once. Do not perform role-changing acceptance checks on real members without the operator's intended test scope.
5. Keep the source offline and retained until acceptance. If destination writes have begun, routing back to the stale source would lose new records: reconcile destination changes before rollback. Do not delete the source infrastructure as part of the initial cutover.

Reference: [Supabase CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). This section documents preparation; it does not establish that a backup, destination restore or cutover has completed.

Preparation completed November 22, 2026: a private preflight roles/schema/COPY-data export, separate migration-history export, and independent deletion-ledger snapshot were created while production remained online. The disposable local restore checker passed and compared every backed-up public application value. This rehearsal does not validate Supabase-managed Auth/Storage data, the not-yet-configured destination project, or a final write-frozen cutover copy. The frontend production build and Caddy 2.11.7 configuration adaptation passed with a substituted backend origin. No restore into a remote destination, credential change, source shutdown, or production deployment has occurred.
