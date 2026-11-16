# Bulk role checks

Control Room → Bulk role check is available only to Bouncer Operators and can grant new roles to current members using their saved proven wallets. The audience can be current holders of a selected Discord role or all currently verified members in this server. The latter means live members with saved wallets and either server verification activity or earned-role history. Bots and departed members are excluded. An audience can contain up to 10,000 members; larger selections require a narrower source role.

Choose one rule’s exact requirements or all server rules. All server rules preserves existing combined collection/count groups and alternative qualification paths. Grant eligible roles only is the default. Roles already held are left as-is without extra provider reads in this mode. Grant and remove proven failures is a separate, confirmed action; alternative ways of earning the target role protect it from removal. Provider uncertainty never becomes a proven failure. Role exclusions remain enforced, and grants-only jobs skip grants that would trigger configured removals of other roles the member holds.

Preview saves a fixed current audience for 30 minutes; it does not check holdings or change roles. Starting explicitly authorizes the saved selection. Each member is checked against current ownership, restrictions, membership and deletion state. Rules changing during a run stop remaining work with a stale result rather than granting through an old definition. Each role change requires current administrator authority and an active member lease. Changing wallet links or restrictions while a provider request is in flight requires retry; new grants are checked again afterward and rolled back if their wallet evidence changed. No new signature is required, and wallet addresses are not returned in previews or job results.

Background work uses durable per-member leases and three attempts, with a one-minute delay before retrying unavailable checks. Progress and member results survive tab changes and restarts. Counts separate granted roles, removed roles, already-held roles, ineligible members, members without wallets, provider uncertainty, exclusions, members who left the audience and exhausted failures. Retrying retains recorded actual grants/removals. Cancelling stops remaining work; completed changes remain. A Discord request already in flight may finish while cancellation is being recorded.

Bouncer Operator allowlist membership and normal server owner/administrator permission are both required to preview, start, resume, retry, cancel or delete. Lists and reports are operator-only, with the existing audited server read-access check. Queued and active jobs stop before further ownership checks or role mutations when the execution account is no longer an operator. Previously completed changes remain. Operator inspection uses the existing audited read-access path and does not grant mutation authority. The execution administrator must remain authorized. Jobs and results expire after 30 days, and account deletion clears matching member-result records. Configuration and action metadata identify who created, started, retried or cancelled the job. Public/client database privileges are revoked; only backend RPCs and services access job tables.

Migrations: `20261107030000_bulk_role_checks.sql`, `20261109030000_bulk_role_throughput_resume.sql` and `20261109050000_delete_bulk_role_checks.sql`, all applied to production in November 2026, each with a rehearsal script in `backend/test/`. Browser coverage: `frontend/test/bulk-role.smoke.cjs`.

## Throughput, resume and failed retries

The worker pool prepares up to twelve members concurrently and refills each reader as soon as its member finishes. A separate three-slot limit covers current-state guards, Discord mutations and assignment bookkeeping; each member still applies roles in original order. An empty queue backs off for five seconds; start/resume/retry wakes it immediately. Each member can prefetch up to three role eligibility checks; role mutations still run one at a time in the original order. Validated server rules are reused for these reads, independent guard reads overlap, and known ineligible results that require no role mutation avoid redundant mutation guards. Current permissions, rule version, lease, membership, privacy/deletion state, wallet links and blocks are still checked before role changes. Existing provider pacing and interactive-verification priority remain in effect.

Fresh complete ord.net collection responses can be shared between members of the same job/run for 60 seconds after a scan finishes. In-flight scans are shared too. Expired shared evidence and any prefetched role evaluation older than 60 seconds are rechecked before a later role mutation. Failed scans are not retained as successful reads, and an unrelated failed collection does not invalidate another role's known qualifying evidence. Member wallets, restrictions, eligibility results and other ownership caches remain private to each member context. Cancelling, resuming or requesting a retry invalidates that job's shared window. Windows are bounded in memory and are not persisted as current ownership.

**Resume check** is available for a started, cancelled check with unfinished members. It also allows an authorized operator with server administrator permission to continue a failed job that still has unfinished members after a permission-related stop. Completed member rows and recorded grants/removals are retained; unfinished members are checked using fresh contexts. Exhausted failures are left for **Retry failed**. Active member leases are preserved so an in-flight Discord request can finish checkpointing before the member is claimed again. Interrupted work does not consume an additional provider retry. An unstarted cancelled preview cannot be resumed, and expired jobs or changed rule definitions require a new preview.

**Retry failed** requeues failed members with a new three-attempt allowance and retains completed members, recorded actual role changes and other live leases. It can be used while a job is running. On a cancelled job that also has unfinished work, the button says **Resume and retry failed** because both are continued. Starting, resuming or retrying a removal-enabled check requires confirmation. Lost action responses reuse the same request receipt.

Each claim has its own worker token. New run receipts fence workers from an earlier cancellation/resume, and database claims prevent two bulk jobs from concurrently operating on the same server/member. Claim, transition and completion functions use consistent job/member lock ordering. Completion remains serialized so concurrent workers cannot leave a finished job marked running.

Member results record `elapsed_ms`, `eligibility_work_ms`, `guard_work_ms`, `mutation_work_ms` and the number of role checks. Server logs include elapsed and phase durations. Eligibility work can overlap, so its summed duration can exceed wall-clock elapsed time. These measurements do not expose wallet addresses or provider credentials.



