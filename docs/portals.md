# Bouncer portals

Bouncer's web app has two Discord-authenticated portals: the **Control Room** for server owners and administrators (`/admin`), and the **member portal** (`/member`). Visual styling is documented separately in [portal styling](portal-styling.md).

## Control Room

Open `https://bouncer.up.railway.app/admin` and sign in with Discord. Only server owners and current administrators can manage a server. An OAuth server list is used for navigation; Bouncer fetches the actor's current membership and permissions again for each server operation.

Discord sign-in and sign-out share the header on Control Room and Help. They use a shared session and CSRF-protected logout; a failed logout keeps the account signed in. The heading reads “[Server name] Control Room”, followed by the rule count.

The Control Room provides rules with asset filters and search, create/edit/duplicate/delete forms, review before saving, Undo/Redo, role actions, bot settings (background checks, activity feed, privacy and exports), verification-message controls, member lookup with repairs and wallet blocks, paginated activity and, for Bouncer Operators, bulk role checks. Rules keep today's asset capabilities and count-combining behavior. The existing `/setup` commands remain available. `/help` and `/join` are member-facing shortcuts; Discord may need a reload after commands refresh.

Audit Log opens immediately without dimming the tabs or showing a loading indicator. Refreshes keep the current entries until fresh data arrives, and navigating away cancels the pending read.

Edit opens beneath the selected rule; its Edit button becomes Cancel and discards unsaved changes. Combined badges and the Rule group filter show collectible rules sharing a channel, role and minimum. A group view includes all contributors across asset types and links to each rule. ERC-20 balances do not combine with collectible counts.

Add rule toggles the creation form without discarding its choices or review state. Drafts are retained separately for each server within the current control-room session, including navigation between tabs and servers. Cancel discards a draft; saving creates the rule and clears it. Review changes appears to the right of Cancel. New rules default to Ethscriptions; asset menus list Ethscriptions, Ordinals, Bitcoin Stamps, NFTs, Tokens (ERC-20) and, when Solana is enabled, Solana NFTs and Solana tokens, with All assets retained for filtering. Saving a new or duplicated rule posts a verification message in its channel if there isn't one.

Servers with Bouncer installed appear first. Both installed and invite groups sort by name without case sensitivity and with numeric ordering (2 before 10).

### Member lookup

Member Lookup accepts Discord IDs, usernames and server nicknames without case sensitivity. Suggestions show the username and ID to distinguish shared names. Only an exact, unique name or a selected member resolves; Bouncer confirms current server membership before exposing saved information. Direct ID lookup remains available if Discord member search is unavailable.

The same field accepts a full EVM, Bitcoin or Solana wallet address. Exact address matches include current saved links and retained link/verification/removal/transfer history, with current and historical matches labeled separately. Every matching account must still be a live member of the selected server; unrelated or former members' identities are not returned by lookup. Multiple matches require an explicit member choice, including when submitting before autocomplete finishes. Incomplete addresses are not prefix searches, Bitcoin checksums and original letter casing are validated before normalization, and reads start no ownership scans. Associations predating retained wallet history may be missing.

Member Lookup loads saved information first. Check Roles fetches current ownership. Fix queues reconciliation of previously earned roles only. Provider uncertainty retains roles. Background checks default to enabled; disabling them skips scheduled role checks for that server. Explicit verification, rule changes and requested repairs still reconcile earned roles. New qualifiers must verify.

Member Lookup separates current saved wallets from removed/transferred wallets. Both tables show Last proven and link the shortened address to Etherscan or the Bitcoin explorer; the full address remains in its tooltip. Removed rows include the removal/transfer time. Re-added addresses appear only in the current table. Removal retains the wallet's proof timestamp before deleting the active link. Older removals without a retained proof date show Unknown. Admin authorization and current target membership are checked before returning either table; removed wallets never contribute to eligibility.

Both wallet tables show the address's block status in the selected server and offer Block/Unblock. A review displays the full address, server and optional reason before confirmation. The restriction, audit receipt and durable earned-role checks commit together. Checks target the address's current linked account, including when a historical address has transferred, without exposing that account's identity. Saved links remain intact; other eligible wallets still qualify, other servers are unaffected, and unblocking does not grant new roles. Retrying the same request creates no duplicate work or reapplies a superseded restriction. Wallet restrictions appear in Audit Log → Changes; use Unblock or Block rather than rule Undo/Redo to change them.

