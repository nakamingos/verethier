export const RULE_CREATION_COMMANDS = [
  { name: 'add-solana-nft-rule', assetType: 'solana_nft' },
  { name: 'add-solana-token-rule', assetType: 'solana_token' },
  { name: 'add-token-rule', assetType: 'erc20' },
  { name: 'add-nft-rule', assetType: 'nft' },
  { name: 'add-ordinals-rule', assetType: 'ordinal' },
  { name: 'add-ethscription-rule', assetType: 'ethscription' },
] as const;

export type RuleCreationAssetType = typeof RULE_CREATION_COMMANDS[number]['assetType'];

export function ruleCommandAssetType(command: string): RuleCreationAssetType | undefined {
  return RULE_CREATION_COMMANDS.find(entry => entry.name === command)?.assetType;
}
