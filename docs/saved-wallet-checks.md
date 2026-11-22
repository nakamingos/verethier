# Saved-wallet checks

Members can check their saved wallets again without signing. The **Re-check saved wallets** button appears on the private **Verify Now** reply in Discord, after a member clicks Request Verification.

## How it looks

```
[ Verify Now ↗ ]  [ Re-check saved wallets ]

```

- The initial message shows buttons only. Clicking **Re-check saved wallets** replaces the Verify Now message with a short explanation and a wallet-family dropdown. It lists only families (EVM, Bitcoin, Solana) with an active saved wallet that a channel rule would read. No family is preselected.
- With one family, there is no dropdown. The button names the family, for example **Re-check EVM wallets**.
- When the button is shown, the message adds: "Already verified? Re-check your saved wallets without signing."
- With no saved wallets that apply, the reply looks the same as before: just Verify Now.
- Choosing a family starts its check immediately. Opening the picker does not start a check or consume the cooldown.
- Progress and results replace the original message; the old Verify Now link and expiry notice are removed. Results include a **Member Portal** link. To connect a new wallet, request verification again in Discord.
- Bitcoin and Solana result lists omit network labels already supplied by the heading. EVM chain names remain because a single EVM check can include several chains. Roles excluded by current role actions are omitted from Additional Roles Available.

## What a check does

A check works like a signed verification in the chosen family, except that nobody signs:

- **Rules:** it checks the same channel rules, limited to the same wallet family as Verify ([interactive wallet scope](verification-reliability.md#interactive-wallet-scope)). Ordinals and other Bitcoin lookups run only when the member picks Bitcoin.
- **Wallets:** it reads the member's saved wallets in that family.
  - Blocked wallets are skipped.
  - Wallets that are inactive for this community stay inactive. Waking an inactive wallet still needs a signature ([wallet checking](wallet-checking.md)).
- **Roles:**
  - It can grant new roles, not only restore earned ones.
  - It removes earned roles in that family that the saved wallets no longer support.
  - Role exclusions, privacy and deletion checks apply as usual.
  - Roles that also depend on another wallet family are left for the scheduled checks.
- **Empty wallets:** wallets checked empty are tracked for dormancy the same way as in an interactive verification.

Linking a new wallet or moving one from another account still needs a signature.

## Limits

- **Cooldown:** each member can check each family once per cooldown, per community. The cooldown is 5 minutes for EVM and Solana, and 15 minutes for Bitcoin because Ordinals lookups can use paid provider credits.
- **When it starts:** the cooldown starts when the check starts, so a failed or slow check can't be repeated straight away. A click during the cooldown gets a private "You can check again …" reply and makes no lookups.
- **Storage:** cooldowns are kept in memory, so a backend restart clears them.

## Activity and logs

- **Activity log:** role changes are recorded as Discord activity, the same as a signed verification in Discord.
- **Backend log:** `Saved-wallet check: user=…; family=…; …ms` records each check's duration.
- **Error messages:** provider errors aren't shown to members. They see "temporarily unavailable" instead.

## Code

- `backend/src/services/member-recheck.service.ts`: the controls, cooldown and check.
- `backend/src/services/utils/assign-verified-roles.util.ts`: role assignment shared with signed verification.
- `DiscordVerificationService.addUserRole` accepts the member's own check through `RoleSyncContext.memberRecheck`, which only the button handler sets.

No database migration or new environment variable is required.
