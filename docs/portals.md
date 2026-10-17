# Bouncer portals

## First release: admin control room

Open `https://bouncer.up.railway.app/admin` and sign in with Discord. Only server owners and current administrators can manage a server. An OAuth server list is used for navigation; Bouncer fetches the actor's current membership and permissions again for each server operation.

The control room provides rules with asset filters and search, create/edit/delete forms, review before saving, Undo/Redo, bot settings, verification-message controls, member lookup and paginated activity. Rules keep today's asset capabilities and count-combining behavior. The existing `/setup` commands remain available. `/help` and `/join` are member-facing shortcuts; Discord may need a reload after commands refresh.

Member Lookup loads saved information first. Check Roles fetches current ownership. Fix queues reconciliation of previously earned roles only. Provider uncertainty retains roles. Background checks default to enabled; disabling them skips scheduled role checks for that server. Explicit verification, rule changes and requested repairs still reconcile earned roles. New qualifiers must verify.

Rule changes from both interfaces queue durable checks. A dashboard rule mutation, its revision and its check job commit together. Stale edits are rejected. Undo/Redo reverses the definition and evaluates current ownership, including alternative rules and saved wallets. Restoring a deleted rule preserves its ID. Undoing a new rule does not delete its Discord role.

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
