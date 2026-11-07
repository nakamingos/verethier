# Bouncer Discord activity log

In Control Room → Bot Settings → Bouncer activity log, choose a server text channel and save. Bouncer must have View Channel and Send Messages there. Selecting Disabled stops the feed. No channel is selected automatically, and no existing Discord channels are modified. Ordinary server owner/administrator permissions are required; operator inspection alone does not authorize configuration changes.

Choose successful verification, failed verification, blocked verification attempts, wallets added, wallets removed, roles granted and roles removed independently. Member and role mentions display without notification pings. Each post includes the event time. Verification includes Discord and member-portal flows; role changes include background checks, repairs and role-action exclusions. Repeated checks do not report a role grant/removal unless Discord actually changes it. A failed verification event follows a validated wallet proof; unsigned requests, invalid signatures and cancelled wallet prompts are not attributed as proven member events.

Messages contain no wallet addresses, signatures, verification tokens, arbitrary provider errors, private block reasons or identities of other wallet owners. Blocked messages report only that the member encountered this server’s restriction, while the full signed blocked-attempt evidence remains operator-only. Failure reasons are fixed, readable categories. Saved-wallet changes fan out only to communities with current sharing permission and an enabled log. Membership and privacy are checked again before sending; enabling sharing later does not expose older private events. These wallet events cover portal additions/removals and proof-based additions/transfers, without identifying a transfer counterparty. Account deletion clears queued events and suppresses further events while processing.

Posted Discord messages are external copies under the channel’s access controls. Revoking sharing does not delete existing posts. Configure the audience accordingly. No test/live messages are sent by the implementation checks.

## Delivery and release

Migration `20261107020000_bouncer_log.sql` adds optional server configuration, a private address-free outbox, narrowly callable backend RPCs and insert triggers for existing wallet activity/blocked proofs. New triggers queue new events only; no historical activity is backfilled. An outbox failure does not undo a wallet operation or bypass a wallet block. Role/failure enqueue errors do not change the verification outcome.

Apply the migration before releasing the backend and frontend. Rehearse using a fresh private roles/schema/data backup:

```sh
python3 backend/test/check-bouncer-log-migration.py PRIVATE_BACKUP_DIRECTORY [GUARDED_APPLY_FILE]
```

The worker claims events with database leases, renews active leases and sends up to five events every ten seconds. Discord failures retry with backoff for up to 24 hours. Expired entries are removed even when the Discord client is disconnected. Changing the channel or event choices rotates the configuration version and invalidates old queued events; background-check setting changes alone do not. Successful/discarded messages leave the outbox immediately. A stable Discord nonce reduces duplicates after an interrupted send; Discord’s recent-nonce window does not establish exactly-once delivery across long outages.

Tests cover private grants, atomic event capture, disabled defaults, sharing epochs, deduplication, claims, deletion, sanitized messages, mention suppression, configuration authorization, retries and actual role-change hooks. Browser coverage includes selecting/disabling a channel, event toggles, saving and responsive settings controls. Production Discord delivery requires a configured channel after deployment; automated checks use mocks and disposable PostgreSQL.

The linked application database received migration `20261107020000` on November 7, 2026, verified at 22:24 UTC. Checks confirmed its ledger entry, RLS, private client permissions, backend RPC grants and all four enabled triggers, with zero configured servers and zero queued messages. A fresh private backup and disposable rehearsals preserved all 24 existing public tables. The backend suite passed 1,797 tests, with all 27 targeted feature tests passing after six additional integration cases were added. Both builds, admin browser checks at 1280/768/600/393/320 pixels and privacy checks at 1280/393/320 pixels passed. Release the backend/frontend before configuring a channel; live Discord delivery has not been exercised by these checks.
