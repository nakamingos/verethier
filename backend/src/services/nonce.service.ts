import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import dotenv from 'dotenv';
import { CONSTANTS } from '@/constants';
import { randomBytes } from 'crypto';

// Load environment variables
dotenv.config();

const NONCE_EXPIRY = Number(process.env.NONCE_EXPIRY) || CONSTANTS.DEFAULT_NONCE_EXPIRY;

/**
 * Interface for nonce data stored in cache
 * 
 * @interface NonceData
 * @property userId - Discord user ID associated with the nonce
 * @property guildId - Discord guild ID associated with the verification request
 * @property nonce - The cryptographic nonce string
 * @property messageId - Optional Discord message ID for verification context
 * @property channelId - Optional Discord channel ID for verification context
 */
export interface NonceData {
  userId: string;
  guildId: string;
  nonce: string;
  messageId?: string;
  channelId?: string;
  expiry?: number;
  bitcoinChallenge?: { address: string; message: string };
}

/**
 * NonceService
 * 
 * Manages cryptographic nonces for secure wallet verification.
 * Provides nonce generation, validation, and lifecycle management
 * to prevent replay attacks in the verification system.
 * 
 * Key Features:
 * - Secure random nonce generation
 * - Time-based expiry with configurable TTL
 * - Cache-based storage for high performance
 * - Replay attack prevention
 * - Optional context tracking (message/channel IDs)
 * 
 * Security Considerations:
 * - Nonces are single-use and automatically expire
 * - Uses cryptographically secure random number generation
 * - Cache isolation prevents cross-user nonce access
 * - Configurable expiry times based on security requirements
 */
@Injectable()
export class NonceService {
  private readonly lockedNonces = new Set<string>();

  constructor(
    @Inject(CACHE_MANAGER) private cache: Cache
  ) {}

  private getCacheKey(nonce: string): string {
    return `nonce_${nonce}`;
  }

  private getLatestNonceKey(userId: string, guildId: string, channelId?: string): string {
    return `latest_nonce_${userId}_${guildId}_${channelId || 'global'}`;
  }

  /**
   * Creates a cryptographically secure nonce for wallet verification.
   * 
   * Generates a unique, time-limited nonce that prevents replay attacks
   * during the wallet signature verification process. The nonce is stored
   * in cache with automatic expiry.
   * 
   * @param userId - Discord user ID for nonce association
   * @param guildId - Discord guild ID for verification context
   * @param messageId - Optional Discord message ID for verification context
   * @param channelId - Optional Discord channel ID for verification context
   * @returns Promise<string> - The generated nonce string
   * 
   * @example
   * ```typescript
   * const nonce = await nonceService.createNonce('123456789');
   * // Returns: "abc123def456ghi789"
   * ```
   */
  public async createNonce(
    userId: string,
    guildId: string,
    messageId?: string, 
    channelId?: string
  ): Promise<string> {
    const nonce = randomBytes(32).toString('hex');
    const data: NonceData = { userId, guildId, nonce, messageId, channelId,
      expiry: Math.floor((Date.now() + NONCE_EXPIRY) / 1000) };
    await this.cache.set(this.getCacheKey(nonce), data, NONCE_EXPIRY);
    await this.cache.set(
      this.getLatestNonceKey(userId, guildId, channelId),
      nonce,
      NONCE_EXPIRY
    );
    return nonce;
  }

  /**
   * Validates a nonce for secure verification flow.
   * 
   * Checks if the provided nonce matches the stored nonce for the user
   * and hasn't expired. This prevents replay attacks and ensures the
   * verification request is legitimate and timely.
   * 
   * @param userId - Discord user ID to validate nonce for
   * @param guildId - Discord guild ID to validate nonce context for
   * @param nonce - The nonce string to validate
   * @returns Promise<boolean> - True if nonce is valid and not expired
   * 
   * @example
   * ```typescript
   * const isValid = await nonceService.validateNonce('123456789', 'abc123def456');
   * if (isValid) {
   *   // Proceed with verification
   * }
   * ```
   */
  async validateNonce(
    userId: string,
    guildId: string,
    nonce: string
  ): Promise<boolean> {
    const data = await this.cache.get<NonceData>(this.getCacheKey(nonce));
    if (!data || data.nonce !== nonce || data.userId !== userId || data.guildId !== guildId
      || (data.expiry !== undefined && data.expiry * 1000 <= Date.now())) {
      return false;
    }

    const latestNonce = await this.cache.get<string>(
      this.getLatestNonceKey(data.userId, data.guildId, data.channelId)
    );

    return latestNonce === nonce;
  }

  /**
   * Gets the message and channel IDs associated with a specific nonce.
   * @param userId - The ID of the user attempting verification.
   * @param nonce - The nonce from the verification payload.
   * @returns A Promise that resolves to the message and channel IDs, if they exist and belong to the user.
   */
  async getNonceData(userId: string, nonce: string): Promise<{ messageId?: string; channelId?: string }> {
    const data = await this.cache.get<NonceData>(this.getCacheKey(nonce));
    if (!data || data.userId !== userId) return {};
    return { 
      messageId: data.messageId,
      channelId: data.channelId
    };
  }

  /**
   * Invalidates the nonce for a given verification request.
   * @param nonce - The nonce to invalidate.
   * @returns A Promise that resolves when the nonce is invalidated.
   */
  async invalidateNonce(nonce: string): Promise<void> {
    const data = await this.cache.get<NonceData>(this.getCacheKey(nonce));
    if (data) {
      const latestNonceKey = this.getLatestNonceKey(data.userId, data.guildId, data.channelId);
      const latestNonce = await this.cache.get<string>(latestNonceKey);
      if (latestNonce === nonce) {
        await this.cache.del(latestNonceKey);
      }
    }

    await this.cache.del(this.getCacheKey(nonce));
  }

  async getActiveNonce(userId: string, guildId: string, nonce: string): Promise<NonceData> {
    if (!(await this.validateNonce(userId, guildId, nonce))) throw new Error('Invalid or expired nonce.');
    const data = await this.cache.get<NonceData>(this.getCacheKey(nonce));
    if (!data) throw new Error('Invalid or expired nonce.');
    return data;
  }

  async saveBitcoinChallenge(userId: string, guildId: string, nonce: string, challenge: { address: string; message: string }): Promise<void> {
    await this.withNonceLock(nonce, async () => {
      const data = await this.getActiveNonce(userId, guildId, nonce);
      const ttl = (data.expiry || 0) * 1000 - Date.now();
      if (ttl <= 0) throw new Error('Invalid or expired nonce.');
      await this.cache.set(this.getCacheKey(nonce), { ...data, bitcoinChallenge: challenge }, ttl);
    });
  }

  async consumeNonce(userId: string, guildId: string, nonce: string): Promise<NonceData> {
    return this.withNonceLock(nonce, async () => {
      const data = await this.getActiveNonce(userId, guildId, nonce);
      await this.invalidateNonce(nonce);
      return data;
    });
  }

  private async withNonceLock<T>(nonce: string, operation: () => Promise<T>): Promise<T> {
    // The existing nonce cache is local to this bot instance. Reserve before any await.
    if (this.lockedNonces.has(nonce)) throw new Error('Invalid or expired nonce.');
    this.lockedNonces.add(nonce);
    try { return await operation(); }
    finally { this.lockedNonces.delete(nonce); }
  }
}
