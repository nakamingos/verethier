import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';

import { DiscordService } from '@/services/discord.service';
import { DiscordMessageService } from '@/services/discord-message.service';
import { DiscordVerificationService } from '@/services/discord-verification.service';
import { DiscordCommandsService } from '@/services/discord-commands.service';
import { AddRuleHandler } from '@/services/discord-commands/handlers/add-rule.handler';
import { RemoveRuleHandler } from '@/services/discord-commands/handlers/remove-rule.handler';
import { ListRulesHandler } from '@/services/discord-commands/handlers/list-rules.handler';
import { RecoverVerificationHandler } from '@/services/discord-commands/handlers/recover-verification.handler';
import { RemovalUndoInteractionHandler } from '@/services/discord-commands/interactions/removal-undo.interaction';
import { RestoreUndoInteractionHandler } from '@/services/discord-commands/interactions/restore-undo.interaction';
import { RuleConfirmationInteractionHandler } from '@/services/discord-commands/interactions/rule-confirmation.interaction';
import { DuplicateRuleConfirmationInteractionHandler } from '@/services/discord-commands/interactions/duplicate-rule-confirmation.interaction';
import { NonceService } from '@/services/nonce.service';
import { WalletService } from '@/services/wallet.service';
import { DbService } from '@/services/db.service';
import { DataService } from './services/data.service';
import { AssetOwnershipService } from './services/asset-ownership.service';
import { NftOwnershipService } from './services/nft-ownership.service';
import { VerifyService } from './services/verify.service';
import { VerificationService } from './services/verification.service';
import { VerificationEngine } from './services/verification-engine.service';
import { DynamicRoleService } from './services/dynamic-role.service';
import { SimpleRoleMonitorService } from './services/simple-role-monitor.service';
import { QueryOptimizer } from './services/query-optimizer.service';
import { UserAddressService } from './services/user-address.service';
import { CacheService } from './services/cache.service';
import { CONSTANTS } from '@/constants';
import { createClient } from '@supabase/supabase-js';
import { EnvironmentConfig } from '@/config/environment.config';

/**
 * AppModule - Main application module
 * 
 * Central module configuration for the Verethier Discord bot backend.
 * Configures all services, middleware, and global application settings.
 * 
 * Key Configurations:
 * - **Caching**: Redis-compatible caching with automatic TTL management
 * - **Scheduling**: Cron job scheduling for automated role management
 * - **Security**: Multi-tier rate limiting with different time windows
 * - **Service Integration**: All core services including Discord, verification, and data access
 * 
 * Security Features:
 * - Global rate limiting guard across all endpoints
 * - Multiple rate limit tiers (short/medium/long term)
 * - Input validation through class-validator
 * - Structured error handling
 */
@Module({
  imports: [
    // High-performance caching layer
    CacheModule.register(),
    
    // Scheduled task management for automated operations
    ScheduleModule.forRoot(),
    
    // Multi-tier rate limiting for API security
    ThrottlerModule.forRoot([{
      name: 'short',
      ttl: CONSTANTS.RATE_LIMIT.SHORT.TTL,   // 1 second window
      limit: CONSTANTS.RATE_LIMIT.SHORT.LIMIT, // 3 requests max
    }, {
      name: 'medium', 
      ttl: CONSTANTS.RATE_LIMIT.MEDIUM.TTL,   // 10 second window
      limit: CONSTANTS.RATE_LIMIT.MEDIUM.LIMIT, // 20 requests max
    }, {
      name: 'long',
      ttl: CONSTANTS.RATE_LIMIT.LONG.TTL,     // 1 minute window
      limit: CONSTANTS.RATE_LIMIT.LONG.LIMIT,   // 100 requests max
    }]),
  ],
  controllers: [AppController],
  providers: [
    // Supabase client provider with optimized configuration
    {
      provide: 'SUPABASE_CLIENT',
      useFactory: () => {
        EnvironmentConfig.validate();
        return createClient(
          EnvironmentConfig.DB_SUPABASE_URL!,
          EnvironmentConfig.DB_SUPABASE_KEY!,
          {
            db: {
              schema: 'public',
            },
            auth: {
              persistSession: false, // Disable auth for better performance
            },
            global: {
              headers: {
                'x-application-name': 'verethier-backend',
              },
            },
          }
        );
      },
    },

    // Global security: Rate limiting protection
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },

    // Core application services
    AppService,

    // Discord integration services
    DiscordService,              // Main Discord bot client
    DiscordMessageService,       // Message formatting and sending
    DiscordVerificationService,  // Discord-specific verification logic
    DiscordCommandsService,      // Slash command handling
    AddRuleHandler,              // Add rule command handler
    RemoveRuleHandler,           // Remove rule command handler
    ListRulesHandler,            // List rules command handler
    RecoverVerificationHandler,  // Recover verification command handler

    // Discord interaction handlers
    RemovalUndoInteractionHandler,  // Handles undo functionality for rule removals
    RestoreUndoInteractionHandler,  // Handles undo functionality for rule restorations
    RuleConfirmationInteractionHandler, // Handles undo functionality for rule confirmations
    DuplicateRuleConfirmationInteractionHandler, // Handles duplicate rule confirmations

    // Verification engine and related services
    VerificationEngine,          // Unified verification processor
    VerificationService,         // Verification orchestration layer
    VerifyService,              // Request orchestration

    // Security and authentication
    NonceService,               // Cryptographic nonce management
    WalletService,              // EIP-712 signature verification

    // Data access layer
    DbService,                  // Database operations
    DataService,                // Ethscriptions marketplace queries
    AssetOwnershipService,
    NftOwnershipService,
    UserAddressService,         // Multi-wallet address management

    // Role management services
    DynamicRoleService,         // Automated role assignment/removal
    SimpleRoleMonitorService,   // Manual role management

    // Performance and optimization
    QueryOptimizer,             // Database query optimization
    CacheService               // High-performance caching layer
  ],
})
export class AppModule {}
