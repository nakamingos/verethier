import { Injectable } from '@nestjs/common';
import dotenv from 'dotenv';

// Load environment configuration
dotenv.config();

/**
 * AppService
 * 
 * Main application service that provides core functionality and health checks
 * for the Bouncer Discord bot backend. This service is primarily used for
 * application lifecycle management and basic health monitoring.
 * 
 * Key Responsibilities:
 * - Application health checks and status reporting
 * - Basic service coordination and initialization
 * - Environment configuration validation
 * - System-wide utility functions
 * 
 * The service is intentionally lightweight, with most business logic
 * delegated to specialized services (verification, Discord, data access, etc.).
 */
@Injectable()
export class AppService {
  /**
   * Get basic application health and status information
   * 
   * @returns Object containing application status and essential info only
   */
  getHealth() {
    const baseHealth = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };

    // Only include environment and version info in development
    if (process.env.NODE_ENV === 'development') {
      return {
        ...baseHealth,
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version || '1.0.0'
      };
    }

    return baseHealth;
  }

  /**
   * Get application information and basic stats
   * Only available in development environment for security
   * 
   * @returns Object containing application metadata or restricted access message
   */
  getInfo() {
    // Restrict detailed info to development environment only
    if (process.env.NODE_ENV !== 'development') {
      return {
        message: 'Application information is not available in production for security reasons'
      };
    }

    return {
      name: 'Bouncer Backend',
      description: 'Discord wallet verification for Ethscriptions, NFTs and Bitcoin Ordinals',
      architecture: 'Unified verification engine with channel-based verification',
      features: [
        'EIP-712 signature verification',
        'Dynamic role management',
        'High-performance caching',
        'Multi-tier rate limiting',
        'Multi-wallet support'
      ]
    };
  }
}
