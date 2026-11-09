# Wallet checking and dormancy

Bulk grant-only qualification tries alternative requirements in this order: Ethereum NFTs/tokens, Robinhood NFTs/tokens, Base NFTs/tokens, Solana NFTs/tokens, Ethscriptions, Bitcoin Stamps, Ordinals. A sufficient result stops later tiers for that role. Earlier contributions remain available for combined count thresholds; same-tier reads remain concurrent. This does not reorder Discord role mutations or treat a failed subset as a complete failure. Reconciliation retains full evaluation.

A saved wallet becomes dormant after one complete successful check establishes zero matching holdings across every applicable rule in that community and network. A single matching item keeps it active, even if the role requires five. Provider failures, incomplete inventories, absent coverage, skipped requirements and minimum-count failures are not empty-wallet proof. Routine checks may complete missing coverage using the same provider caches; interactive verification does not start extra ownership scans just to classify emptiness.

Dormancy is per community and network. Ethereum covers both Ethereum NFTs/tokens and Ethscriptions; Bitcoin covers Stamps plus Ordinals for supported Taproot addresses. Base, Robinhood and Solana have separate scopes. A scoped smart-wallet proof authorizes only its proven chains. For example, dormancy on Base does not suspend an Ethereum check or checks in another server.

Dormant wallets stay saved, with their proof/history and existing privacy settings. Routine eligibility, recommendations and asset matching exclude them. Depositing new assets, refreshing the page or changing rules does not wake them. A fresh successfully validated wallet signature reactivates its authorized networks in the signed community. A generic member-portal wallet-link signature can reactivate those networks across communities. Idempotent link replays, connection-only observations and generic timestamp updates do not reactivate checking.

Member wallet cards and privacy-authorized admin member lookup show the network, empty-check date and need to sign again. Additional empty wallets are flagged for review with the member. The representative is an active wallet when available, otherwise the most recently proven saved wallet with a stable address tie-break. No wallet is automatically removed, including the final saved wallet for a network. Admin review flags are calculated only from wallets that admin may see; they do not disclose hidden addresses or their existence.

Fresh exports still examine otherwise eligible, consented saved wallets, including dormant ones. Export reads neither reactivate wallets nor mark them dormant. Dormancy does not alter export/sharing permission or override smart-wallet chain restrictions.

## Storage and deployment

Apply `backend/supabase/migrations/20261109060000_wallet_dormancy.sql` before deploying this backend. No existing wallet is dormant on migration; classification is gradual through subsequent complete checks. No new environment variables are needed. The linked production database received migration `20261109060000` on November 9, 2026, verified at 17:13:42 UTC before publishing the dependent backend. Railway deployment completion is not verified here.

The backend-only `verifier_wallet_dormancy` table retains the association, scope, proof timestamp, empty-check timestamp and checked rule IDs. It stores no signature. RLS and revoked client privileges protect it; the service role reads rows and uses a guarded RPC to mark them. The RPC verifies the current owner/proof timestamp, exact current rule coverage, chain authorization, deletion state and, for bulk work, active job/member lease. A newer proof, changed rules or cancellation invalidates old work. Zero observations older than one minute are not used to mark dormancy after slow unrelated work. Wallet removal cascades dormant state, transfers clear the old association, and account deletion uses the existing wallet removal path.

Fresh-signature wrappers preserve the existing wallet block, privacy, transfer-confirmation and replay implementations. Their underlying functions and reactivation helper are not directly executable by API roles. Generic same-owner wallet updates never clear dormant state.

Rehearse against a private application backup, without changing production:

```sh
python3 backend/test/check-wallet-dormancy-migration.py PRIVATE_BACKUP_DIRECTORY
```

Validation covers complete/partial/changed rule coverage, thresholds, uncertain individual wallet contributions, community/network isolation, smart-wallet scope, proof races, cancellation/worker guards, deletion, retained history, privacy filtering, both fresh-signature paths and replay rejection. Browser checks cover member/admin display at desktop and mobile widths.

Local validation on November 9, 2026: all 1,976 backend tests passed across 96 suites; backend and frontend production builds passed. The disposable migration rehearsal preserved all 27 pre-existing application tables and original signing-function bodies, including six simultaneous empty-check/signature races. The guarded production migration was subsequently applied and verified at 17:13:42 UTC, including RLS, backend-only writes, retained signing-function bodies, signature wrappers and the transfer trigger. The dormant-wallet table was empty after migration, so existing wallets remain active until a complete empty check. The existing private pre-release backup was reused; no new member/wallet data export was made.
