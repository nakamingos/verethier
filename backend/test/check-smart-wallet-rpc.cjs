// Explicit, read-only probe of the smart-wallet RPC settings. Uses a few RPC
// requests per network; signs nothing on chain, sends no transaction.
// Run from backend/ with the deployed RPC settings in the environment:
//   RPC_URL=... BASE_RPC_URL=... ROBINHOOD_RPC_URL=... node test/check-smart-wallet-rpc.cjs
// It deliberately ignores backend/.env, so only the values you pass are tested.
// Unset networks are reported, not failed, unless REQUIRE_ALL=1.
const { createPublicClient, encodeDeployData, hashMessage, http, universalSignatureValidatorAbi, universalSignatureValidatorByteCode } = require('viem');
const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts');
const { base, mainnet } = require('viem/chains');

const networks = [
  { name: 'Ethereum', variable: 'RPC_URL', chain: mainnet },
  { name: 'Base', variable: 'BASE_RPC_URL', chain: base },
  { name: 'Robinhood', variable: 'ROBINHOOD_RPC_URL', chain: { id: 4663, name: 'Robinhood', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [] } } } },
];
// A fresh throwaway key each run: well-known test keys often carry EIP-7702
// sweeper delegations. The validator falls back to ecrecover for an address
// with no code, so this runs the same contract-creation eth_call and gas
// ceiling as an undeployed (ERC-6492) proof.
const signer = privateKeyToAccount(generatePrivateKey());

async function probe({ name, variable, chain }) {
  const url = process.env[variable];
  if (!url) return { name, status: 'unset', detail: `${variable} is not set` };
  const client = createPublicClient({ chain, transport: http(url, { timeout: 10000, retryCount: 0 }) });
  const chainId = await client.getChainId();
  if (chainId !== chain.id) return { name, status: 'fail', detail: `${variable} reports chain ${chainId}, expected ${chain.id}` };
  const code = await client.getCode({ address: signer.address, blockTag: 'latest' });
  if (code && code !== '0x') return { name, status: 'fail', detail: 'probe address unexpectedly has code' };
  const message = `Bouncer RPC probe ${chain.id}`;
  const hash = hashMessage(message);
  const signature = await signer.signMessage({ message });
  const result = await client.call({
    data: encodeDeployData({
      abi: universalSignatureValidatorAbi,
      bytecode: universalSignatureValidatorByteCode,
      args: [signer.address, hash, signature],
    }),
    blockTag: 'latest',
    gas: 10_000_000n,
  });
  if (result.data !== '0x01') return { name, status: 'fail', detail: `validator returned ${result.data ?? 'nothing'}` };
  return { name, status: 'pass', detail: 'chain ID, getCode and contract-creation eth_call at 10,000,000 gas' };
}

async function main() {
  let failed = false;
  for (const network of networks) {
    let outcome;
    try { outcome = await probe(network); }
    // Report the error class and message only; provider URLs can contain keys.
    catch (error) { outcome = { name: network.name, status: 'fail', detail: `${error.name}: ${error.shortMessage ?? error.message}`.replace(/https?:\/\/\S+/g, '<rpc url>') }; }
    if (outcome.status === 'fail' || (outcome.status === 'unset' && process.env.REQUIRE_ALL === '1')) failed = true;
    console.log(`${outcome.status.toUpperCase()}: ${outcome.name} — ${outcome.detail}`);
  }
  process.exitCode = failed ? 1 : 0;
}

main();
