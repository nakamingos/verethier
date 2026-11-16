# Wallet checking and dormancy

Bulk grant-only qualification tries alternative requirements in this order: Ethereum NFTs/tokens, Robinhood NFTs/tokens, Base NFTs/tokens, Solana NFTs/tokens, Ethscriptions, Bitcoin Stamps, Ordinals. A sufficient result stops later tiers for that role. Earlier contributions remain available for combined count thresholds; same-tier reads remain concurrent. This does not reorder Discord role mutations or treat a failed subset as a complete failure. Reconciliation retains full evaluation. Operator bulk runs can explicitly restrict provider families; such runs are grants-only, and a partial blockchain check never becomes dormant-wallet proof.

A saved wallet becomes dormant after one complete successful check establishes zero matching holdings across every applicable rule in that community and network. A single matching item keeps it active, even if the role requires five. Provider failures, incomplete inventories, absent coverage, skipped requirements and minimum-count failures are not empty-wallet proof. Routine checks may complete missing coverage using the same provider caches; interactive verification does not start extra ownership scans just to classify emptiness.

Dormancy is per community and network. Ethereum covers both Ethereum NFTs/tokens and Ethscriptions; Bitcoin covers Stamps plus Ordinals for supported Taproot addresses. Base, Robinhood and Solana have separate scopes. A scoped smart-wallet proof authorizes only its proven chains. For example, dormancy on Base does not suspend an Ethereum check or checks in another server.

Dormant wallets stay saved, with their proof/history and existing privacy settings. Routine eligibility, recommendations and asset matching exclude them. Depositing new assets, refreshing the page or changing rules does not wake them. A fresh successfully validated wallet signature reactivates its authorized networks in the signed community. A generic member-portal wallet-link signature can reactivate those networks across communities. Idempotent link replays, connection-only observations and generic timestamp updates do not reactivate checking.

Member wallet cards and privacy-authorized admin member lookup show the network, empty-check date and need to sign again. Dormancy is independent of wallet removal: all wallets remain saved and there are no extra-empty-wallet removal flags or representative-wallet recommendations. Members can still remove a wallet through the existing member-portal flow. Admin status output includes only wallets they are authorized to see.

Fresh exports still examine otherwise eligible, consented saved wallets, including dormant ones. Export reads neither reactivate wallets nor mark them dormant. Dormancy does not alter export/sharing permission or override smart-wallet chain restrictions.

## Storage and deployment

Migration `20261109060000_wallet_dormancy.sql` was applied to production on November 9, 2026. No wallet was dormant at migration; classification happens gradually through later complete checks.

The backend-only `verifier_wallet_dormancy` table retains the association, scope, proof timestamp, empty-check timestamp and checked rule IDs. It stores no signature. RLS and revoked client privileges protect it; the service role reads rows and uses a guarded RPC to mark them. The RPC verifies the current owner/proof timestamp, exact current rule coverage, chain authorization, deletion state and, for bulk work, active job/member lease. A newer proof, changed rules or cancellation invalidates old work. Zero observations older than one minute are not used to mark dormancy after slow unrelated work. Wallet removal cascades dormant state, transfers clear the old association, and account deletion uses the existing wallet removal path.

Fresh-signature wrappers preserve the existing wallet block, privacy, transfer-confirmation and replay implementations. Their underlying functions and reactivation helper are not directly executable by API roles. Generic same-owner wallet updates never clear dormant state.

Rehearsal script: `backend/test/check-wallet-dormancy-migration.py`. Tests cover complete/partial/changed rule coverage, thresholds, uncertain contributions, community/network isolation, smart-wallet scope, proof races, cancellation, deletion, privacy filtering and both fresh-signature paths.
