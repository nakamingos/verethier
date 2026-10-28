export const EVM_NETWORKS = [
  { value: 'ethereum', label: 'Ethereum', chainId: 1 },
  { value: 'base', label: 'Base', chainId: 8453 },
  { value: 'robinhood', label: 'Robinhood', chainId: 4663 },
];

export const evmNetworkValue = (chainId = 1) =>
  EVM_NETWORKS.find((network) => network.chainId === chainId)?.value;

export const evmNetworkLabel = (chainId = 1) =>
  EVM_NETWORKS.find((network) => network.chainId === chainId)?.label ||
  `Chain ${chainId}`;
