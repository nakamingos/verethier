export const CHECK_NETWORKS = [
  {value:'ethereum',label:'Ethereum'}, {value:'robinhood',label:'Robinhood'},
  {value:'base',label:'Base'}, {value:'solana',label:'Solana'},
  {value:'ethscriptions',label:'Ethscriptions'}, {value:'stamps',label:'Bitcoin Stamps'},
  {value:'ordinals',label:'Ordinals'},
];
export const checkNetworkIds = () => CHECK_NETWORKS.map(network=>network.value);
export function ruleCheckNetwork(rule:any):string {
  if(rule.asset_type==='ordinal')return 'ordinals';
  if(rule.asset_type==='stamp')return 'stamps';
  if(!rule.asset_type || rule.asset_type==='ethscription')return 'ethscriptions';
  if(['solana_nft','solana_token'].includes(rule.asset_type))return 'solana';
  return rule.chain_id===4663?'robinhood':rule.chain_id===8453?'base':'ethereum';
}
