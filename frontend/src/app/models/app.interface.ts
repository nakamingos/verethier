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
