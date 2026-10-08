import { IsString, IsNotEmpty, IsObject, IsOptional, IsNumber } from 'class-validator';

/**
 * VerifySignatureDto
 * 
 * Data Transfer Object for wallet signature verification requests.
 * Validates the structure of verification payloads sent from the frontend
 * after users sign verification messages with their wallets.
 * 
 * Contains:
 * - data: Decoded JWT payload with user, server, and verification details
 * - signature: EIP-712 or Bitcoin BIP-322 signature from the user's wallet
 * 
 * The verification system automatically handles all verification rules
 * transparently without requiring different API structures.
 */
export class VerifySignatureDto {
  /**
   * The decoded verification data object.
   * Contains user information, Discord server details, and verification metadata.
   * The verification engine automatically processes the verification criteria.
   */
  @IsObject()
  data: {
    userId?: string;
    userTag?: string;
    avatar?: string;
    discordId?: string;
    discordName?: string;
    discordIconURL?: string;
    nonce?: string;
    expiry?: number;
    address?: string;
    walletType?: 'evm' | 'bitcoin';
    // Allow additional fields for forward compatibility
    [key: string]: any;
  };

  /**
   * The EIP-712 or BIP-322 signature from the user's wallet.
   * Used to verify control of the claimed address.
   */
  @IsString()
  @IsNotEmpty()
  signature: string;

  // Allow additional top-level fields for extensibility
  [key: string]: any;
}
