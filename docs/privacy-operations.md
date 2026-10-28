# Privacy operations

## Configuration and access

Set `BOUNCER_OPERATOR_DISCORD_IDS` on the backend to exact numeric Discord user IDs separated by commas/spaces. Leave it empty to appoint no operators. The owner configures it manually in Railway. No frontend environment variable is used. Allowlists with any malformed ID fail closed. Restart/redeploy to activate a deployment configuration change.

Operators use normal Discord sign-in. The admin UI displays the capability and an Operator tab for deletion requests. Private inspection and reasoned export overrides are audited. Ordinary Discord admin rights still govern community mutations. Review the backend-only `verifier_operator_access` records when investigating access or export use; do not copy wallet rows into audit reasons.

The operator server menu includes both the normal owner/administrator server list and every server where Bouncer is installed, with duplicates removed. Servers without Bouncer retain installation links. Operator status does not replace those normal installation choices or grant permission to change a server's configuration.

Server settings can enable community identity sharing. Members must then grant permission in the relevant community and prove wallets again; old private history does not become visible. Export participation is separate. Member opt-out affects future reads/downloads, not copies already downloaded.

Verification and member-portal privacy forms preselect available sharing/export options only when the member has no saved choice. `has_saved_choice` distinguishes an unanswered form from an explicit opt-out; existing choices and disabled community sharing remain off where applicable. A displayed default is a draft, not a database grant. Saving or a fresh signed verification records the submitted choices through the existing backend flow. Older API responses without the new flag retain their timestamp-derived state. No migration or existing-preference rewrite is required.

## Migration and cleanup

Rehearse `20261027010000_privacy_controls.sql` against a fresh private roles/schema/data backup:

```sh
python3 backend/test/check-privacy-migration.py PRIVATE_BACKUP_DIRECTORY
```

Apply the tested migration and record its version using the existing guarded migration workflow before deploying the backend/frontend. Do not rewrite pre-repository Supabase migration history to force `db push`.

Cleanup runs hourly. A failed cleanup emits a generic server error and is retried on the next run. Monitor cleanup failures as part of ordinary operations. Database records and exports are backend-only with RLS and revoked public privileges.

Review pending account deletion requests in the Operator tab. Record a concise outcome explaining any separate security retention. Approval removes wallets and queues role reconciliation. Use Member Lookup/Audit Log to retry failed checks. Do not mark a deletion completed while required reconciliation is incomplete. The cleanup task completes erasure after its safety interval. The request ID remains as the receipt; its raw subject ID is cleared.

Review minimum security/block/admin records and recovery backups for necessity. This feature deliberately does not delete wallet blocks or administrative actor audit trails just because someone removes a wallet. Such exceptions need a documented purpose; there is no blanket promise to keep them forever.

## Backup recovery

Keep backup directories private (0700, files 0600). Recovery data is never a second source for ordinary community exports. Take a current restricted deletion-ledger snapshot before replacing the database, and retain a current independent copy alongside the recovery process so the ledger can survive a database loss. Use the backend service credentials through the process environment; never put keys in commands, source files or logs.

```sh
node backend/scripts/privacy-recovery.cjs snapshot PRIVATE_NEW_LEDGER_FILE
```

The snapshot file is created exclusively with mode 0600. It contains account fingerprints and completion times, not raw Discord IDs or wallets. Treat it as restricted pseudonymous data. Do not overwrite the current ledger with an older backup's ledger. Rotate obsolete backups and markers together under the operator's recovery policy; there is no automatic deletion of off-platform backup files.

For a restore:

1. Keep the public app and verification workers offline; restore into an isolated database and apply current migrations.
2. Supply the latest independent deletion ledger. If unavailable, keep the restored service offline until completed deletions are reconciled.
3. Set the target database's backend service credentials and `BOUNCER_RECOVERY_OFFLINE=true`, then run:

   ```sh
   node backend/scripts/privacy-recovery.cjs reapply PRIVATE_LATEST_LEDGER_FILE
   ```

4. Run reconciliation workers with public access still closed. Retry failed role checks, wait the configured proof safety interval and run `verifier_privacy_cleanup` again. Confirm no recovered deletion remains processing and ordinary one-year association expiry has run. Large retention backlogs are processed in batches of 100 per cleanup call; repeat until no expired associations remain.
5. Rehearse and verify the restored data before enabling sign-ins/verification. Recovery does not reconstruct deleted associations for use by admins or operators.

The recovery function removes restored old links and queues the ordinary deletion process. It skips a later re-registered account with a proof newer than the earlier deletion marker. Recovery markers contain no wallet mapping. Restoring a backup is an operator procedure; the public service must not be opened merely because the database restore itself succeeded.
