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
