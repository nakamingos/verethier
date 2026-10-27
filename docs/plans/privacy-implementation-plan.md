# Bouncer privacy implementation

Accepted October 27, 2026. This document records the implemented behavior and release checks. The ord.net linked-wallet investigation remains on hold pending the provider's response.

## Operator and defaults

Bouncer is operated by Snepsid (alias), an individual in Michigan, USA. Privacy contact: nomorelabs@gmail.com. The public policy is `/privacy`. No email is sent by this feature.

All existing and future communities start private. There is no grandfathered server exception. Community sharing starts disabled. An admin can enable sharing; each member separately chooses whether to share wallet/Discord associations and whether to participate in community exports. Verification and previously-earned-role reconciliation continue using private wallets.

Changing a server's sharing state creates a new permission epoch. Existing choices do not cross epochs. Withdrawing permission immediately removes ordinary admin access and prevents subsequent downloads; files already downloaded cannot be recalled. A new grant does not reveal prior private history. A wallet needs a successful proof at or after the grant to appear in the ordinary shared current-wallet view/export; the member UI explains re-verification. Removed events and their proof dates are filtered separately.

Notices explain optional server-provided access/rewards, address-only inference risks, downloaded copies and operator authority. EVM typed signatures and Bitcoin challenges bind verification-page choices to the actual signed proof. OAuth member-portal changes use live membership and same-origin CSRF checks.

## Bouncer Operator

Set **backend-only** `BOUNCER_OPERATOR_DISCORD_IDS` to comma- or whitespace-separated numeric Discord user IDs. The owner will configure this manually in Railway. It defaults empty; malformed configuration denies the extra access. No real IDs are hardcoded or inferred from usernames, server ownership or request parameters.

Authority is checked on every protected backend request against the authenticated Discord OAuth ID. Removing an ID takes effect when the backend's updated configuration is active; an existing web session cannot preserve the extra privilege. UI badges only display the capability.

Operators can inspect retained private/current/removed wallets across Bouncer-installed communities. Sensitive reads require a successful actor/server/operation/time audit write before returning data. Operators can also export through an explicit override, including when community choices are off. Overrides require a reason and record scope, actor, filters, count and time. The policy and notices disclose this directly.

Server mutations still require a fresh Discord owner/Administrator check, including wallet blocks, reconciliation, rules and settings. An operator inspection permission is not a Discord management permission. Operators without guild admin rights can use the export override, but cannot change the community.

## Fresh server exports

Admins can build a bounded CSV snapshot of **current saved wallets for current members**. Removed wallets are never destinations. Ordinary exports require member export permission. Including Discord names/IDs additionally requires identity-sharing permission. Operator override is a separately audited authority, not fabricated member permission.

Filters:

- Wallet family: EVM, Bitcoin or all.
- Destination blockchain: Ethereum, Robinhood, Bitcoin or all.
- Verification channel; selected rule/collection.
- Current Discord roles to include (Any/All), and roles to exclude.
- Last successful Bouncer proof since a date; server join cutoff.
- Exclude server-blocked wallets (on by default).
- Optional Discord identity columns.
- All matching wallets, or the most recently proven matching wallet per member per network, with a stable address tie-breaker.

Categories combine with AND. Holdings are checked freshly for the applicable rules, using all saved wallets for combined eligibility and an individual contribution check for each output destination. Manual Discord roles use current Discord membership, since they have no asset rule. Explicit rule/channel criteria cannot be bypassed by an unrelated manual role. Chain filters describe the distribution/check scope, not proof that a signature occurred on that chain. Unscoped EVM destinations are labelled `evm`; no historical chain activity is inferred.

Jobs enumerate Discord members completely, share only reads within that new check context, pin supported RPC blocks, and refresh NFT trait metadata and Ordinals rule catalogs instead of falling back to a saved answer on provider failure. A required provider failure aborts the snapshot; no stale or partial download is offered. Export checks do not change roles, wallet links or proof timestamps.

The preview gives only output counts and deduplication reduction. Downloads recheck authorization, current membership/roles, wallet links/proof timestamps, rules, blocks and permissions. Any change that invalidates a row requires a fresh snapshot. The scan must finish within twelve minutes; download requires a snapshot started within fifteen minutes. Results expire after thirty minutes and are cleared by scheduled cleanup. Only the requesting actor can fetch the job/download. CSV cells escape formula prefixes.

## Retention, deletion and backups

Hourly cleanup expires ordinary removed/transfer-out associations one year after the latest removal for that member/address. It preserves a current/re-added link and the recipient's active link after a transfer. It redacts copied role-check evidence and reconciliation results, detaches action references, and invalidates temporary exports containing erased associations.

Members submit a deletion request in the member portal. Operators record an approval/decline outcome. Approval atomically removes current wallets and queues reconciliation for previously earned roles. New links/flows and new active role records are blocked while deletion is processing. A raced Discord grant is removed and its revocation target is queued durably before erasure can complete. Erasure waits for required jobs to complete and a safety interval at least fifteen minutes, extended for configured proof expiry. Failed reconciliation remains visible for retry; provider uncertainty does not silently finish deletion. Ordinary wallets/history, choices/events, flows, sessions, assignments and user-specific jobs are erased. Minimum block/security/administrative records have separate purposes and must be reviewed for necessity rather than retained indefinitely by default.

Completed requests lose their raw subject ID. A restricted SHA-256 account fingerprint and completion date remain for recovery, with no wallet address. This is pseudonymous recovery bookkeeping, not anonymous data. It does not prevent someone making a new account/proof afterward.

Active-database cleanup does not rewrite old backups. Before restoring an older backup, use the latest restricted deletion ledger, reapply deletions, reconcile required roles and run retention cleanup **before opening the application**. See [privacy operations](../privacy-operations.md). If the latest ledger cannot be recovered, keep the restored application offline while reconciling completed deletion records. Do not promise immediate erasure of recovery files or previously downloaded exports.

## Release validation

- Fresh private roles/schema/data backup; disposable restore and exact migration rehearsal.
- Fingerprints of every pre-existing application value unchanged by the additive migration.
- SQL checks: default privacy, epoch resets, private history/counts, backend-only permissions, retention, active/transfer safety, deletion blocking/role sequencing, recovery and export leases/expiry.
- Backend checks: operator scope/revocation, CSRF/membership, real EVM/Bitcoin signed-choice tamper rejection, privacy-filtered lookup, fresh/combined export checks, provider failure, permission and data changes before download, CSV escaping and deduplication.
- Frontend/backend production builds; desktop/mobile browser smoke of privacy controls, exports, deletion and public policy.

This implementation does not claim universal legal compliance. Operator identification and any jurisdiction-specific obligations still need review as the service and its audience change.
