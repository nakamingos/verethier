# Community wallet visibility

Status: implemented and released November 16, 2026.

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

## Release

Migration `20261116010000_community_wallet_visibility.sql` was applied to production and the feature released on November 16, 2026 (#146). Existing application data was preserved; the two-community snapshot was the only backfill, and it must not be replayed for future wallets.

Rehearsal: `backend/test/check-community-wallet-migration.py BACKUP_DIRECTORY` restores a private backup into disposable PostgreSQL and runs the `community-wallet-migration.sql` scenarios: the two-server snapshot, future communities and wallets, one-wallet transitions, explicit grants and opt-outs, transfer/removal/relink, admin search and audit isolation, retention, account erasure and SQL privileges. Backend and member/privacy/Control Room browser tests cover the rest.