Member Lookup also offers **Audit member** and **Audit all members** for shared-wallet history. Reports match exact addresses across saved links and retained wallet activity, deduplicate repeated events for the same account, and show first/last recorded dates, last proof and current-link state. Current Discord members and former members with saved server-specific records are included; identities with no membership or saved history in this server are excluded. Wallet and account results both paginate. Audits read saved evidence and start no ownership scans or moderation actions. The displayed history start makes incomplete older transfer history explicit. Discord must allow Bouncer to list server members (Server Members access in the application settings); enumeration failures return an error rather than a partial clean report.

### Role actions and role checks

Rules → **Role actions** configures “when Bouncer grants or restores this role, remove these roles.” The editor opens above saved actions. **Remove roles** uses the same checkbox dropdown as rule output roles: select or uncheck several targets without closing the menu, up to 20; changing the trigger removes it from the target selection. A review previews the server, trigger and selected removals, including application to previously tracked holders. Each server/trigger pair has one action with up to 20 target roles; roles must be manageable, self-removal and cycles are rejected, and stale edits conflict. Bouncer suppresses grants/restoration of target roles while a trigger is held. These actions respond to Bouncer grants/restorations, rather than general Discord role events. Targets can include roles Bouncer did not originally assign. Removing the trigger does not restore arbitrary roles; ordinary checks can restore eligible previously earned roles once the exclusion ends.

Role-action settings and their checks appear in Audit Log. Grant tracking durably queues removal work in the existing reconciliation queue, with permission failures retried and failed jobs available for Retry check. Removing a policy cancels pending removals under it and queues earned-role checks. A newer policy change keeps a separate receipt/job even when a prior grant job is pending.

Rule changes from both interfaces queue durable checks. A dashboard rule mutation, its revision and its check job commit together. Stale edits are rejected. Undo/Redo reverses the definition and evaluates current ownership, including alternative rules and saved wallets. Restoring a deleted rule preserves its ID. Undoing a new rule does not delete its Discord role.

The dashboard can also change a rule's role or create a missing role. The review shows the old and new roles. This explicit administrator action automatically checks previous holders of the old role against the changed rule's new channel/minimum group and grants the new role when eligible. Existing holders of the new role retain their alternative qualifying paths. The old role is checked against its remaining rules before removal. This does not grant roles to unrelated members. Undo/Redo uses fresh checks and the same audience; a created Discord role remains available after Undo.

Role-change jobs add `rule_id` and `member_ids` to the existing reconciliation table. The audience is captured in the same transaction as the edit and carried forward across rapid edits and reversals, including pending or interrupted moves. These columns contain the affected Discord IDs, not wallet metadata or collection inventories. They retain the table's backend-only access.

Role checks display pending/running/completed/failed states and results in Audit Log → Role checks. Interrupted jobs use leases; unavailable checks retry at five-minute intervals, up to three attempts. Failed jobs have a Retry check action. The bot never treats an unavailable provider as a zero balance.

Rules sort numerically by rule ID in either direction, including combined-group views. Activity sorts by date (newest first by default), with an ID tie-breaker, before server-side pagination; Last jumps directly to the final page.

### Rule editor

The rule editor supports up to ten trait conditions on NFT, Ordinals and Ethscriptions collection rules. Choose AND to require every condition on the same collectible, or OR to accept any condition. Matching is case-insensitive; `ALL` as a value accepts any value for that key. Remove all conditions for quantity-only rules. OR counts an asset once, and ERC-1155 matching copies retain their quantities. Conditions do not combine across different assets. Nested groups are not supported.

NFT and ERC-20 rules offer Ethereum, Base and Robinhood. The selected chain also scopes trait suggestions and export contribution checks; members see the matching chain label. The Include role and Exclude role export menus retain all available server roles; ordinary roles use live Discord membership, while Bouncer-managed requirements receive fresh holdings checks.

The editor retains conditions when Add rule collapses a draft. Review/Save, edit, Undo/Redo and duplicate detection use the full predicate. Discord add commands keep their existing single-trait options; multi-trait rules display every condition, and the simple Discord edit modal directs administrators to the Control Room instead of truncating the rule. ERC-721 and ERC-1155 both support bounded token ID lists/ranges and quantity thresholds.

