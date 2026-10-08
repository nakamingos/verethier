/**
 * DecodedData interface
 * 
 * Represents the decoded verification payload that contains all necessary
 * information for processing a wallet signature verification request.
 * 
 * This interface is used throughout the verification flow to pass user,
 * Discord server, and verification metadata between services.
 * 
 * The verification system handles all rules transparently.
 */
export interface DecodedData {
  address: string;      // Ethereum wallet address being verified
  walletType?: 'evm' | 'bitcoin';
  userId: string;       // Discord user ID
  userTag: string;      // Discord user tag (username#discriminator)
  avatar: string;       // Discord user avatar URL
  discordId: string;    // Discord server/guild ID
  discordName: string;  // Discord server/guild name
  discordIcon: string;  // Discord server/guild icon URL
  nonce: string;        // Cryptographic nonce for replay protection
  expiry: number;       // Unix timestamp when verification expires
};
