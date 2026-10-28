# Bouncer implementation plan: Halcyon guide core features

Planning baseline: Bouncer `167a835`, reviewed October 17, 2026.

Source: `Halcyon Gate Default Guide to a Verification Bot.md`. The guide is a fictional product template, not a deployment specification. Its domains, IDs, vendor claims, example addresses and claimed chain count are not Bouncer configuration or verified integrations.

Build on the existing Angular frontend, NestJS backend, Supabase database and verification engine. Add the portals and missing verification features in stages, retaining Bouncer's name and working mobile wallet flow while adopting InscriBurner's Aseprite styling, colors and fonts.

## Scope

Include the admin portal, member portal, installation/setup assistance, diagnostics, member troubleshooting, core rule editing, background-check settings, wallet management, additional asset/network families, wallet compatibility and user documentation.

Leave out both optional add-ons, Rule Blender and LinkWarden; all social-profile extras and tipping; marketing email collection; optional rule descriptions, maximum balances and URL-hosted ID lists. Also defer explicitly optional new-chain filters such as TON NFT token IDs and XRPL taxon/trait filters. Existing Bouncer options remain supported. AND/OR matching of several NFT traits belongs to the core rule editor; it is separate from the excluded role-combining add-on.

Accepted scope: ship the admin dashboard first, followed by the member portal. Communities shows joined servers only; public discovery is deferred. Additional networks and wallet/address formats, including broader Bitcoin addresses, are deferred until the user chooses which integrations to implement. Phases 6–7 below are a future reference, not authorized integration work for this release.

Track optional ideas separately in the [optional feature backlog](optional-features.md).

## Current implementation status

