import { Injectable } from '@nestjs/common';
import { Address, BaseError, ContractFunctionRevertedError, PublicClient, createPublicClient, http, parseAbi } from 'viem';
import { EnvironmentConfig } from '@/config/environment.config';
import { NftRuleFields } from '@/models/verifier-role.interface';
import { NFT_BATCH_SIZE, nftRuleLabel, parseTokenIds } from '@/utils/nft-rule.util';
import { getNftNetwork } from '@/utils/nft-network.util';

const ABI = parseAbi([
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function name() view returns (string)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
]);

export interface NftCheckContext {
  ordinalSummaries?: Map<string, Promise<Map<string, bigint>>>;
  ordinalIds?: Map<string, Promise<Set<string>>>;
  blocks?: Map<number, Promise<bigint>>;
  checks: Map<string, Promise<bigint>>;
}

@Injectable()
export class NftOwnershipService {
  private readonly clients = new Map<number, Pick<PublicClient, 'readContract' | 'getChainId' | 'getBlockNumber'>>();

  private getClient(chainId: number) {
    const network = getNftNetwork(chainId);
    const rpcVariable = chainId === 1 ? 'RPC_URL' : 'ROBINHOOD_RPC_URL';
    const rpcUrl = EnvironmentConfig[rpcVariable];
    if (!rpcUrl) throw new Error(`${network.name} NFT verification is not configured. Set ${rpcVariable} on the backend.`);
    if (!this.clients.has(chainId)) {
      this.clients.set(chainId, createPublicClient({
        chain: network.chain,
        transport: http(rpcUrl, { timeout: 10000, retryCount: 1 }),
      }));
    }
    return this.clients.get(chainId);
  }

  async prepareRule(contract: string, tokenIds?: string | null, label?: string | null, chainId: number = 1): Promise<NftRuleFields> {
    const network = getNftNetwork(chainId);
    if (!/^0x[a-fA-F0-9]{40}$/.test(contract) || /^0x0{40}$/i.test(contract)) {
      throw new Error(`Enter a valid NFT contract address on ${network.name} mainnet.`);
    }
    const client = this.getClient(chainId);
    let rpcChainId: number;
    try { rpcChainId = await client.getChainId(); }
    catch { throw new Error('NFT verification is temporarily unavailable. Please try again.'); }
    if (rpcChainId !== chainId) throw new Error(`The NFT RPC must point to ${network.name} mainnet.`);
    const address = contract.toLowerCase() as Address;
    const supports = (id: `0x${string}`) => client.readContract({ address, abi: ABI, functionName: 'supportsInterface', args: [id] });
    const [erc721, erc1155] = await Promise.all([supports('0x80ac58cd'), supports('0xd9b67a26')])
      .catch(() => { throw new Error(`Could not read the NFT contract on ${network.name}. Check the address and try again.`); });
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
      asset_type: 'nft', chain_id: chainId, contract_address: address,
      token_standard: erc721 ? 'erc721' : 'erc1155', token_ids: ids,
      collection_name: name || nftRuleLabel({ contract_address: address }),
    };
  }

  async count(rule: NftRuleFields, wallets: string[], context?: NftCheckContext): Promise<bigint> {
    if (!rule.chain_id || !rule.contract_address || !['erc721', 'erc1155'].includes(rule.token_standard)) {
      throw new Error('Invalid NFT verification rule.');
    }
    getNftNetwork(rule.chain_id);
    const addresses = [...new Set(wallets.map(wallet => wallet.toLowerCase()))] as Address[];
    if (!addresses.length) return BigInt(0);
    const run = context || { checks: new Map<string, Promise<bigint>>() };
    const key = JSON.stringify([rule.chain_id, rule.contract_address, rule.token_standard, rule.token_ids, addresses.slice().sort()]);
    if (!run.checks.has(key)) run.checks.set(key, this.readBalances(rule, addresses, run));
    return run.checks.get(key);
  }

  private async readBalances(rule: NftRuleFields, addresses: Address[], context: NftCheckContext): Promise<bigint> {
    const network = getNftNetwork(rule.chain_id);
    const client = this.getClient(rule.chain_id);
    context.blocks ||= new Map();
    if (!context.blocks.has(rule.chain_id)) {
      context.blocks.set(rule.chain_id, client.getChainId().then(chainId => {
        if (chainId !== rule.chain_id) throw new Error(`The NFT RPC must point to ${network.name} mainnet.`);
        return client.getBlockNumber();
      }));
    }
    const blockNumber = await context.blocks.get(rule.chain_id);
    const parameters = { address: rule.contract_address as Address, abi: ABI, blockNumber };
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
