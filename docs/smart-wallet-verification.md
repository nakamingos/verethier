# EVM smart-wallet verification

Bouncer accepts EIP-712 signatures from ordinary key-based accounts, deployed contracts implementing [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271), and undeployed accounts returning [ERC-6492](https://eips.ethereum.org/EIPS/eip-6492) wrapped signatures. Both Discord verification and member-portal wallet links use the same verifier. Supported proof networks are Ethereum (1), Base (8453), and Robinhood (4663).

The connected wallet selects the proof network. New community proofs sign the network and wallet address, Discord member/server, nonce, expiration, and privacy choices. Portal links sign their stored purpose/domain/member/address challenge on that network. Account/network changes during signing require another attempt. Existing Ethereum key signatures from already-open pages remain valid until their nonce expires.

A recovered EOA key proves the address across supported EVM networks. A contract proof is checked using the configured network RPC and the exact `isValidSignature(bytes32,bytes)` magic return value. ERC-6492 wrappers are recognized before key recovery and must have a canonical ABI encoding. If the account is deployed, Bouncer first checks its current authorization using the inner signature. Otherwise, or if the deployed account needs preparation, the installed viem universal validator simulates deployment/preparation and signature validation together in a contract-creation `eth_call`. Only its exact successful result is accepted. Simulated changes disappear; Bouncer does not sign or broadcast a transaction, fund an account, or call the supplied factory through a signer.

Signatures are limited to 16 KiB. Simulation has a 10,000,000-gas ceiling; RPC requests time out after 10 seconds without automatic retries. Invalid wrappers are rejected before RPC access. Wrong-network RPCs, invalid/reverted responses and unavailable providers cannot save a link or consume the community nonce. The wrapper's inner signing key or factory address never becomes a globally proven wallet identity.

Contract links store `evm_chain_ids` on the existing wallet record, including undeployed accounts. Repeated proofs by the same member add proven networks. A transfer replaces that scope; it never inherits the previous member's proofs. Existing key-based links retain a null scope. Individual role checks, combined counts, background checks and exports respect those networks. The member portal displays the proven networks and links to the corresponding explorer.

The existing one-Discord-account-per-address policy still applies, including matching addresses on multiple EVM chains. Different members cannot hold separate links for the same hexadecimal address on different chains. Contract signatures are checked against current authorization when linking/verifying; saved links remain last-proven associations, like existing EOA links. Background holdings checks do not continuously re-check a contract's owner list. A changed controller must prove control to transfer the Bouncer association.

## Base Account

The wallet picker enables Base Account through the installed Wagmi connector and [Base Account SDK](https://docs.cdp.coinbase.com/coinbase-wallet/overview). Its first connection requests Base even when the general EVM picker initially displays Ethereum. Other connectors retain their existing network selection. SDK telemetry is disabled for this connector. Restoring an approved session never signs a verification challenge automatically; each new proof still requires approval.

Supporting these standards does not imply compatibility with every passkey account, Safe signing adapter or multisig approval flow. The wallet must return an ERC-1271-compatible or ERC-6492 signature through a supported connector. Actual passkey prompts and wallet-specific approval thresholds require owner-assisted acceptance checks.

## Configuration and release

Use the existing backend `RPC_URL`, `BASE_RPC_URL`, and `ROBINHOOD_RPC_URL` settings. No additional credentials, dependencies or frontend environment variables are needed. Providers must support `eth_chainId`, `eth_getCode`, and `eth_call` on the matching mainnet. Undeployed proofs additionally require contract-creation `eth_call` support with enough simulation gas. Provider URLs do not come from member requests.

Apply `backend/supabase/migrations/20261028010000_smart_wallet_proofs.sql` before deploying the backend. This adds a nullable scope column and replaces the two wallet-link RPCs with backward-compatible default arguments. Existing wallet values remain unchanged. The migration has been rehearsed on a private backup; take a fresh backup before production application. The undeployed-account/Base Account stage requires no further migration beyond that pending smart-wallet migration.

## Verification

Run backend regression tests and frontend wallet/verification tests. Rehearse the migration using Docker and a private Supabase backup:

```sh
python3 backend/test/check-smart-wallet-migration.py /path/to/private/backup
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

Before advertising a particular wallet as tested, its owner should complete these live acceptance checks after release:

1. Connect a smart wallet through its usual connector on the correct network and approve a portal link. Confirm its address and network label. For Base Account, test a new, still-undeployed account as well as an already-deployed account.
2. Verify through a Discord link in a community with a qualifying rule. Confirm holdings count for that smart-wallet address and the resulting role.
3. Repeat verification, restore the session, decline a request, then retry. Neither connecting nor declining should create a proof.
4. Confirm that proving an address only on Base cannot qualify that address for an Ethereum-only rule.
5. For a multisig, confirm that its own required approval threshold is satisfied before the wallet returns a valid signature. Check desktop/mobile passkey prompts for Base Account.

These acceptance steps require the wallet owner's approval; automated fixtures cannot establish real-wallet/provider compatibility. No live acceptance is claimed by the local contract and mocked-browser tests.

Local validation on October 28, 2026: 1,534 backend tests (75 suites), 45 targeted frontend tests, production builds, deployed/undeployed contract checks on all three local chain IDs, all 11 wallet browser scenarios, and member-portal smoke tests at 1280, 393 and 320 pixels passed. The prior deployed-account stage also passed migration rehearsal and privacy-portal smoke tests. Production RPC capability checks, migration, deployment and real-wallet acceptance remain pending; local RPC settings were placeholders, so the contract-creation capability probe was skipped.