NFT collection rules accept comma-separated IDs, inclusive ranges, or mixed selections such as `1,5,20-30`. The existing parser sorts IDs numerically, removes duplicates/overlaps and preserves full uint256 precision. A selection is bounded to 1,000 unique IDs. Blank selection means any ERC-721 token; for ERC-1155 it retains the existing IDs 0–99 default.

An ERC-721 selection counts every matching token held across the member’s saved wallets, once per token. Ownership reads use batches of at most 100 at the same block; trait conditions filter the owned tokens before counting. Burned/unminted IDs count as zero. A transport/provider failure makes the check unavailable instead of confirming a partial count or removing an existing role from incomplete evidence. Selected-ID checks do not require an ownership indexer. Overlapping rules for the same contract still deduplicate token identities when counts combine.

Portal and slash create/edit flows share validation, and Undo/Redo retains the complete selection and minimum. Minimums may exceed an individual selection’s size because other rules with the same role, channel and minimum can contribute to the combined total. Existing single-ID/minimum-one rules retain their behavior.

#### Ordinals number selections within an ord.net collection

For an Ordinals number/range rule, **ord.net collection slug (optional)** can be set during creation, editing or duplication. In the slash command, supply `slug` alongside `inscription_numbers`. Only selected numbers belonging to that collection count. The optional scope is stored in `inscription_criteria.collection_slug`; top-level `slug` remains null for specific selections. Blank scope keeps the existing wallet-number provider path. It is not supported on Ethscription or explicit-ID rules.

A scoped check reads every page of the live ord.net collection and matches each selected inscription's reported owner against the member's proven wallets. It does not depend on Xverse/Ordiscan wallet inventory availability or the global collection-provider preference. Collection scans are shared within the ownership context; a new context reads fresh owners. The persistent six-hour metadata catalog never supplies ownership for this path. Missing numbers, ambiguous owners among matching inscriptions, inconsistent pages and API failures remain unavailable. Combined groups deduplicate by inscription ID; a small selection can still contribute toward a larger shared minimum. Exports use the same fresh matching-ID path.

When adding an NFT rule, an optional [collection lookup](nft-collection-lookup.md) resolves an OpenSea collection URL/slug into existing contract/network and token-ID fields. Admins review one contract at a time and explicitly choose a fixed collection token list or an entire ERC-721 contract. ERC-1155 lookup requires the complete bounded token selection. The usual change review, on-chain contract validation and save path remain authoritative. The optional backend `OPENSEA_API_KEY` is required for lookup; manual contract entry and saved-rule checks do not depend on it.

### Browser navigation and unsaved drafts

Control Room URLs identify the selected server and tab, for example `/admin?server=123456789012345678&tab=rules`. Server/tab clicks add history entries, while initial defaults and invalid parameters are normalized with replacement. Back/Forward retraces portal sections without creating extra normalization entries. Clicking an already selected Audit Log tab still refreshes it without adding a duplicate history entry. Navigation carries no member searches, wallet addresses, verification tokens, rule inputs or mutation requests in the URL.

Pending navigation is applied after a busy operation settles, and a newer Back/Forward target takes priority over an older server read. Server identity and data change together after a successful authorized read. Returning from Help reloads the server through the same access checks; draft contents are not displayed if access is denied. Navigating does not replay Save, Delete, ownership proofs, exports or other portal mutations. Verification URLs still perform their existing context lookup.

New, edited and duplicate rule drafts are retained in memory by signed-in account, server, rule and operation. They survive tab/server navigation and visits to other routes in the running app, including Help. Cancel discards the current draft, Save consumes it after success, and manually collapsing Add rule preserves its draft without reopening it automatically on a tab change. Restored edits keep their original version guard; another administrator's change still requires reloading before saving. Native rule-form autocomplete/restoration is disabled so browser history does not replace the controlled draft values. Drafts are not stored in localStorage or sessionStorage, and are cleared on sign-out, session invalidation, account change, a full page reload or closing the app.

An inactive verification link shows an informational card with Control Room and Member Portal links and instructions to request a new link in Discord. It does not automatically redirect, reconnect a wallet, sign a message or claim a verification succeeded. Rate limits and network/server failures retain retry guidance. Navigating to another verification token can resolve a fresh context after an earlier link failed.

