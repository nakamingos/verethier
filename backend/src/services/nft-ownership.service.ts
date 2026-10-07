import { Injectable } from '@nestjs/common';
import { Address, BaseError, ContractFunctionRevertedError, PublicClient, createPublicClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { EnvironmentConfig } from '@/config/environment.config';
import { NftRuleFields } from '@/models/verifier-role.interface';
import { NFT_BATCH_SIZE, nftRuleLabel, parseTokenIds } from '@/utils/nft-rule.util';

const ABI = parseAbi([
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function name() view returns (string)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
]);

export interface NftCheckContext {
  blockNumber?: bigint;
  block?: Promise<bigint>;
  checks: Map<string, Promise<bigint>>;
}

@Injectable()
export class NftOwnershipService {
  private client: Pick<PublicClient, 'readContract' | 'getChainId' | 'getBlockNumber'>;

  private getClient() {
    if (!EnvironmentConfig.RPC_URL) throw new Error('NFT verification is not configured. Set RPC_URL on the backend.');
    return this.client ||= createPublicClient({
      chain: mainnet,
      transport: http(EnvironmentConfig.RPC_URL, { timeout: 10000, retryCount: 1 }),
    }) as unknown as typeof this.client;
  }

  async prepareRule(contract: string, tokenIds?: string | null, label?: string | null): Promise<NftRuleFields> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(contract) || /^0x0{40}$/i.test(contract)) {
      throw new Error('Enter a valid NFT contract address on Ethereum mainnet.');
    }
    const client = this.getClient();
    let chainId: number;
    try { chainId = await client.getChainId(); }
    catch { throw new Error('NFT verification is temporarily unavailable. Please try again.'); }
    if (chainId !== 1) throw new Error('RPC_URL must point to Ethereum mainnet.');
    const address = contract.toLowerCase() as Address;
    const supports = (id: `0x${string}`) => client.readContract({ address, abi: ABI, functionName: 'supportsInterface', args: [id] });
    const [erc721, erc1155] = await Promise.all([supports('0x80ac58cd'), supports('0xd9b67a26')])
      .catch(() => { throw new Error('Could not read the NFT contract. Check the address and try again.'); });
    if (erc721 === erc1155) throw new Error('This contract must support exactly one of ERC-721 or ERC-1155.');
    const ids = erc1155 || tokenIds != null ? parseTokenIds(tokenIds) : null;
    if (erc721 && ids && ids.length !== 1) throw new Error('For a specific ERC-721 token, enter one token ID.');
    let name = label?.trim();
    if (name && name.length > 100) throw new Error('Collection names must be 100 characters or fewer.');
    if (!name) {
      try { name = (await client.readContract({ address, abi: ABI, functionName: 'name' })).trim().slice(0, 100); }
      catch { /* Collection names are optional metadata. */ }
    }
    return {
      asset_type: 'nft', chain_id: 1, contract_address: address,
      token_standard: erc721 ? 'erc721' : 'erc1155', token_ids: ids,
      collection_name: name || nftRuleLabel({ contract_address: address }),
    };
  }

  async count(rule: NftRuleFields, wallets: string[], context?: NftCheckContext): Promise<bigint> {
    if (rule.chain_id !== 1 || !rule.contract_address || !['erc721', 'erc1155'].includes(rule.token_standard)) {
      throw new Error('Invalid NFT verification rule.');
    }
    const addresses = [...new Set(wallets.map(wallet => wallet.toLowerCase()))] as Address[];
    if (!addresses.length) return BigInt(0);
    const run = context || { checks: new Map<string, Promise<bigint>>() };
    const key = JSON.stringify([rule.contract_address, rule.token_standard, rule.token_ids, addresses.slice().sort()]);
    if (!run.checks.has(key)) run.checks.set(key, this.readBalances(rule, addresses, run));
    return run.checks.get(key);
  }

  private async readBalances(rule: NftRuleFields, addresses: Address[], context: NftCheckContext): Promise<bigint> {
    const client = this.getClient();
    context.block ||= client.getChainId().then(chainId => {
      if (chainId !== 1) throw new Error('RPC_URL must point to Ethereum mainnet.');
      return client.getBlockNumber();
    });
    context.blockNumber = await context.block;
    const parameters = { address: rule.contract_address as Address, abi: ABI, blockNumber: context.blockNumber };
    if (rule.token_standard === 'erc721') {
      if (rule.token_ids?.length) {
        try {
          const owner = await client.readContract({ ...parameters, functionName: 'ownerOf', args: [BigInt(rule.token_ids[0])] });
          return addresses.includes(owner.toLowerCase() as Address) ? BigInt(1) : BigInt(0);
        } catch (error) {
          // ERC-721 ownerOf reverts for nonexistent or burned tokens.
          if (error instanceof BaseError && error.walk(cause => cause instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError) return BigInt(0);
          throw error;
        }
      }
      const balances = await Promise.all(addresses.map(owner => client.readContract({ ...parameters, functionName: 'balanceOf', args: [owner] })));
      return balances.reduce((sum, balance) => sum + balance, BigInt(0));
    }
    if (!rule.token_ids?.length) throw new Error('ERC-1155 rules require configured token IDs.');
    let total = BigInt(0);
    let accounts: Address[] = [];
    let ids: bigint[] = [];
    const readBatch = async () => {
      const balances = await client.readContract({ ...parameters, functionName: 'balanceOfBatch', args: [accounts, ids] });
      if (balances.length !== ids.length) throw new Error('NFT contract returned an incomplete balance batch.');
      total += balances.reduce((sum, balance) => sum + balance, BigInt(0));
      accounts = []; ids = [];
    };
    for (const owner of addresses) {
      for (const id of rule.token_ids) {
        accounts.push(owner); ids.push(BigInt(id));
        if (ids.length === NFT_BATCH_SIZE) await readBatch();
      }
    }
    if (ids.length) await readBatch();
    return total;
  }
}
