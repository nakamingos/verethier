# Bouncer portals

## First release: admin control room

Open `https://bouncer.up.railway.app/admin` and sign in with Discord. Only server owners and current administrators can manage a server. An OAuth server list is used for navigation; Bouncer fetches the actor's current membership and permissions again for each server operation.

The control room provides rules with asset filters and search, create/edit/delete forms, review before saving, Undo/Redo, bot settings, verification-message controls, member lookup and paginated activity. Rules keep today's asset capabilities and count-combining behavior. The existing `/setup` commands remain available. `/help` and `/join` are member-facing shortcuts; Discord may need a reload after commands refresh.

Edit opens beneath the selected rule, extending its card. Combined badges and the Rule group filter show the collectible rules sharing a channel, role and minimum. A group view includes all contributors across asset types and provides links to each rule. ERC-20 balances do not combine with collectible counts.

Cards keep equal heights, a reserved group-badge slot and actions aligned at the bottom. Changing button labels reserve their largest size. Notifications use a fixed, dismissible area with Undo/Redo. Server loading retains the current view, makes it inert, and replaces the server ID and data together only after a successful response; initial loads show static placeholders. Audit results scroll within a stable area so pagination stays in place. The primary font is preloaded to reduce text reflow.

Shared controls use solid two-pixel border bands in both themes: raised buttons with two short corner cuts and a lower ledge, recessed fields, shallow card frames, and tabs with stepped shoulders and flared active feet. Nine-slice SVG frames keep the corner steps fixed without changing control dimensions or clipping editors, suggestions or keyboard focus. Selects retain native menus and keyboard behavior, with a decorative pixel arrow. High-contrast mode uses system colors and plain borders.

The admin tabs join a shared workspace surface that spans the screen. The server menu and every tab's content sit inside it, with the menu remaining sticky on desktop. Content retains a readable maximum width; on mobile the tabs scroll in one row so the active tab stays connected to the surface. Initial loading uses the same outer layout.

Tab frames preserve the source sprites' asymmetric right edge and flared active feet. The dark palette uses direct PNG pixel samples: active face `#333333`, active rim `#575757`, inactive face `#202125`, inactive rim `#2f3136`, and black outlines. The original theme definitions provide the strip color `#2c2c30`, active text `#c0c0c0`, and inactive text `#7d7d7d`. These values are explicit, not calculated tints.

Border geometry is adapted from the [Aseprite Default Dark theme](https://github.com/aseprite/aseprite/tree/main/data/extensions/aseprite-theme/dark) by David Capello, Ilija Melentijevic and Nicolas Desilets, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Bouncer reconstructs the frames as SVG grids, recolors them to its themes, and adds card/editor variants; it does not bundle the source sprite sheet or icons.

Member Lookup accepts Discord IDs, usernames and server nicknames without case sensitivity. Suggestions show the username and ID to distinguish shared names. Only an exact, unique name or a selected member resolves; Bouncer confirms current server membership before exposing saved information. Direct ID lookup remains available if Discord member search is unavailable.

Member Lookup loads saved information first. Check Roles fetches current ownership. Fix queues reconciliation of previously earned roles only. Provider uncertainty retains roles. Background checks default to enabled; disabling them skips scheduled role checks for that server. Explicit verification, rule changes and requested repairs still reconcile earned roles. New qualifiers must verify.

Rule changes from both interfaces queue durable checks. A dashboard rule mutation, its revision and its check job commit together. Stale edits are rejected. Undo/Redo reverses the definition and evaluates current ownership, including alternative rules and saved wallets. Restoring a deleted rule preserves its ID. Undoing a new rule does not delete its Discord role.

The dashboard can also change a rule's role or create a missing role. The review shows the old and new roles. This explicit administrator action automatically checks previous holders of the old role against the changed rule's new channel/minimum group and grants the new role when eligible. Existing holders of the new role retain their alternative qualifying paths. The old role is checked against its remaining rules before removal. This does not grant roles to unrelated members. Undo/Redo uses fresh checks and the same audience; a created Discord role remains available after Undo.

Role-change jobs add `rule_id` and `member_ids` to the existing reconciliation table. The audience is captured in the same transaction as the edit and carried forward across rapid edits and reversals, including pending or interrupted moves. These columns contain the affected Discord IDs, not wallet metadata or collection inventories. They retain the table's backend-only access.

Role checks display pending/running/completed/failed states and results in Audit Log → Role checks. Interrupted jobs use leases; unavailable checks retry at five-minute intervals, up to three attempts. Failed jobs have a Retry check action. The bot never treats an unavailable provider as a zero balance.

## Deployment

The frontend remains a static Caddy site. Its `Caddyfile` forwards `/api/*` to the backend over HTTPS. Portal cookies stay on the frontend origin. Existing signed verification endpoints still work at the backend's public URL.

Backend configuration:

- `BASE_URL=https://bouncer.up.railway.app`
- Matching `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `DISCORD_BOT_TOKEN` from the Bouncer Discord application.
- Discord OAuth2 redirect: `https://bouncer.up.railway.app/api/portal/auth/callback`.
- Existing database service-role and verification provider settings.

Discord login uses `identify guilds`. Access tokens are discarded after login. The database stores one-time OAuth state hashes and opaque web-session hashes; secure, HttpOnly, SameSite cookies expire after eight hours. Mutations require the exact frontend Origin and a session-bound CSRF header. Protected data is never cached. New tables/functions allow backend service-role access only. Signed-in portal rate limits use the authenticated user ID; unauthenticated traffic retains conservative IP limits. Arbitrary forwarding headers are not trusted.

For development, proxy `/api` to a local backend through the frontend dev server and set `BASE_URL` to that frontend origin. Use a separate Discord redirect/client configuration for development.

Before the schema upgrade, create private roles/schema/data dumps and test restoring them. `backend/test/check-portal-migration.py BACKUP_DIRECTORY` restores the application data in a disposable database, checks that the migration preserves all values, and exercises transaction/replay/version/Undo/Redo/job/permission behavior. Production history predates the repository's migration files, so do not repair or erase that older history just to make `db push` proceed. Apply the tested new migration and record only its version in one guarded transaction.

## Following releases

The member portal follows the admin live review. It will list joined communities only, manage saved wallets with fresh ownership proofs, and reconcile earned roles after wallet removal. Public discovery, optional add-ons, additional networks and broader wallet/address support are deferred.

The guide's multi-trait AND/OR editor and expanded ERC-721 ID selections are separate rule-engine work. This admin milestone uses the existing, tested single-trait criteria and token-ID limits rather than advertising unsupported combinations.
