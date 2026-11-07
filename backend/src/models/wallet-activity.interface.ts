import { WalletType } from '@/utils/wallet-address.util';

export interface WalletVerificationActivity {
  id: string;
  source: 'portal' | 'discord';
  serverId: string;
  channelId?: string;
  walletType: WalletType;
  provenAt: string;
  evmChainId?: number; // Present only for a chain-scoped contract proof.
}

/** A valid signature rejected by a server block; never a saved wallet link. */
export interface BlockedVerificationAttempt {
  userId: string;
  serverId: string;
  address: string;
  walletType: WalletType;
  source: 'portal' | 'discord';
  channelId?: string;
  chainId?: number;
}
