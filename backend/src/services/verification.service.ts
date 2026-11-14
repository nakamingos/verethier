import { Injectable } from '@nestjs/common';
import { DbService } from './db.service';
import { VerificationEngine, BulkVerificationResult } from './verification-engine.service';
import { VerifierRole } from '@/models/verifier-role.interface';
import { NftCheckContext } from './nft-ownership.service';

/**
 * VerificationService
 *
 * Thin facade used by VerifyService: rule lookups come from the database and
 * ownership checks are delegated to the VerificationEngine.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly dbSvc: DbService,
    private readonly verificationEngine: VerificationEngine,
  ) {}

  async finishWalletChecks(context: NftCheckContext): Promise<void> {
    await this.verificationEngine.finishWalletChecks?.(context);
  }

  /**
   * Verify a user against multiple rules using the VerificationEngine
   *
   * @param userId - Discord user ID
   * @param ruleIds - Array of rule IDs to verify against
   * @param address - Wallet address to verify
   * @returns Promise<BulkVerificationResult> with results for all rules
   */
  async verifyUserBulk(
    userId: string,
    ruleIds: (string | number)[],
    address: string,
    context?: NftCheckContext,
    loadedRules?: VerifierRole[]
  ): Promise<BulkVerificationResult> {
    if (context || loadedRules) return this.verificationEngine.verifyUserBulk(userId, ruleIds, address, loadedRules, context);
    return await this.verificationEngine.verifyUserBulk(userId, ruleIds, address);
  }

  /**
   * Get all rules for a server
   */
  async getAllRulesForServer(serverId: string): Promise<VerifierRole[]> {
    return await this.dbSvc.getRoleMappings(serverId);
  }

  /**
   * Get rules for a specific channel
   */
  async getRulesForChannel(serverId: string, channelId: string): Promise<VerifierRole[]> {
    return await this.dbSvc.getRulesByChannel(serverId, channelId);
  }
}