## Installation and Check Setup

After using a server's invite link, return to the portal and use **Refresh servers** to select the newly installed bot. A server without rules opens Bot Settings with Channel setup first.

**Channel setup** can select existing text channels or create a private admin channel and a member verification channel. New admin channels deny ordinary members access; server administrators and Bouncer can view them. New verification channels allow members to view/read while disabling ordinary member message posting. Existing channels retain their permissions. Creating channels requires Manage Channels plus Bouncer's message permissions; selecting existing channels does not require Manage Channels. The review shows names, permission choices, the new default verification channel and any messages to post before **Confirm setup**. It never moves existing rules between channels. The admin channel's Control Room link still requires Discord login and current owner/Administrator authorization.

Setup previews expire after ten minutes if not started. Confirmation checks live admin permissions before each Discord mutation, records progress privately, and serializes setup within a server. A lost response can be resolved from the saved receipt; partial setup can be continued after reload by its original actor. Created channels are recovered by saved ID or their setup topic marker. If a Discord creation/post has an uncertain result, retries first search for its resource and do not blindly send another create request. **New review** leaves any created channels available for explicit selection. Channel settings changed by another admin cause a conflict; background-check settings are preserved. Completed setup and recovery appear in Audit Log → Changes without rule Undo/Redo actions.

**Check setup** runs only when requested. It refreshes the bot member, roles and channels, checks role hierarchy/manageability and channel permissions, then checks verification messages and the providers used by current rules. Results include affected rule IDs and actionable fixes. Message searches cover recent history, pinned messages and up to 1,000 messages per channel. A failed/incomplete search is unavailable, not evidence of a missing message; pin an older verification message and retry. Missing-message results offer **Review recovery**, which checks again before confirmation and reuses a message that has appeared meanwhile. The verification-message form's **Recover missing** action uses the same reviewed, durable path. Setup checks never change member roles or scan member wallet inventories.

Provider results distinguish reachable, unavailable and not checked. RPC probes verify network identity and a latest-block read; data/metadata/collection probes check a bounded read rather than complete eligibility. Ordinals number inventories require a member **Check Roles** and are explicitly not checked by setup. Collection connectivity does not guarantee wallet-inventory or individual-token availability. Provider failures retain the existing eligibility engine's unavailable behavior.

Administrators also get a **Check Setup** button from Discord `/help`. The button validates current owner/Administrator permissions on every click and returns an ephemeral summary, with the full report and reviewed repairs in the portal. Existing `/setup` commands remain available.

