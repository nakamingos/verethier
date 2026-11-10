import { consentCommitment } from './consent-proof.util';
export { consentCommitment } from './consent-proof.util';
import { getAddress } from 'viem';
import { privacyProof } from '@/portal/privacy.service';
import { getNftNetwork } from './nft-network.util';

export function walletProofOrigin(value: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Invalid wallet verification origin.');
  return url.origin;
}

export function minimalEvmVerificationProof(input: {
  origin: string; chainId: number; address: string; nonce: string; expiry: number; privacy?: unknown;
}) {
  getNftNetwork(input.chainId);
  const fields = [
    {name:'Purpose',type:'string'}, {name:'Domain',type:'string'},
    {name:'WalletAddress',type:'address'}, {name:'Nonce',type:'string'}, {name:'Expiry',type:'uint256'},
  ];
  const message: Record<string, unknown> = {
    Purpose:'Verify wallet ownership', Domain:walletProofOrigin(input.origin),
    WalletAddress:getAddress(input.address), Nonce:input.nonce, Expiry:input.expiry,
  };
  if (input.privacy !== undefined) {
    fields.push({name:'ConsentHash',type:'bytes32'});
    message.ConsentHash = consentCommitment(input.nonce, privacyProof(input.privacy));
  }
  return {domain:{name:'Bouncer',version:'2',chainId:input.chainId},
    primaryType:'Verification',types:{Verification:fields},message};
}
