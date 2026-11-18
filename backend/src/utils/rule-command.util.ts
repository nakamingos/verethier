export const RULE_CREATION_COMMANDS = [
  { name: 'add-stamps-rule', assetType: 'stamp' },
  { name: 'add-counterparty-rule', assetType: 'counterparty' },
  { name: 'add-token-rule', assetType: 'erc20' },
  { name: 'add-nft-rule', assetType: 'nft' },
  { name: 'add-ordinals-rule', assetType: 'ordinal' },
  { name: 'add-ethscription-rule', assetType: 'ethscription' },
] as const;

/** add-nft-rule/add-token-rule create solana_nft/solana_token rules when network is Solana. */
export type RuleCreationAssetType = typeof RULE_CREATION_COMMANDS[number]['assetType'] | 'solana_nft' | 'solana_token';

export function ruleCommandAssetType(command: string): RuleCreationAssetType | undefined {
  return RULE_CREATION_COMMANDS.find(entry => entry.name === command)?.assetType;
}
