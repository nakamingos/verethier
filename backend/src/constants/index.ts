/**
 * Application-wide constants
 * 
 * Centralized configuration values used throughout the application.
 * Provides default values and consistent configuration for various services.
 * 
 * Categories:
 * - Discord: Bot initialization and API timeouts
 * - Security: Rate limiting and nonce expiration
 * - Database: Connection and query timeouts
 */
export const CONSTANTS = {
  ERRORS: {
    WALLET_ADDRESS_ALREADY_VERIFIED: 'This wallet address is already verified by another user.',
  },

  // Discord configuration
  DISCORD_INITIALIZATION_TIMEOUT: 60000, // Allow a minute for Discord gateway startup
  
  // Nonce and verification security  
  DEFAULT_NONCE_EXPIRY: 300000, // 5 minutes - default expiration for verification nonces
  
  // Rate limiting configuration for API endpoints
  RATE_LIMIT: {
    SHORT: {
      TTL: 1000,  // 1 second window
      LIMIT: 3,   // 3 requests maximum
    },
    MEDIUM: {
      TTL: 10000, // 10 second window  
      LIMIT: 20,  // 20 requests maximum
    },
    LONG: {
      TTL: 60000, // 1 minute window
      LIMIT: 100, // 100 requests
    },
  },

  // UI and data presentation limits
  LIMITS: {
    AUTOCOMPLETE_RESULTS: 25,     // Discord autocomplete limit
    RECENT_MESSAGES_FETCH: 100,   // Recent messages to search for verification
    ATTRIBUTE_SAMPLE_SIZE: 50,    // Sample size for attribute discovery
    ATTRIBUTE_PAGINATION: 200,    // Items per page for attribute queries
    MAX_ROLE_NAME_LENGTH: 100,    // Maximum role name length for Discord
    VERIFICATION_BATCH_SIZE: 50,  // Maximum verifications to process in parallel
  },

  // Time-related constants (in seconds)
  TIMEOUTS: {
    DISCORD_FETCH: 5,             // Discord API call timeout
    DATABASE_QUERY: 10,           // Database query timeout
    CACHE_OPERATION: 2,           // Cache operation timeout
    VERIFICATION_PROCESS: 30,     // Max time for verification process
  },

} as const;
