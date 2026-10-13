import { WalletType } from '@/utils/wallet-address.util';

export interface WalletBlock {
  server_id: string;
  address: string;
  wallet_type: WalletType;
  reason: string | null;
  blocked_by: string;
  blocked_at: string;
}
