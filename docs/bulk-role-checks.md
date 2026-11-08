# Bulk role checks

Control Room → Bulk role check can grant new roles to current members using their saved proven wallets. The audience can be current holders of a selected Discord role or all currently verified members in this server. The latter means live members with saved wallets and either server verification activity or earned-role history. Bots and departed members are excluded. An audience can contain up to 10,000 members; larger selections require a narrower source role.

Choose one rule’s exact requirements or all server rules. All server rules preserves existing combined collection/count groups and alternative qualification paths. Grant eligible roles only is the default. Roles already held are left as-is without extra provider reads in this mode. Grant and remove proven failures is a separate, confirmed action; alternative ways of earning the target role protect it from removal. Provider uncertainty never becomes a proven failure. Role exclusions remain enforced, and grants-only jobs skip grants that would trigger configured removals of other roles the member holds.

Preview saves a fixed current audience for 30 minutes; it does not check holdings or change roles. Starting explicitly authorizes the saved selection. Each member is checked against current ownership, restrictions, membership and deletion state. Rules changing during a run stop remaining work with a stale result rather than granting through an old definition. Each role change requires current administrator authority and an active member lease. Changing wallet links or restrictions while a provider request is in flight requires retry; new grants are checked again afterward and rolled back if their wallet evidence changed. No new signature is required, and wallet addresses are not returned in previews or job results.

Background work uses durable per-member leases and three attempts, with a one-minute delay before retrying unavailable checks. Progress and member results survive tab changes and restarts. Counts separate granted roles, removed roles, already-held roles, ineligible members, members without wallets, provider uncertainty, exclusions, members who left the audience and exhausted failures. Retrying retains recorded actual grants/removals. Cancelling stops remaining work; completed changes remain. A Discord request already in flight may finish while cancellation is being recorded.

Normal server owner/administrator permission is required to preview, start, retry or cancel. Operator inspection uses the existing audited read-access path and does not grant mutation authority. The execution administrator must remain authorized. Jobs and results expire after 30 days, and account deletion clears matching member-result records. Configuration and action metadata identify who created, started, retried or cancelled the job. Public/client database privileges are revoked; only backend RPCs and services access job tables.

Migration `20261107030000_bulk_role_checks.sql` must precede backend/frontend deployment. Rehearse it against a fresh private backup:

```sh
python3 backend/test/check-bulk-role-migration.py PRIVATE_BACKUP_DIRECTORY [GUARDED_APPLY_FILE]
```

Validation uses disposable PostgreSQL for scope, idempotent starts, leases, completion/retry, deletion, retention cascade and privileges. Backend regressions cover default grants-only behavior, exclusions, fresh evidence, provider uncertainty, alternate rules, real Discord failures and CSRF/admin boundaries. The browser smoke test covers preview versus execution, removal confirmation, cancellation, progress/results and mobile layouts.

The linked application database received migration `20261107030000` on November 8, 2026, verified at 00:04 UTC. Independent checks confirmed private tables, RLS, backend-only mutation RPCs and the migration ledger. A fresh private backup and disposable rehearsals preserved all 25 existing public tables. Backend validation passed the full 1,823-test suite and 82 final targeted regressions; production builds and bulk-role browser checks passed at 1280, 768, 393 and 320 pixels. Backend/frontend publication is still required to expose the new portal controls.
