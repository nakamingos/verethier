import { Injectable, Optional } from '@nestjs/common';
import { Address, BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, PublicClient, createPublicClient, http, parseAbi } from 'viem';
import { EnvironmentConfig } from '@/config/environment.config';
import { NftRuleFields } from '@/models/verifier-role.interface';
import { NFT_BATCH_SIZE, nftRuleLabel, parseTokenIds } from '@/utils/nft-rule.util';
import { getNftNetwork } from '@/utils/nft-network.util';
import { NftAttributes, matchesNftTrait, nftTrait } from '@/utils/nft-trait.util';
import { NftMetadataService } from './nft-metadata.service';

const ABI = parseAbi([
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function name() view returns (string)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function uri(uint256 tokenId) view returns (string)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
]);

export interface NftCheckContext {
  ordinalSummaries?: Map<string, Promise<Map<string, bigint>>>;
  ordinalIds?: Map<string, Promise<Set<string>>>;
  blocks?: Map<number, Promise<bigint>>;
  nftOwnedTokens?: Map<string, Promise<Map<string, bigint>>>;
  nftMetadata?: Map<string, Promise<Map<string, NftAttributes>>>;
  checks: Map<string, Promise<bigint>>;
}

@Injectable()
export class NftOwnershipService {
  private readonly clients = new Map<number, Pick<PublicClient, 'readContract' | 'getChainId' | 'getBlockNumber'>>();

  constructor(@Optional() private readonly metadataSvc?: NftMetadataService) {}

