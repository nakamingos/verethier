# Deployed EVM smart wallets

Bouncer accepts EIP-712 signatures from ordinary key-based accounts and deployed contracts implementing [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271). Both Discord verification and member-portal wallet links use the same verifier. Supported proof networks are Ethereum (1), Base (8453), and Robinhood (4663).

The connected wallet selects the proof network. New community proofs sign the network and wallet address, Discord member/server, nonce, expiration, and privacy choices. Portal links sign their stored purpose/domain/member/address challenge on that network. Account/network changes during signing require another attempt. Existing Ethereum key signatures from already-open pages remain valid until their nonce expires.

A recovered EOA key proves the address across supported EVM networks. A contract proof is checked using the configured network RPC, deployed code and the exact `isValidSignature(bytes32,bytes)` magic return value. No transaction is submitted. Wrong-network RPCs, invalid/reverted responses and unavailable providers cannot save a link or consume the community nonce.

Contract links store `evm_chain_ids` on the existing wallet record. Repeated proofs by the same member add proven networks. A transfer replaces that scope; it never inherits the previous member's proofs. Existing key-based links retain a null scope. Individual role checks, combined counts, background checks and exports respect those networks. The member portal displays the proven networks and links to the corresponding explorer.

The existing one-Discord-account-per-address policy still applies, including matching addresses on multiple EVM chains. This release does not permit different members to hold separate links for the same hexadecimal address on different chains. Contract signatures are checked against current authorization when linking/verifying; saved links remain last-proven associations, like existing EOA links. Background holdings checks do not continuously re-check a contract's owner list. A changed controller must prove control to transfer the Bouncer association.

## Configuration and release

Use the existing backend `RPC_URL`, `BASE_RPC_URL`, and `ROBINHOOD_RPC_URL` settings. No additional credentials or frontend environment variable are needed. Providers must support `eth_chainId`, `eth_getCode`, and `eth_call` on the matching mainnet. No provider URLs come from member requests.

Apply `backend/supabase/migrations/20261028010000_smart_wallet_proofs.sql` before deploying the backend. This adds a nullable scope column and replaces the two wallet-link RPCs with backward-compatible default arguments. Existing wallet values remain unchanged. Rehearse on a private backup, then take a fresh backup before production application.

[ERC-6492](https://eips.ethereum.org/EIPS/eip-6492) wrapped/undeployed-account proofs are deliberately rejected. The Base Account connector remains disabled until that work is implemented and tested. Adding ERC-1271 does not imply support for every passkey account, Safe signing adapter or multisig approval flow; the wallet must provide an ERC-1271-compatible signature through a supported connector.

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

The local-only Solidity fixture verifies real owner signatures on chain IDs 1, 8453 and 4663. Checks cover unauthorized signers, altered messages, wrong chains and owner changes. Fixture private keys are public test keys and must never be funded or used outside the disposable local EVM.

Before advertising a particular wallet as tested, its owner should complete these live acceptance checks after release:

1. Connect a deployed smart wallet through its usual connector on the correct network and approve a portal link. Confirm its address and network label.
2. Verify through a Discord link in a community with a qualifying rule. Confirm holdings count for that smart-wallet address and the resulting role.
3. Repeat verification and test declining a request. Neither connecting nor declining should create a proof.
4. Confirm that proving an address only on Base cannot qualify that address for an Ethereum-only rule.
5. For a multisig, confirm that its own required approval threshold is satisfied before the wallet returns a valid signature.

These acceptance steps require the wallet owner's approval; automated fixtures cannot establish real-wallet/provider compatibility. No live acceptance is claimed by the local contract and mocked-browser tests.

Local validation on October 28, 2026: 1,522 backend tests (75 suites), 42 targeted frontend tests, production builds, deployed-contract checks on all three local chain IDs, migration rehearsal, desktop/mobile wallet smoke tests, and member/privacy portal smoke tests at 1280, 393 and 320 pixels passed. Production migration, deployment and real-wallet acceptance remain pending.
