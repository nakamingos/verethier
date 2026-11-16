# Community wallet visibility — November 16, 2026

Wallets and ownership proofs remain account-wide. The association table controls ordinary community disclosure, not which wallets can qualify for roles. Blocks, supported proof networks, and community/network dormancy retain their existing behavior. Members can qualify using wallets that their community's admins cannot inspect.

## Agreed transition

Migration `20261116010000_community_wallet_visibility.sql` snapshots existing saved wallets and retained removed-wallet history for the two current communities only: `1369930881267142686` and `919772570612539422`. These `legacy` associations preserve existing visibility subject to current sharing/export choices and epochs. They do not grant member permission, cover future wallets, or extend to future communities. No incomplete historical reconstruction is used to hide an existing wallet at cutover.

An accepted ownership proof for a community records its association even when later eligibility checks find no qualifying role or a provider fails. The common transactional proof/link RPC performs the update for EVM, Bitcoin, and Solana. That individual wallet's first new community proof replaces the other legacy associations; other wallets stay grandfathered. Separately chosen community associations and deliberate per-wallet opt-outs survive. Merely connecting a wallet, linking it to the account without a community, or running scheduled checks creates no community association.

An explicit member sharing choice creates an independent association. It does not require another signature or reactivate dormant checks. Disabling that wallet hides it from ordinary admin views and exports, while retaining account-wide private verification. Community-wide sharing/export permissions remain additional gates. Changing a wallet association does not change role assignments, rules, or ownership proofs.

## Storage and lifecycle

`verifier_wallet_communities` stores the member, address, community, disclosure source, per-wallet permission, association/disclosure times and removal time. It does not duplicate wallet ownership or holdings. `verifier_wallet_community_events` records signed-proof and explicit member changes. Both tables deny public/client access; mutations use restricted backend RPCs.

Ownership transfer archives the former account's scoped disclosure history and starts a new owner's associations independently. Removal preserves authorized history under the existing one-year policy. A subsequent account-only relink never revives the previous tenure's grants. Database triggers account for INSERT-on-conflict behavior without deleting associations on routine same-owner proof updates. Cleanup, account erasure, and deletion-ledger recovery include both new tables. The operator's separate security records retain their existing rules.

## Disclosure boundaries

- Ordinary admin lookup returns only enabled current associations and permitted removed history. Empty results do not reveal whether undisclosed wallets exist.
- Address lookup and wallet-history/reuse audits apply the same boundary before returning matches, counts, history times or pagination. Nonlegacy history is restricted to the selected community; existing grandfathered history retains its prior scope until transition.
- Ordinary exports, including address-only mode, require an enabled community association and member export permission. Discord identities also require sharing permission. Download rechecks association state. Eligibility still evaluates all account-wide saved wallets; only permitted, matching destinations are output.
- Queued Discord wallet notices check community association both at enqueue and delivery. Messages still contain no wallet addresses. Logging failures cannot roll back a valid proof.
- Bouncer Operator reads and explicit export overrides retain their broader existing authority and audit requirements.
- New verification history preserves case-sensitive Solana and legacy Bitcoin addresses instead of lowercasing them. Existing history is not rewritten.

## Member UI

The Wallets tab defaults to **All wallets**, without combined dormancy warnings. A community selector shows saved wallets applicable to that community's available rules, including private wallets. Already associated wallets remain listed even after rules change, so members can still revoke sharing. It shows only that community's **Checks paused** network states, per-wallet sharing control, actual admin visibility, and legacy-transition explanation where applicable. Community privacy controls remain separate. Checkbox failures restore the authoritative setting. Removal is still explicitly **Remove wallet from Bouncer** and remains account-wide.

Wallet activity defaults to account-wide personal history; a community view filters to that context. Jobs for a previous wallet owner's account never expose that account's community IDs or results.

## Validation and release

`python3 backend/test/check-community-wallet-migration.py backup/bouncer-log-release-20261107T221833Z` restores an existing restricted backup into disposable local PostgreSQL, applies prerequisite migrations, fingerprints all existing public application tables, and rehearses the additive migration and `community-wallet-migration.sql` scenarios. It never connects to production or prints member records. Cases cover the two-server snapshot, future communities/wallets, one-wallet transitions, explicit grants and opt-outs, supported wallet families, failed-proof transaction rollback, transfer/removal/relink, admin search and audit isolation, operator evidence, retention, account erasure, and restricted SQL privileges.

Backend tests exercise scoped lookup, address-only and identity exports, download-time revocation, membership/CSRF boundaries, fail-closed reads, and queued notices. Member browser tests cover default and selected community views, independent sharing controls, failed mutations, account-wide copy/removal, no extra signatures, and narrow-screen rendering.

Local verification on November 16 passed both production builds, all 109 backend suites (2,137 tests), three additional admin lookup regressions, and member/privacy/Control Room browser checks at 1280, 393 and 320 pixels. The final SQL rehearsal also passed after the ownership lock and retention index were added. No production migration or deployment was performed.

Apply the migration once before releasing the dependent backend and frontend. Existing application data is preserved; new association records are the only backfill. Do not replay the snapshot against future wallets. A production backup and coordinated deployment remain release steps; local rehearsal does not establish production application or deployment.
