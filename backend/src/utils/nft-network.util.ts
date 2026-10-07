import { defineChain } from 'viem';
import { mainnet } from 'viem/chains';

const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
});

export const NFT_NETWORKS = [
  { value: 'ethereum', name: 'Ethereum', chain: mainnet },
  { value: 'robinhood', name: 'Robinhood', chain: robinhood },
];

export function getNftNetwork(chainId: number) {
  const network = NFT_NETWORKS.find(network => network.chain.id === chainId);
  if (!network) throw new Error('NFT rules support Ethereum and Robinhood mainnet only.');
  return network;
}

export function getNftNetworkId(value: string = 'ethereum'): number {
  const network = NFT_NETWORKS.find(network => network.value === value);
  if (!network) throw new Error('Select Ethereum or Robinhood for the NFT network.');
  return network.chain.id;
}

export function nftNetworkLabel(chainId: number = 1): string {
  return NFT_NETWORKS.find(network => network.chain.id === chainId)?.name || `Chain ${chainId}`;
}