  private getClient(chainId: number) {
    const network = getNftNetwork(chainId);
    const rpcVariable = chainId === 1 ? 'RPC_URL' : 'ROBINHOOD_RPC_URL';
    const rpcUrl = EnvironmentConfig[rpcVariable];
    if (!rpcUrl) throw new Error(`${network.name} NFT verification is not configured. Set ${rpcVariable} on the backend.`);
    if (!this.clients.has(chainId)) {
      this.clients.set(chainId, createPublicClient({
        chain: network.chain,
        transport: http(rpcUrl, { timeout: 10000, retryCount: 1, batch: { batchSize: NFT_BATCH_SIZE, wait: 10 } }),
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
    const trait = nftTrait(rule);
    const run = context || { checks: new Map<string, Promise<bigint>>() };
    const key = JSON.stringify([rule.chain_id, rule.contract_address, rule.token_standard, rule.token_ids, addresses.slice().sort(), trait.key.toLowerCase(), trait.value.toLowerCase()]);
    if (!run.checks.has(key)) run.checks.set(key, trait.enabled ? this.readTraitBalances(rule, addresses, run) : this.readBalances(rule, addresses, run));
    return run.checks.get(key);
  }

  async validateTraits(rule: NftRuleFields): Promise<void> {
    if (!nftTrait(rule).enabled) return;
    if (!this.metadataSvc) throw new Error('NFT trait verification is not configured.');
    // Check API access; sample suggestions do not restrict manually entered traits.
    await this.metadataSvc.suggestions(rule);
  }

  private async blockNumber(chainId: number, context: NftCheckContext): Promise<bigint> {
    const network = getNftNetwork(chainId);
    const client = this.getClient(chainId);
    context.blocks ||= new Map();
    if (!context.blocks.has(chainId)) {
      context.blocks.set(chainId, client.getChainId().then(actualChainId => {
        if (actualChainId !== chainId) throw new Error(`The NFT RPC must point to ${network.name} mainnet.`);
        return client.getBlockNumber();
      }));
    }
    return context.blocks.get(chainId);
  }

  private async owner(rule: NftRuleFields, id: string, blockNumber: bigint): Promise<string | null> {
    try {
      return (await this.getClient(rule.chain_id).readContract({
        address: rule.contract_address as Address, abi: ABI, blockNumber, functionName: 'ownerOf', args: [BigInt(id)],
      })).toLowerCase();
    } catch (error) {
      // ERC-721 ownerOf reverts for nonexistent or burned tokens.
      if (error instanceof BaseError && error.walk(cause => cause instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError) return null;
      throw error;
    }
  }

  private async readTraitBalances(rule: NftRuleFields, addresses: Address[], context: NftCheckContext): Promise<bigint> {
    if (!this.metadataSvc) throw new Error('NFT trait verification is not configured.');
    context.nftOwnedTokens ||= new Map();
    const scope = JSON.stringify([rule.chain_id, rule.contract_address, rule.token_standard, rule.token_ids, addresses.slice().sort()]);
    if (!context.nftOwnedTokens.has(scope)) context.nftOwnedTokens.set(scope, this.readOwnedTokens(rule, addresses, context));
    const owned = await context.nftOwnedTokens.get(scope);
    if (!owned.size) return 0n;
    context.nftMetadata ||= new Map();
    const metadataScope = JSON.stringify([rule.chain_id, rule.contract_address, rule.token_standard, [...owned.keys()].sort()]);
    if (!context.nftMetadata.has(metadataScope)) {
      context.nftMetadata.set(metadataScope, this.blockNumber(rule.chain_id, context).then(blockNumber =>
        this.metadataSvc.attributes(rule, [...owned.keys()], id => this.metadataUri(rule, id, blockNumber))));
    }
    const attributes = await context.nftMetadata.get(metadataScope);
    let count = 0n;
    for (const [id, copies] of owned) {
      if (!attributes.has(id)) throw new Error('NFT trait verification is temporarily unavailable. Please try again.');
      if (matchesNftTrait(attributes.get(id), rule)) count += copies;
    }
    return count;
  }

  private async metadataUri(rule: NftRuleFields, id: string, blockNumber: bigint): Promise<string | null> {
    try {
      return await this.getClient(rule.chain_id).readContract({
        address: rule.contract_address as Address, abi: ABI, blockNumber,
        functionName: rule.token_standard === 'erc721' ? 'tokenURI' : 'uri', args: [BigInt(id)],
      });
    } catch (error) {
      // The metadata URI extension is optional. Transport failures still make the check unavailable.
      if (error instanceof BaseError) {
        const cause = error.walk(cause => cause instanceof ContractFunctionRevertedError || cause instanceof ContractFunctionZeroDataError);
        if (cause instanceof ContractFunctionRevertedError || cause instanceof ContractFunctionZeroDataError) return null;
      }
      throw error;
    }
  }

  private async readOwnedTokens(rule: NftRuleFields, addresses: Address[], context: NftCheckContext): Promise<Map<string, bigint>> {
    const blockNumber = await this.blockNumber(rule.chain_id, context);
    const client = this.getClient(rule.chain_id);
    const owned = new Map<string, bigint>();
    if (rule.token_standard === 'erc1155') {
      if (!rule.token_ids?.length) throw new Error('ERC-1155 rules require configured token IDs.');
      const pairs = addresses.flatMap(address => rule.token_ids.map(id => ({ address, id })));
      for (let offset = 0; offset < pairs.length; offset += NFT_BATCH_SIZE) {
        const batch = pairs.slice(offset, offset + NFT_BATCH_SIZE);
        const balances = await client.readContract({ address: rule.contract_address as Address, abi: ABI, blockNumber,
          functionName: 'balanceOfBatch', args: [batch.map(pair => pair.address), batch.map(pair => BigInt(pair.id))] });
        if (balances.length !== batch.length) throw new Error('NFT contract returned an incomplete balance batch.');
        balances.forEach((balance, index) => {
          if (balance > 0n) owned.set(batch[index].id, (owned.get(batch[index].id) || 0n) + balance);
        });
      }
      return owned;
    }
    let ids = rule.token_ids;
    let expected: bigint[] | undefined;
    if (!ids?.length) {
      expected = await Promise.all(addresses.map(owner => client.readContract({ address: rule.contract_address as Address, abi: ABI,
        blockNumber, functionName: 'balanceOf', args: [owner] })));
      if (expected.every(balance => balance === 0n)) return owned;
      const inventories = await Promise.all(addresses.map((address, index) => expected[index] === 0n ? [] : this.metadataSvc.ownedIds(rule, address)));
      ids = [...new Set(inventories.flat())];
    }
    const actual = addresses.map(() => 0n);
    for (let offset = 0; offset < ids.length; offset += NFT_BATCH_SIZE) {
      const batch = ids.slice(offset, offset + NFT_BATCH_SIZE);
      const owners = await Promise.all(batch.map(id => this.owner(rule, id, blockNumber)));
      owners.forEach((owner, index) => {
        const walletIndex = addresses.indexOf(owner as Address);
        if (walletIndex >= 0) { owned.set(batch[index], 1n); actual[walletIndex]++; }
      });
    }
    // An indexer that missed a mint or transfer must never produce a confirmed partial count.
    if (expected && expected.some((balance, index) => balance !== actual[index])) {
      throw new Error('NFT trait verification is temporarily unavailable. Please try again.');
    }
    return owned;
  }

  private async readBalances(rule: NftRuleFields, addresses: Address[], context: NftCheckContext): Promise<bigint> {
    const client = this.getClient(rule.chain_id);
    const blockNumber = await this.blockNumber(rule.chain_id, context);
    const parameters = { address: rule.contract_address as Address, abi: ABI, blockNumber };
    if (rule.token_standard === 'erc721') {
      if (rule.token_ids?.length) {
        return addresses.includes(await this.owner(rule, rule.token_ids[0], blockNumber) as Address) ? 1n : 0n;
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