## Delete saved checks

Recent bulk checks provides a Delete button for previews, completed, failed, stale and cancelled checks. A confirmation explains that deletion removes the saved report and its per-member results without undoing Discord grants/removals or deleting earned-role history. Pending/running checks must be cancelled first; a cancelled or stale check with a live member lease remains protected until that member finishes checkpointing. Deleting the currently open report clears its results view and polling. Outdated history responses cannot restore a deleted entry.

Deletion uses the existing CSRF-protected action endpoint and requires live server owner/administrator permission. Backend-only RPC `verifier_delete_bulk_role_check` locks the server-scoped job and running member rows before checking active work, using the same job-first order as resume/claim/completion. Concurrent resume either wins and prevents deletion, or finds the report already deleted. Repeating a deletion after a lost response is harmless. Only bulk member reports cascade; earned-role assignments remain independent.



## Slow provider retries and freshness

A member is counted as processed only after completion or the final exhausted attempt. Successful attempt work that still contains unavailable roles stays pending during the retry delay, so the completed-member count can remain unchanged while workers continue checking. The portal now explains that provider retries can take several minutes before that count advances.

Freshness checks consider only the public collections relevant to the role about to change. An expired collection read used by another role no longer invalidates otherwise current evidence for an unrelated role. Ineligible results that require no role mutation do not trigger a redundant provider recheck merely because earlier work exceeded one minute; removals of held roles and all grants still require fresh ownership and the existing current-state guards. Member-private caches and provider pacing are preserved.

The November 9 `dabl` incident was a late collection-parser failure (an ord.net bundle card), not a failed resume: the job kept renewing leases and retrying while the processed count stayed flat. The parser now handles bundle cards; see the backend README.

## Larger read cohorts and early qualification

Read concurrency is independent of mutation concurrency: twelve member workers can join the same fresh collection scans, while only three guarded role-change sections run at once per backend process. A reader waiting for a provider does not occupy a mutation slot. Evidence that expires while waiting for a mutation slot is reread outside the slot before guards and mutations proceed. Cancellation, rules, administrator authority, membership, wallet links, blocks and deletion/privacy guards remain checked after waiting. Role order within a member is retained, and the shared public snapshot lifetime stays at 60 seconds after a complete scan.

Background wallet inventories have a separate three-slot limit so the larger member cohort cannot flood provider queues. Interactive verification bypasses that background limit and retains the existing provider priority/pacing; otherwise an interactive verification waiting for a bulk slot could pause the very background requests occupying it. HTTP gaps, provider limits, persistent Ordiscan allowance and retry policies are unchanged. Within each member, ID checks share a numbered inventory only when an unchecked planned rule actually requires unscoped numbers; already-held roles and unrelated alternatives to a selected grant-only rule do not force unnecessary numbered lookups.

Grant-only all-rule checks try ordinary database-backed Ethscription alternatives first. A fully qualifying result can grant without calling Ordinals providers for other alternatives. An insufficient subset never proves full failure: remaining rules are still evaluated, with the original combined counting and deduplication. Missing data remains unavailable, and reconciliation/removal checks plus ordinary engine callers still evaluate the complete rule set. Freshness checks follow the actual qualifying proof, so an expired Ordinals alternative cannot invalidate sufficient, current database evidence.

Member timing/log records add `mutation_queue_ms` to distinguish role-write contention from provider work. In a controlled 51-page scenario, one twelve-member cohort made 51 provider calls where four three-member cohorts made 204, with identical counts; that measures request reuse, not a promised wall-clock speedup.

## Network priority and saved empty wallets

Grant-only qualification now follows Ethereum → Robinhood → Base → Solana → Ethscriptions → Stamps → Ordinals, stopping later alternatives once the role is earned while preserving combined counts. Saved wallets can become dormant after one complete successful zero-holdings check for the community/network. They remain saved, skip routine checks and need a fresh member signature to reactivate. See [wallet checking and dormancy](wallet-checking.md) for coverage safeguards, privacy and deployment requirements.


## Select networks for a bulk run

The Networks checkbox dropdown defaults to all networks and supports Ethereum NFTs/tokens, Robinhood NFTs/tokens, Base NFTs/tokens, Solana, Ethscriptions, Bitcoin Stamps and Ordinals. Choosing none is invalid. Only rules in the selected families become targets, and combined thresholds use only contributions from those selected rules. Ethereum and Ethscriptions are separate options; Stamps and Ordinals are separate options.

A subset is grants-only. Both the UI and backend reject removal-enabled filtered runs, since excluded requirements could still qualify a member. Unselected providers are excluded from eligibility, asset matching and follow-up dormancy audits. If completing dormancy coverage would require an excluded protocol on the same blockchain, the wallet stays active rather than causing extra provider calls or a false empty result.

The canonical selection is saved in the existing job labels and bound to its rule-version guard. Preview, history and results identify the scope. Start, resume and retry use that stored scope regardless of later form edits. Older reports without a selection retain all-network behavior. No database migration or new environment variable is required.

The preview response must confirm the requested selection before the UI offers Run. Older backends that ignore the new field therefore cannot silently expand a run. Filtered jobs also have a scoped rule-version marker, so an older worker stops them before checking providers rather than treating them as all-network jobs. The existing operator, server-administrator, CSRF, cancellation and mutation-freshness checks remain in force.
