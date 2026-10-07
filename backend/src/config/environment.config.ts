import dotenv from 'dotenv';
import { AppLogger } from '@/utils/app-logger.util';

// Load environment variables once at startup
dotenv.config();

/**
 * Centralized environment configuration
 * Validates and caches environment variables to prevent repeated access
 */
export class EnvironmentConfig {
  // Discord Configuration
  public static readonly DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  public static readonly DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  public static readonly DISCORD_ENABLED = Number(process.env.DISCORD) || 0;
  
  // Database Configuration
  public static readonly DATA_SUPABASE_URL = process.env.DATA_SUPABASE_URL;
  public static readonly DATA_SUPABASE_ANON_KEY = process.env.DATA_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  public static readonly DB_SUPABASE_URL = process.env.DB_SUPABASE_URL;
  public static readonly DB_SUPABASE_KEY = process.env.DB_SUPABASE_KEY || process.env.SUPABASE_KEY;
  public static readonly RPC_URL = process.env.RPC_URL;
  public static readonly ROBINHOOD_RPC_URL = process.env.ROBINHOOD_RPC_URL;
  
  // Application Configuration
  public static readonly BASE_URL = process.env.BASE_URL;
  public static readonly NODE_ENV = process.env.NODE_ENV;
  public static readonly NONCE_EXPIRY = Number(process.env.NONCE_EXPIRY) || 300000; // 5 minutes default
  
  // Dynamic Role Management Configuration
  public static readonly DYNAMIC_ROLE_CRON = (() => {
    const cronValue = process.env.DYNAMIC_ROLE_CRON || 'EVERY_6_HOURS';
    
    // Map common values to CRON expressions for backward compatibility
    const cronMap: Record<string, string> = {
      'EVERY_1_MINUTE': '* * * * *',
      'EVERY_6_HOURS': '0 */6 * * *',
      'EVERY_12_HOURS': '0 */12 * * *',
      'EVERY_DAY_AT_MIDNIGHT': '0 0 * * *',
      'EVERY_4_HOURS': '0 */4 * * *',
      'EVERY_HOUR': '0 * * * *',
      'EVERY_1_HOUR': '0 * * * *', // Same as EVERY_HOUR for consistency
    };
    
    return cronMap[cronValue] || cronValue; // Use mapping if exists, otherwise use as-is
  })();
  
  // Runtime flags
  public static readonly IS_TEST = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
  
  /**
   * Validate required environment variables
   * Call this during application startup
   */
  public static validate(): void {
    const requiredVars = [
      { name: 'DATA_SUPABASE_URL', value: this.DATA_SUPABASE_URL },
      { name: 'DATA_SUPABASE_ANON_KEY', value: this.DATA_SUPABASE_ANON_KEY },
      { name: 'DB_SUPABASE_URL', value: this.DB_SUPABASE_URL },
      { name: 'DB_SUPABASE_KEY', value: this.DB_SUPABASE_KEY },
    ];

    const missing = requiredVars.filter(v => !v.value);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.map(v => v.name).join(', ')}`);
    }

    // Warn about optional Discord variables if Discord is enabled (only in development)
    if (this.DISCORD_ENABLED && (!this.DISCORD_BOT_TOKEN || !this.DISCORD_CLIENT_ID)) {
      if (this.NODE_ENV === 'development') {
        AppLogger.warn('Discord is enabled but DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID is missing', 'EnvironmentConfig');
      }
    }
  }

  /**
   * Get sanitized configuration info for debugging (development only)
   * Masks sensitive values in production
   */
  public static getConfigInfo(): Record<string, any> {
    if (this.NODE_ENV === 'production') {
      return {
        message: 'Configuration details are not available in production for security reasons'
      };
    }

    return {
      DISCORD_ENABLED: this.DISCORD_ENABLED,
      NODE_ENV: this.NODE_ENV,
      BASE_URL: this.BASE_URL,
      NONCE_EXPIRY: this.NONCE_EXPIRY,
      DYNAMIC_ROLE_CRON: this.DYNAMIC_ROLE_CRON,
      IS_TEST: this.IS_TEST,
      // Never expose actual credentials
      hasDiscordToken: !!this.DISCORD_BOT_TOKEN,
      hasDiscordClientId: !!this.DISCORD_CLIENT_ID,
      hasDataSupabaseUrl: !!this.DATA_SUPABASE_URL,
      hasDataSupabaseKey: !!this.DATA_SUPABASE_ANON_KEY,
      hasDbSupabaseUrl: !!this.DB_SUPABASE_URL,
      hasDbSupabaseKey: !!this.DB_SUPABASE_KEY,
    };
  }
}