Discord references: [channel creation permissions](https://docs.discord.com/developers/resources/guild#create-guild-channel) and [message nonces](https://docs.discord.com/developers/resources/message#create-message).

## Member portal

Open `/member` from the footer or Help. Discord sign-in returns members to their account, with **Overview**, **Wallets**, and **Communities**. Counts and previously earned roles come from saved records; opening the dashboard never starts ownership scans. Communities lists joined servers with Bouncer, rechecks live membership, and shows rules only for channels the member can view. A temporarily unavailable community does not prevent wallet management. Sign in again after joining another server to refresh Discord's server list.

Wallets supports copy/view, adding EVM (including Base Account, with a **Link on** network chooser), Bitcoin (Xverse/UniSat; Taproot, plus payment addresses where Stamps apply) or Solana (Phantom) wallets through the same connection and signing services as verification, **Disconnect wallet**, and **Remove wallet from Bouncer**. Linking requires a fresh, ten-minute account-bound proof with a distinct wallet-link purpose. EVM messages also bind the frontend origin and exact address. Linking does not award community roles or bypass server wallet blocks. If a wallet belongs to another account, its fresh proof must be followed by explicit transfer confirmation; previous-account role checks are queued without exposing that account's identity or communities.

Removal previews communities with previously earned roles. The wallet deletion, activity record and per-community reconciliation jobs commit in one transaction. Other wallets remain linked. The existing previously-earned-only engine checks all remaining qualifying paths, preserves roles on provider uncertainty, and retries failed changes. Wallet activity shows durable progress with Refresh; members cannot manually retry background role checks, and the member job-retry endpoint is removed. Existing Control Room retry controls remain available to authorized admins. Repeating a removal request does not enqueue duplicate work. Closing a wallet app is separate from deleting its saved Bouncer link.

Communities uses the configured default verification channel, or asks the member to choose. Verify opens the existing personal verification page and checks only that channel for new roles; earned-role reconciliation retains its existing broader alternative-rule checks. Wallet proofs are consumed before changing a wallet link, so concurrent submissions cannot replay a proof. Existing direct Discord links and approved EVM connections continue working.

Each community has a Show roles switch for Available roles and Earned roles. Earned means the account has an active saved assignment; Available includes configured roles without an active saved assignment, marking past earnings separately. Results stay scoped to the selected visible channel, with requirements grouped by role ID and channel so shared names and combined rules remain distinct. Switching views/channels reads the loaded summaries and starts no ownership scans.

Wallet activity records links, transfers, removals, and successful manual verification from both Discord and the portal. Entries show the entry point and visible community/channel where applicable. Repeated proofs of an already-linked wallet do not create extra Linked entries; successful role verification gets its own Verified entry. Proof-valid links remain recorded even if eligibility fails. Transfers appear in the previous account's history without exposing the destination identity or community. Automatic background role checks remain in the role audit log.

One pending account flow is saved on the backend. Continue rechecks identity/context and expiry; an invalid challenge is replaced with a fresh one. A completed verification marks only its matching pending flow complete. Not now hides the banner for the current visit and leaves the flow available after a reload. Wallet signatures are never persisted in the browser or database.

### Community-specific wallet disclosure

Member wallets remain account-wide. **Wallet view** defaults to **All wallets**, without combining dormancy warnings from several communities. Selecting a community shows applicable and already associated saved wallets, its paused networks and per-wallet sharing controls. Existing associations remain manageable when rules change. Sharing changes neither ownership nor private eligibility. Existing Copy/View/Remove actions retain their account-wide meanings.

Ordinary admin lookup, wallet search, reuse audits, wallet activity notices and exports now additionally require the selected community's enabled wallet association. Existing community privacy and export choices remain additional gates. Operator reads and explicit export overrides retain their audited access. Existing visibility for the two communities at release is preserved until each wallet is reverified, without extending to future wallets or communities. See [community wallet visibility](plans/community-wallet-visibility.md).

## Deployment and sign-in

The frontend remains a static Caddy site. Its `Caddyfile` forwards `/api/*` to the backend over HTTPS. Portal cookies stay on the frontend origin. Existing signed verification endpoints still work at the backend's public URL.

Backend configuration:

- `BASE_URL=https://bouncer.up.railway.app`
- Matching `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `DISCORD_BOT_TOKEN` from the Bouncer Discord application.
- Discord OAuth2 redirect: `https://bouncer.up.railway.app/api/portal/auth/callback`.
- Existing database service-role and verification provider settings.

Discord login uses `identify guilds`. Access tokens are discarded after login. The database stores one-time OAuth state hashes and opaque web-session hashes; secure, HttpOnly, SameSite cookies expire after eight hours. Mutations require the exact frontend Origin and a session-bound CSRF header. Protected data is never cached. New tables/functions allow backend service-role access only. Signed-in portal rate limits use the authenticated user ID; unauthenticated traffic retains conservative IP limits. Arbitrary forwarding headers are not trusted.

For development, proxy `/api` to a local backend through the frontend dev server and set `BASE_URL` to that frontend origin. Use a separate Discord redirect/client configuration for development.

## History

Multi-trait rules store a canonical `trait_filter`; the old single-trait `attribute_key`/`attribute_value` columns were removed in October 2026. Simple Discord options still work through input translation, and old audit JSON can still be restored through Undo.

At that cleanup, compatible existing rules were consolidated into ten OR rules (74 rules became 52), keeping the lowest rule ID in each group. Each original definition is kept in the admin-action audit table as a nonreversible `merge` record, shown in the Audit Log as “Merged rule … into …”. Assignment and pending-job pointers moved to the retained rule, and affected roles were rechecked. `backend/scripts/plan-rule-consolidation.cjs RULES_JSON PRIVATE_OUTPUT_DIRECTORY` generates such a plan offline for review.

Optional ideas are tracked in the [optional feature backlog](plans/optional-features.md).
