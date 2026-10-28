import { Injectable } from '@nestjs/common';
import { Address, PublicClient, createPublicClient, http, parseAbi } from 'viem';
import { EnvironmentConfig } from '@/config/environment.config';
import { NftRuleFields } from '@/models/verifier-role.interface';
import { getNftNetwork } from '@/utils/nft-network.util';
import { NFT_BATCH_SIZE } from '@/utils/nft-rule.util';
import { parseTokenBalance, tokenMinimum, UINT256_MAX } from '@/utils/erc20-rule.util';
import { NftCheckContext } from './nft-ownership.service';

const ABI = parseAbi([
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function supportsInterface(bytes4 id) view returns (bool)',
]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = '0x0000000000000000000000000000000000000000';
const UNAVAILABLE = 'Token verification is temporarily unavailable. Please try again.';

@Injectable()
export class Erc20OwnershipService {
  private clients = new Map<number, Pick<PublicClient, 'readContract' | 'getChainId' | 'getBlockNumber'>>();

  private getClient(chainId: number) {
    const network = getNftNetwork(chainId);
    const variable = network.rpcVariable;
    if (!EnvironmentConfig[variable]) throw new Error(`${network.name} token verification is not configured. Set ${variable} on the backend.`);
    if (!this.clients.has(chainId)) this.clients.set(chainId, createPublicClient({ chain: network.chain,
      transport: http(EnvironmentConfig[variable], { timeout: 10000, retryCount: 1, batch: { batchSize: NFT_BATCH_SIZE, wait: 10 } }) }));
    return this.clients.get(chainId);
  }

  async prepareRule(contract: string, minimum: string, chainId = 1): Promise<NftRuleFields> {
    getNftNetwork(chainId);
    if (!ADDRESS.test(contract) || contract.toLowerCase() === ZERO) throw new Error('Enter a valid ERC-20 contract address on the selected network.');
    const client = this.getClient(chainId);
    const address = contract.toLowerCase() as Address;
    let decimals: number;
    try {
      if (await client.getChainId() !== chainId) throw new Error('The token RPC points to the wrong network.');
      const reads = await Promise.all([
        client.readContract({ address, abi: ABI, functionName: 'decimals' }),
        client.readContract({ address, abi: ABI, functionName: 'totalSupply' }),
        client.readContract({ address, abi: ABI, functionName: 'balanceOf', args: [ZERO] }),
      ]);
      decimals = reads[0];
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255
        || reads.slice(1).some(value => typeof value !== 'bigint' || value < 0n || value > UINT256_MAX)) throw new Error('Invalid token contract.');
    } catch {
      throw new Error('Could not read the ERC-20 contract. Check its address and network; the token must expose decimals, totalSupply, and balanceOf.');
    }
    const standards = await Promise.allSettled(['0x80ac58cd', '0xd9b67a26'].map(id =>
      client.readContract({ address, abi: ABI, functionName: 'supportsInterface', args: [id as `0x${string}`] })));
    if (standards.some(result => result.status === 'fulfilled' && result.value === true)) throw new Error('Use /setup add-nft-rule for ERC-721 or ERC-1155 contracts.');
    const min_balance = parseTokenBalance(minimum, decimals);
    const metadata = await Promise.allSettled(['name', 'symbol'].map(functionName =>
      client.readContract({ address, abi: ABI, functionName: functionName as 'name' | 'symbol' })));
    const text = (index: number, limit: number) => {
      const result = metadata[index];
      if (result.status !== 'fulfilled' || typeof result.value !== 'string') return null;
      return result.value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit) || null;
    };
    return { asset_type: 'erc20', chain_id: chainId, contract_address: address, token_standard: null,
      token_ids: null, collection_name: text(0, 100), token_symbol: text(1, 32), token_decimals: decimals, min_balance };
  }

  async count(rule: NftRuleFields, wallets: string[], context?: NftCheckContext): Promise<bigint> {
    tokenMinimum(rule);
    getNftNetwork(rule.chain_id);
    if (!ADDRESS.test(rule.contract_address || '') || rule.contract_address.toLowerCase() === ZERO) throw new Error('Invalid ERC-20 contract.');
    const addresses = [...new Set(wallets.map(wallet => wallet.toLowerCase()))].sort() as Address[];
    if (addresses.some(address => !ADDRESS.test(address))) throw new Error('Invalid token wallet address.');
    if (!addresses.length) return 0n;
    const run = context || { checks: new Map() };
    const key = JSON.stringify(['erc20', rule.chain_id, rule.contract_address.toLowerCase(), addresses]);
    if (!run.checks.has(key)) run.checks.set(key, this.readBalances(rule, addresses, run));
    return run.checks.get(key);
  }

  private async readBalances(rule: NftRuleFields, addresses: Address[], context: NftCheckContext): Promise<bigint> {
    try {
      const client = this.getClient(rule.chain_id);
      context.blocks ||= new Map();
      if (!context.blocks.has(rule.chain_id)) context.blocks.set(rule.chain_id, client.getChainId().then(chainId => {
        if (chainId !== rule.chain_id) throw new Error('Wrong token RPC network.');
        return client.getBlockNumber();
      }));
      const blockNumber = await context.blocks.get(rule.chain_id);
      let total = 0n;
      for (let index = 0; index < addresses.length; index += NFT_BATCH_SIZE) {
        const balances = await Promise.all(addresses.slice(index, index + NFT_BATCH_SIZE).map(owner =>
          client.readContract({ address: rule.contract_address as Address, abi: ABI, functionName: 'balanceOf', args: [owner], blockNumber })));
        for (const balance of balances) {
          if (typeof balance !== 'bigint' || balance < 0n || balance > UINT256_MAX) throw new Error('Invalid token balance.');
          total += balance;
        }
      }
      return total;
    } catch { throw new Error(UNAVAILABLE); }
  }
}
