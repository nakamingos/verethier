# EVM smart-wallet verification

Bouncer accepts EIP-712 signatures from ordinary key-based accounts, deployed contracts implementing [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271), and undeployed accounts returning [ERC-6492](https://eips.ethereum.org/EIPS/eip-6492) wrapped signatures. Both Discord verification and member-portal wallet links use the same verifier. Supported proof networks are Ethereum (1), Base (8453), and Robinhood (4663).

The connected wallet selects the proof network. New community proofs sign the network and wallet address, Discord member/server, nonce, expiration, and privacy choices. Portal links sign their stored purpose/domain/member/address challenge on that network. Account/network changes during signing require another attempt. Existing Ethereum key signatures from already-open pages remain valid until their nonce expires.

A recovered EOA key proves the address across supported EVM networks. A contract proof is checked using the configured network RPC and the exact `isValidSignature(bytes32,bytes)` magic return value. ERC-6492 wrappers are recognized before key recovery and must have a canonical ABI encoding. If the account is deployed, Bouncer first checks its current authorization using the inner signature. Otherwise, or if the deployed account needs preparation, the installed viem universal validator simulates deployment/preparation and signature validation together in a contract-creation `eth_call`. Only its exact successful result is accepted. Simulated changes disappear; Bouncer does not sign or broadcast a transaction, fund an account, or call the supplied factory through a signer.

Each accepted contract proof writes one backend log line naming the network and the check that passed: `deployed account (ERC-1271)`, the same with `inner signature of an ERC-6492 wrapper`, or `undeployed or unprepared account (ERC-6492 simulation)`. The line omits the address. Signatures are limited to 16 KiB. Simulation has a 10,000,000-gas ceiling; RPC requests time out after 10 seconds without automatic retries. Invalid wrappers are rejected before RPC access. Wrong-network RPCs, invalid/reverted responses and unavailable providers cannot save a link or consume the community nonce. The wrapper's inner signing key or factory address never becomes a globally proven wallet identity.

Contract links store `evm_chain_ids` on the existing wallet record, including undeployed accounts. Repeated proofs by the same member add proven networks. A transfer replaces that scope; it never inherits the previous member's proofs. Existing key-based links retain a null scope. Individual role checks, combined counts, background checks and exports respect those networks. The member portal displays the proven networks and links to the corresponding explorer.

The existing one-Discord-account-per-address policy still applies, including matching addresses on multiple EVM chains. Different members cannot hold separate links for the same hexadecimal address on different chains. Contract signatures are checked against current authorization when linking/verifying; saved links remain last-proven associations, like existing EOA links. Background holdings checks do not continuously re-check a contract's owner list. A changed controller must prove control to transfer the Bouncer association.

## Base Account

The wallet picker enables Base Account through the installed Wagmi connector and [Base Account SDK](https://docs.cdp.coinbase.com/coinbase-wallet/overview). Its first connection requests Base even when the general EVM picker initially displays Ethereum. Other connectors retain their existing network selection. When a Base Account is connected, the verify page shows a **Verify on** network chooser (Ethereum, Base, Robinhood) that asks the wallet to switch networks, and the member portal's **Add wallet** shows the same chooser as **Link on**. Base Account has no network control of its own, so this is how its member picks the proof network. On phones, AppKit lists Base Account under its shared Coinbase Wallet entry and connects it through the Coinbase Wallet SDK connector. Bouncer treats that connection as a Base Account when the SDK reports its smart-wallet signer (`scw`), so the chooser and the move to Base apply there too; the Coinbase Wallet app's own key (`walletlink`) is treated as an ordinary wallet. Links opened from Discord on Android open in a Custom Tab, where the Coinbase window may fail with "window.opener is inaccessible"; on phones the verify page tells EVM members to open the page in a normal browser tab if that happens. Ordinary key-based wallets don't see the chooser: their proof counts on every supported network. Other smart wallets choose the network in their own wallet app. AppKit also asks a newly connected wallet to move to its default network (Ethereum) when the wallet accepts network changes, so the page moves a newly connected Base Account back to Base, where Coinbase sponsors the one-time account setup. On other networks Coinbase may charge for that setup. A Base Account proof counts only for Base rules; in a channel with Ethereum and Base rules, the member verifies again on Ethereum to qualify for both, and the page says so. SDK telemetry is disabled for this connector. Restoring an approved session never signs a verification challenge automatically; each new proof still requires approval.

Supporting these standards does not imply compatibility with every passkey account, Safe signing adapter or multisig approval flow. The wallet must return an ERC-1271-compatible or ERC-6492 signature through a supported connector. Actual passkey prompts and wallet-specific approval thresholds require owner-assisted acceptance checks.

## Configuration and release

Use the existing backend `RPC_URL`, `BASE_RPC_URL`, and `ROBINHOOD_RPC_URL` settings. No additional credentials, dependencies or frontend environment variables are needed. Providers must support `eth_chainId`, `eth_getCode`, and `eth_call` on the matching mainnet. Undeployed proofs additionally require contract-creation `eth_call` support with enough simulation gas. Provider URLs do not come from member requests.

The production migration `20261028010000_smart_wallet_proofs` was applied on October 28, 2026 after a fresh private roles/schema/data backup and rehearsal of the exact guarded upgrade. All 360 existing wallet records retained their values, with the new scope column null; all 52 rules remained in place. The transaction verified RPC defaults and service-role-only execution, recorded the migration, and notified PostgREST to reload its schema.

For other environments, apply `backend/supabase/migrations/20261028010000_smart_wallet_proofs.sql` before deploying the backend. It adds a nullable scope column and replaces the two wallet-link RPCs with backward-compatible default arguments. Take a fresh backup and rehearse first. The undeployed-account/Base Account stage requires no additional migration.

## Verification

Run backend regression tests and frontend wallet/verification tests.

To check a deployment's RPC settings, pass its three values to the read-only probe (it ignores `backend/.env`). For each network it confirms the chain ID, `eth_getCode`, and a contract-creation `eth_call` of viem's universal validator at the 10,000,000-gas ceiling, using a fresh unfunded key. It signs no transaction:

```sh
cd backend
RPC_URL=... BASE_RPC_URL=... ROBINHOOD_RPC_URL=... REQUIRE_ALL=1 node test/check-smart-wallet-rpc.cjs
```

On November 15, 2026 the probe passed against the deployed production values for all three networks. Rehearse the migration using Docker and a private Supabase backup:

```sh
python3 backend/test/check-smart-wallet-migration.py /path/to/private/backup
# Optionally pass the private guarded rollout SQL as a second argument to rehearse it exactly.
```

For an actual local EVM test, install isolated tools (no project dependencies change), build the backend, then run:

```sh
npm install --prefix /tmp/bouncer-smart-test-tools --no-audit --no-fund --ignore-scripts solc@0.8.30 ganache@7.9.2
cd backend
npm run build
BOUNCER_SMART_TEST_TOOLS=/tmp/bouncer-smart-test-tools node test/check-smart-wallet-evm.cjs
```

The local-only Solidity fixture verifies real owner signatures on chain IDs 1, 8453 and 4663. Checks cover undeployed/deployed accounts, wrong factories and failed deployment, unauthorized signers, altered messages, wrong chains, preparation and owner changes. They assert that verification neither leaves a deployed contract behind nor changes the owner's transaction nonce, and that simulated preparation does not persist. An old predeployment wrapper must fail after an owner change. Fixture private keys are public test keys and must never be funded or used outside the disposable local EVM.

The frontend connector tests use the actual installed Base Account connector and SDK with a controlled injected provider. They cover Base-first connection, cancellation/retry, disconnect and unchanged wrapped signatures. Browser smoke tests exercise the picker and verification pages on desktop/mobile, including restored sessions. Verification API responses and wallet approval are mocked in these browser tests.

## Deferred live acceptance

Real-wallet checks, first deferred October 28, 2026, and completed in production on November 15–16, 2026 except where still open. Automated fixtures never mark a wallet as live-tested.

- [x] Confirm the deployed RPC settings match each supported chain and allow contract-creation `eth_call` with the configured simulation gas ceiling. November 15, 2026: `test/check-smart-wallet-rpc.cjs` passed for Ethereum, Base and Robinhood with the production values.
- [x] Connect a smart wallet through its usual connector on the correct network and approve a portal link. Confirm its address and network label. For Base Account, test a new, still-undeployed account as well as an already-deployed account. November 15, 2026: Base Account never signs while undeployed. Coinbase shows an "Upgrade your wallet" step and deploys the account on that network first, sponsored on Base and Robinhood and paid on Ethereum, so its proofs always reach Bouncer as deployed (ERC-1271). The portal shows the network labels correctly (Base, then Base and Robinhood). A member-portal link on November 16, 2026 saved the same address, labelled Base only, since the portal had no chooser and signed on Base. The portal now has the same **Link on** chooser for Base Account; on November 16, 2026 linking with Robinhood selected passed live and the wallet kept its Base and Robinhood labels.
- [x] Verify through a Discord link in a community with a qualifying rule. Confirm holdings count for that smart-wallet address and the resulting role. November 15, 2026: Base Account verified through Discord links on Base and Robinhood, but it held no assets; the roles granted came from the member's EOA. On November 16, 2026, with a qualifying Base asset held only in the Base Account and a temporary rule in a test channel, verifying on Base granted the role.
- [x] Repeat verification, restore the session, decline a request, then retry. Neither connecting nor declining should create a proof. November 15, 2026, Base Account in production: decline, retry and repeat verification passed, and the portal's last-verified time changed only on the approved signature. Restore failed: reloading the page opened the Coinbase sign-in popup again, and an extension wallet restored alongside it stayed active. Cause: `@wagmi/connectors` 6.2.0 sends `wallet_connect` when restoring, and the SDK always shows its popup for that. The Bouncer connector now restores from the saved session instead; the restore re-test passed in production on November 15, 2026, with no popup and the Base Account still active after a reload.
- [x] Confirm that proving an address only on Base cannot qualify that address for an Ethereum-only rule. November 15, 2026: the portal lists the Base Account as Base only. Roles still come from all of a member's saved wallets proven on each rule's network, so a member's unrestricted EOA can qualify them for Ethereum rules. A full live test would need an Ethereum asset in the Base Account, which would need the paid Ethereum setup to move it back out, so it was skipped; role checks are covered by backend tests.
- [ ] For a multisig, confirm that its own required approval threshold is satisfied before the wallet returns a valid signature.
- [ ] Deferred November 16, 2026: move the test NFT back out of the Base Account and confirm the next background check removes the role. Afterwards, delete the temporary rule and test channel.
- [x] Check desktop/mobile passkey prompts for Base Account. November 16, 2026, Android: the first attempt from Discord's Custom Tab showed Coinbase's "window.opener is inaccessible" error; a later attempt there connected, and a normal Brave tab connected. Both connected through the Coinbase Wallet connector and stayed on Ethereum without a chooser. Fixed in #150 to recognise that connection as a Base Account. After that, on November 16, 2026, a fresh attempt from Discord's Android Custom Tab connected on the first try through the Coinbase Wallet entry, showed the **Verify on** chooser with Base selected, and signed. Desktop passkey prompts passed in the earlier Base Account checks.
- [x] After the viem 2.31 → 2.57 upgrade (PR #130, November 14, 2026), verify one deployed smart wallet (ERC-1271) and one undeployed account (ERC-6492) end to end. Signature checks for both run through viem; ordinary EVM wallets were checked against the compiled build and passed live verification in production on November 15, 2026. On November 15, 2026 a new Base Account verified on Base in production, after Coinbase's sponsored "Upgrade your wallet on Base" step. With the acceptance log added in PR #144, the same account verified again in production on November 16, 2026 (UTC): `chain 8453: deployed account (ERC-1271)` on Base, and `chain 4663: deployed account (ERC-1271)` on Robinhood after Coinbase's sponsored Robinhood setup. The portal then listed Base and Robinhood but not Ethereum. The undeployed (ERC-6492) path can't be reached live with Base Account, which deploys before signing; it stays covered by the local EVM fixture (`test/check-smart-wallet-evm.cjs`) and unit tests. Re-test it live if a wallet that returns ERC-6492 signatures becomes available.

- [x] EIP-7702 delegated EOA (MetaMask smart account) — November 15, 2026: verified once in production and received roles for both Ethereum and Base rules, as a key proof with no network restriction.

Results above come from real wallets in production; the local contract and mocked-browser tests are not counted as live acceptance.