Checkpoint: October 18, 2026, through multi-trait rules and ERC-721 ID selections/quantity thresholds. Earlier portal follow-ups include member lookup by wallet address ([PR #100](https://github.com/nakamingos/verethier/pull/100), `f01d904`).

| Phase | Delivered | Remaining |
| --- | --- | --- |
| 1. Shared backend and authentication | Authenticated portal APIs, live server authorization, shared rule operations and durable reconciliation. | Maintain these guarantees as features are added. |
| 2. Admin dashboard and setup | All four admin tabs, invite/return flow, reviewed channel selection/creation, resumable setup, verification-message controls, live **Check Setup** with provider probes and reviewed message recovery, `/help` and `/join`. | Maintain diagnostics as supported operations/providers expand. Bounded setup probes and unchecked wallet inventories are labeled explicitly; see the [setup notes](../portals.md#installation-and-check-setup). |
| 3. Rule editor and role changes | Validated editor, change reviews, combined groups, Undo/Redo, multi-trait AND/OR conditions, bounded ERC-721 ID lists/ranges with quantity thresholds and reconciliation for rule changes and signed verification. | No unfinished core milestone; legacy trait columns have been retired. |
| 4. Settings and member troubleshooting | Background-check toggle, member lookup, fresh Check Roles and earned-role repairs. | No separate unfinished milestone identified. |
| 5. Member portal | Wallet management, fresh proofs/transfers, removal reconciliation, joined-community verification and resumable flows. | Public discovery and signature-free rechecks remain optional. |
| 6–7. Additional integrations | Existing supported assets and wallet formats remain available. | Deferred until the user chooses integrations. |
| 8. Documentation and release | Documentation, migration rehearsals and regression checks accompany delivered milestones. | Continue with each remaining milestone. |

Portal follow-ups have also shipped: unified wallet activity, Earned/Available community role views, removed-wallet history with last-proof dates and explorer links, server wallet blocks, role-removal actions, shared-wallet-history audits and wallet-address lookup. See [portal behavior and operational notes](../portals.md).

The accepted core feature milestones are delivered. Canonical trait storage cleanup is complete: the old columns and synchronization trigger are removed, while command input and historical audit JSON are translated at their boundaries. Compatible existing rules were consolidated with an audit trail and unchanged eligibility. Additional network and wallet integrations still require the user to choose the scope. Privacy/sharing/export ideas and wallet-first/X accounts remain in the [optional backlog](optional-features.md#privacy-sharing-and-registration).

## Conflicts and recommended decisions

These recommendations deliberately preserve established Bouncer behavior where the guide proposes a different policy. They need to be settled before implementing the affected phase; adding a portal must not silently change them.

| Topic | Guide | Current Bouncer | Recommended plan |
| --- | --- | --- | --- |
| Admin interface | Everything is configured in the Control Room. | `/setup` manages rules, messages, wallet blocks and audit logs. | Add the web dashboard alongside the current commands. Both call the same backend operations. |
| Commands | Says only `/help` exists, but also documents `/join` and add-on commands. | Administrator-only `/setup` with asset-specific creation commands. | Preserve current `/setup` commands. Add member-facing `/help` and `/join`; do not infer a command-removal requirement from the inconsistent template. |
| Roles at installation | Roles must exist before adding the bot. | An admin can create a Discord role during rule setup. | Offer both existing-role selection and inline creation in the dashboard. |
| Admin authorization | Everyone who can see the admin channel can edit rules. | Setup commands require Administrator. | Require server owner/Administrator authorization on every admin API operation. Channel visibility is never an authorization credential. |
| Channel dependence | The admin channel cannot be renamed/deleted; the join channel cannot be deleted. | Rules are linked to channel IDs; messages can be refreshed, replaced or recovered. | Keep ID-based bindings and recovery. Rebinding a deleted channel is an explicit admin operation; renaming does not break setup. |
| Bot permissions | Always requires Manage Channels and Ban Members, among five permissions. | Verification assigns roles and posts/reads messages; wallet blocking is not Discord banning. | Check permissions against the chosen operation. Manage Channels is needed for channel creation, not all verification. Ban Members is outside this plan. Diagnose message/embed/history permissions and role hierarchy too. |
| Verification scope | Presents one community-wide entry point. | Manual verification and recommendations are scoped to the originating channel's rules. | Keep that scope. Community cards use a configured default verification channel and offer other configured channels when necessary. |
| Repeated verification | An already-linked wallet needs no new signature. | Each manual verification requires a fresh proof; an approved wallet connection can be reused. | Keep fresh signatures by default. A signature-free check of saved wallets would be a separate policy change requiring authenticated Discord sessions and explicit agreement. Never equate a restored WalletConnect connection with a fresh proof. |
| Duplicate wallets | Duplicate alert/reset flow, approximately five-minute wait. | Fresh proof transfers an address to the new Discord user; the prior account is rechecked. | Preserve proof-based transfer and one Discord account per wallet identity. Add a clear transfer confirmation rather than an arbitrary timer. |
| Disconnecting | Disconnect removes the wallet from all communities and removes dependent roles. | Disconnecting the wallet app does not delete its saved Bouncer link. An internal removal method exists, but no member wallet-management UI. | Distinguish app connection from **Remove wallet from Bouncer**. Removal must update stored links and reconcile roles across affected communities using remaining wallets. |
| Background checks | Only revoke; never grant or restore. | Rechecks revoke failures and restore eligible previously earned roles. They do not award previously unearned roles. | Preserve this established policy. Add a per-server enabled/disabled switch without changing who can receive a new role. |
| Manual role refresh | With background checks disabled, manual verification removes ineligible roles. | The main signed verification flow primarily grants/tracks matching roles; scheduled reconciliation handles removals. | Add reconciliation of affected previously earned roles during manual verification. Check every alternative rule before removing a shared role. |
| Rule deletion | Immediately strips roles received through that rule. | The removal handler deletes the rule; it does not immediately reconcile Discord roles. | Immediately queue reconciliation for affected tracked holders. Keep a role if another rule or remaining combined holdings still qualifies. Preserve Undo/Redo. |
| Combined holdings | Describes independent token criteria and an optional role-composition add-on. | Collectible counts can combine across collections/protocols for matching role/minimum groups; ERC-20 balances are evaluated separately. | Preserve Bouncer's existing aggregation and deduplication. Display the combined group and evaluation scope clearly in the dashboard. The guide does not specify equivalent count aggregation. |
| Trait matching | Exact trait matches; multiple pairs can use AND/OR. | Case-insensitive AND/OR conditions in the portal, with simple single-trait slash inputs. | Preserve same-asset matching and quantity behavior as providers expand. AND means all pairs on the same asset, not different assets satisfying different pairs. |
| ERC-1155 IDs | Mandatory except the marketplace collection shortcut. | Custom IDs/ranges are supported; otherwise checks cover IDs 0–99. | Keep existing rules valid. Show the bounded default explicitly and allow a custom scope; do not label that default as an exhaustive collection scan. |
| ERC-721 ID selections | Describes token-ID lists, ranges and mixed entries in the generic NFT rule editor. | Both ERC-721 and ERC-1155 support lists/ranges up to 1,000 unique IDs and positive quantity thresholds. | Preserve existing single-ID rules and per-asset deduplication. ERC-1155 copies retain their quantities. |
| Rule/API representation | Generic JSON and pass/fail results. | Typed rule fields, count aggregation, and passed/failed/unavailable outcomes. | Reuse the validated model and retain unavailable as distinct from zero holdings. Do not replace it with an unchecked JSON blob or boolean-only result. |
| Bitcoin addresses | Members can verify whichever payment/Ordinals address holds the asset. | Bitcoin proofs and storage accept mainnet single-key Taproot Ordinals addresses. | Broader Bitcoin address/proof support is required before offering the guide's payment-address behavior. |
| Multisig | Describes one owner signing and receiving the multisig's roles. | EVM proof validation currently recovers an externally owned account's signature. | Add contract-wallet validation. Do not treat an owner's personal signature alone as proof of a multisig's entire holdings. |
| Wallet walkthroughs | Makes blanket hardware restrictions and says leaving the wallet during QR approval requires restarting. | Working connection/session reuse has been tested on mobile. | Publish tested compatibility guidance and preserve session reuse. Do not reintroduce forced disconnections or restart requirements. |
| Broken setup | A missing role or permission can pause the bot. | Failures can be handled at rule/check level. | Identify affected rules/channels. Keep healthy verification available; mark uncertain checks unavailable and preserve earned roles. |
| Network coverage | Approximately 30 EVM chains plus Solana, Bitcoin, TON and XRPL. | EVM NFTs/ERC-20 on Ethereum and Robinhood; Ethscriptions and Bitcoin Ordinals. | Treat this as several new integrations, not a dropdown expansion. Choose a real supported network/provider list and validate each before enabling it. |

## Implementation order

### 1. Shared backend operations and portal authentication

- Extract shared rule creation/removal, permission checks and reconciliation operations from Discord handlers. Reuse the existing rule-edit service, eligibility engine, normalization, wallet blocks, audit history and Undo/Redo behavior.
- Add Discord login for the portals. Use backend-validated OAuth state, server-side token handling and revocable secure sessions. Protect cookie-authenticated mutations with origin/CSRF checks and encrypt any persisted OAuth credentials. [Discord's OAuth documentation](https://docs.discord.com/developers/topics/oauth2) describes the authorization flow and state validation.
- Check the acting user's current server permissions for admin reads/mutations and the member's identity/server membership for member actions. A client-supplied Discord ID, channel ID or role ID cannot establish access.
- Expose portal API/auth routes under the frontend origin through Caddy. This avoids depending on cross-site cookies between separate Railway hosts. Keep static-site serving; [Railway documents the Caddy SPA/API-proxy arrangement](https://docs.railway.com/guides/spa-routing-configuration).
- Configure and test trusted proxy forwarding so IP-based rate limits still distinguish clients through Caddy/Railway without trusting arbitrary client-supplied forwarding headers.
- Use persistent, idempotent reconciliation jobs for changes that affect many members. Return progress/results to the dashboard and retry failed Discord changes without repeating completed work.

Done when a server administrator can access only their servers, a member can access only their own account, and the same rule operation produces the same result from Discord or the dashboard.

### 2. Admin dashboard, installation and setup diagnostics

- Add `/admin` with a server selector and **Rules**, **Bot Settings**, **Member Lookup** and the existing **Audit Log**.
- Provide bot installation from the server selector, then return the admin to setup for that server.
- Let existing installations select their current verification channels. For new installations, offer creation of a private admin channel and a member verification channel. Store IDs and avoid overwriting existing permissions or duplicating messages on retries.
- Reuse `/setup verification` refresh/new/recover operations in the portal. An admin-channel dashboard link is a convenience, not a login bypass.
- Add **Check Setup** to the portal and `/help`: bot presence, required operation/channel permissions, role manageability/hierarchy, deleted roles/channels, verification-message availability, and configured network/provider health.
- Show a warning banner with affected rules and actionable fixes. **Fix** can restore a missing message or perform an explicitly previewed repair. Missing Discord permissions/hierarchy require an authorized human; the bot cannot grant itself access.
- Add member `/help` and `/join`. `/join` uses the configured verification channel, or asks the member to choose when there is no unambiguous default. Administrative help buttons still enforce admin authorization.

Done when channels can be renamed, a deleted verification message can be recovered, and one bad rule does not disable unrelated rules.

### 3. Rule editor and consistent role-change behavior

- Add create/edit/delete/filter forms using the existing asset-specific validation and autocomplete. Keep role creation, labels, canonical slugs, ID/number lists and compact inclusive ranges.
- Extend specific ERC-721 selections to lists/ranges, with batched ownership reads and quantity thresholds. Retain bounded EVM token-ID lists; large Ordinals/Ethscriptions number ranges remain compact predicates rather than expanded API calls.
- Show only relevant fields after asset/network selection. Reset clears the unsaved form; editing and deletion show a concrete change preview. Keep Undo/Redo for saved changes.
- Make cross-protocol count groups visible: target role, common minimum, contributing rules, wallet stacking and channel scope. Reuse asset identity deduplication. Keep independent ERC-20 threshold handling.
- Add multiple trait conditions with AND/OR for supported metadata-backed collectibles, including the existing NFT, Ordinals and Ethscriptions paths. Evaluate the full predicate against each asset before counting it. OR matches count each asset once; ERC-1155 copies retain quantity semantics. Extend the existing provider/cache paths rather than importing another metadata store.
- Backfill existing single-trait rules into the new filter representation without changing their matches. Update constraints, uniqueness checks, cache fingerprints, autocomplete and rule-edit comparisons together. Remove superseded storage after rollout; do not keep two authoritative trait definitions.
- Slash commands keep their simple single-trait inputs. Lists show all conditions on a multi-trait rule; a slash edit must never silently discard conditions configured in the portal.
- On deletion or a requirements change, reconcile the affected role for previously tracked members immediately. On Undo, restore the rule and re-evaluate eligibility; do not blindly reassign a historical set of holders.
- Add affected-role reconciliation to manual verification so disabling scheduled checks does not prevent explicit verification from removing proven-ineligible roles. New grants remain limited to the selected channel. Before removing a role, evaluate its other rules and linked wallets, including alternatives outside that channel.

Done when a rule's behavior is identical through both interfaces, overlapping rules do not double-count, and deleting one qualifying path cannot remove a role supported by another path.

### 4. Bot settings and member troubleshooting

- Add a per-server background-check switch, enabled by default. Keep the existing six-hour schedule and previously-earned-only restoration policy.
- Turning the switch off skips scheduled eligibility checks and role changes for that server. Explicit verification, wallet removal/blocking, rule changes and an administrator-requested fix still perform their required reconciliation.
- Member Lookup accepts a Discord snowflake as a string; do not require exactly 18 digits. Restrict lookup/results to the administrator's server.
- **Check Roles** compares live Discord roles with tracked assignments and fresh eligibility. Show qualifying, ineligible, unavailable, missing and stale results with reasons and last-check times.
- **Fix** restores/removes previously earned roles and retries failed Discord changes. Use the previously-earned, server-scoped reconciliation entry points; the broader manual role monitor can grant new roles. Newly qualifying, never-earned roles require the member to verify. Failed provider checks never authorize removal.

Done when an admin can explain a missing role, safely repair an earned role, and see an unavailable provider without mistaking it for zero holdings.

### 5. Member portal and saved-wallet management

Implemented October 18, 2026: `/member`, separate fresh account-link proofs, explicit transfers, atomic removals and durable reconciliation, joined-community channel selection, and backend pending flows. Validation and operational details are in `docs/portals.md`. Public discovery and additional wallet/network families remain deferred.

- Add `/member` with **Overview**, **Wallets** and **Communities**. Populate wallet/community/role counts from existing linked-wallet and assignment records; rendering a dashboard should not run new ownership scans.
- Keep the existing direct Discord-to-`/verify/:nonce` flow available. Use Discord login for portal/account management while preserving the current verification experience.
- **Wallets** shows shortened addresses, network/type, copy/view actions, **Add wallet** and **Remove wallet from Bouncer**. New links and transfers require fresh ownership proof and respect server wallet blocks.
- Bind portal wallet-link challenges to the authenticated member, proof purpose and expiry. Reuse the cryptographic verifiers, with wallet-link operations separate from channel role-verification operations.
- Reuse the current EVM/Xverse/UniSat signing flows and approved EVM sessions. Wallet selection and app connection are distinct from proving ownership or removing a saved link.
- Removing a wallet previews affected communities, deletes only that member's link, then reconciles their previously earned roles across those communities using all remaining wallets. Preserve roles justified by other wallets/rules and retain uncertainty for retry. Record the action and progress.
- **Communities** lists joined servers with search, requirement summaries and a Verify action. Public discovery is deferred; membership-specific information remains private. Verification uses the server's configured channel context rather than silently checking every channel.
- Provide a resumable pending-flow banner with Continue/Not now. Keep the intended member/server/channel on the backend, recheck expiry, and require a new challenge if the existing one is invalid. Resume must not replay a consumed proof or leave two requests active.
- Keep fresh signatures for manual verification in the proposed baseline. If the no-new-signature behavior is chosen instead, add a separate authenticated endpoint restricted to the logged-in member's already-proven saved wallets; it still fetches current ownership, enforces blocks, and cannot add/claim wallets.

Done when members can manage their saved wallets, understand community requirements and repeat verification on mobile without disrupting the working connection flow.

### 6. EVM coverage, marketplace entry and additional wallet proofs

Base now has ERC-20, ERC-721/1155, metadata, rule/editor and export coverage. Production use requires the Base RPC configuration, migration and live acceptance checks described in [Base mainnet](../../backend/README.md#base-mainnet). Other network additions and contract-wallet proofs remain open.

- Replace the two-network hardcoding with a registry containing chain identity, supported asset capabilities, backend RPC/metadata configuration and enabled/paused status.
- Retain Ethereum and Robinhood, then validate the guide's named additions: Base, Arbitrum, Optimism, Polygon and Avalanche. Additional networks require an explicit list and working provider coverage; the guide's invented “about 30” is not an acceptance count.
- Each network must pass wrong-chain RPC rejection, ERC-20 exact-unit balances, ERC-721/1155 ownership, metadata/trait availability, failure preservation and combined-count tests before appearing as supported.
- Add Ethereum marketplace-slug entry as a resolver into canonical contract rules. Confirm a real marketplace API and access before implementing it. If a collection spans several contracts, show the resolved scope and use separate contributing rules under Bouncer's existing count model. Keep display names separate from collection identity.
- A marketplace ERC-1155 collection also needs complete token-ID discovery from that provider, or an explicitly bounded custom ID scope. A marketplace slug must not silently turn the existing 0–99 scan into a claim of exhaustive collection coverage.
- Add EVM contract-wallet proof verification using [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271), instead of relying solely on account recovery. Validate on the appropriate chain and scope contract-wallet proofs accordingly; control of an address on one chain does not establish control of a contract at that address on another chain.
- Broaden Bitcoin address support only alongside supported proof validation and wallet tests. Address-format acceptance alone is insufficient; [BIP-322](https://github.com/bitcoin/bips/blob/master/bip-0322.mediawiki) defines script-dependent proof formats. Retain the existing Taproot flow while adding tested payment-address cases.
- Publish a tested browser/mobile/hardware/QR compatibility matrix. Test back-to-back connections and signatures using actual supported wallet apps.

Done when each newly advertised network and wallet type passes live proof, ownership, transfer, failure and repeat-verification tests. Paused networks return unavailable and retain earned roles.

### 7. Remaining chain and asset families

Implement one adapter at a time behind the same proof/ownership/reconciliation interfaces. Each needs a real wallet flow, provider, complete pagination strategy, normalized asset identities, numeric handling, error model and live test assets before release.

| Adapter | Required initial coverage | Integration gate |
| --- | --- | --- |
| Solana | Fungible tokens by mint and minimum; NFTs by verified creator or master edition; multiple filter addresses. | Validate creator/edition relationships and compressed-NFT ownership with a suitable indexer. Metaplex's [creator lookup](https://www.metaplex.com/docs/dev-tools/das-api/methods/get-assets-by-creator) supports verified-creator filtering; confirm full edition and compression coverage with the selected provider. |
| Bitcoin Stamps | Creator address, stamp ID, or both; reject both empty. | Select a Stamps-aware inventory provider. The current Ordinals APIs are not automatically Stamps providers. Test combined creator/ID matching and quantities. |
| TON | TON coin minimum, Jetton master address, NFT collection address; one tested TON wallet initially. | Implement backend proof validation and current balances/ownership. Follow the official [TON proof flow](https://docs.ton.org/applications/ton-connect/how-to/ton-proof), including domain, challenge and time checks. |
| XRPL | Fungible currency code plus issuer; NFTs by issuer. | Select a wallet proof flow and ledger/indexer access; support pagination and exact issued-token balances. Validate issuer/NFT identity against the ledger's [NFToken representation](https://xrpl.org/docs/references/protocol/data-types/nftoken). |

Keep address normalization specific to each protocol; do not apply EVM lowercasing to case-sensitive address formats. New collectible adapters participate in combined item counts only once their quantities and asset identities are unambiguous. Fungible balances retain separate unit-aware evaluation.

This phase is part of the complete non-optional guide coverage, but it should ship as separate integrations after the portal foundation. Provider credentials, production limits and representative test wallets are prerequisites, not assumptions based on the fictional guide.

### 8. Documentation, migration and release

- Publish Bouncer's actual application ID, invite, official verification domain and support links. Explain message signing, read-only member-wallet access, role timing, supported wallets, pending requests, expired/superseded links and provider outages. Use real tested wallet instructions rather than fictional compatibility claims.
- Document wallet transfer/removal, channel recovery, role hierarchy, background-check behavior, multiple wallets and combined minima. Document that support never needs a member's seed phrase/private key or token approvals.
- Verify the remote database backup and rehearse each migration on a restore before production. Preserve existing rules, wallet links, blocks, assignments, audit history, Ordinals catalogs and evaluation results.
- Ship additive schema and backend operations before their UI; backfill and verify existing data before removing superseded columns. Release each phase through a reviewable branch/PR. Refresh Discord commands where changed.
- Test existing signed verification, combined counts and wallet transfers alongside new portal authorization, deletion/unlink alternatives, Undo/Redo, disabled background checks, unavailable providers and mobile repeat verification.

## Database additions by stage

Use separate migrations alongside the feature that needs them. Do not add all future-chain fields during the portal foundation.

| Data | Purpose |
| --- | --- |
| `verifier_server_settings` | Admin/default verification channel IDs, background-check toggle, discovery visibility and edit timestamps/actor. Existing channel-specific rule mappings remain authoritative. |
| Web authentication sessions and one-time OAuth state | Revocable member/admin login, expiry and OAuth replay protection. Keep credentials server-side and store session-token hashes rather than raw browser tokens. |
| Rule revisions/admin-action records | Shared mutation audit and Undo/Redo snapshots with actor, server and concurrency/version checks. Preserve existing assignment audit history. |
| Reconciliation jobs | Durable scope, progress, retry and idempotency state for rule changes, wallet removals and explicit fixes. |
| Rule trait filters/operator | Canonical multi-trait conditions; backfill existing key/value rules, update cache criteria fingerprints and remove superseded storage after migration. |
| Wallet/network proof scope and new adapter criteria | Add only with the corresponding wallet/network integration. Preserve existing one-owner and address-normalization guarantees. |

Keep protected reads/writes behind authenticated backend endpoints with server/member scope and database access policies. Reuse existing ownership and metadata resources: this plan does not introduce a copied Ethscriptions metadata catalog or persist member inventories just to render portals.

## Decisions to settle before the affected implementation

1. Whether to adopt the guide's signature-free rechecks or retain Bouncer's fresh-proof policy; this plan defaults to the latter.
2. Whether to change previously-earned-role restoration or wallet-transfer policy; this plan preserves both existing behaviors.
3. The actual new EVM networks, marketplace resolver, non-EVM providers and tested wallet apps, including their production access/costs.

The admin and member portals have shipped. Use the [current implementation status](#current-implementation-status) to track remaining core work separately from optional features and deferred integrations.
