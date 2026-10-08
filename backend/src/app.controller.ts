import { Body, Controller, Post, Get, HttpException, HttpStatus, Logger, Optional } from '@nestjs/common';

import { AppService } from './app.service';
import { CONSTANTS } from './constants';
import { VerifyService } from './services/verify.service';
import { VerifySignatureDto } from './dtos/verify-signature.dto';
import { DecodedData } from './models/app.interface';
import { SecurityUtil } from './utils/security.util';
import { BitcoinSignatureService } from './services/bitcoin-signature.service';
import { BitcoinChallengeDto, VerificationContextDto } from './dtos/wallet-context.dto';

/**
 * AppController
 * 
 * Main REST API controller for the verification system.
 * Provides the primary endpoint for wallet signature verification.
 * 
 * Handles secure communication between the frontend verification interface
 * and the backend verification services.
 */
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly verifySvc: VerifyService,
    @Optional() private readonly bitcoinSvc?: BitcoinSignatureService
  ) {}

  /**
   * Application health check endpoint
   * 
   * Provides basic health and status information for monitoring and debugging.
   * Useful for load balancers, monitoring systems, and development diagnostics.
   * 
   * @returns Object containing health status, timestamp, environment, and version
   */
  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  /**
   * Application information endpoint
   * 
   * Returns metadata about the application including features, architecture,
   * and capabilities. Useful for API consumers to understand system capabilities.
   * 
   * @returns Object containing application name, description, architecture, and features
   */
  @Get('info')
  getInfo() {
    return this.appService.getInfo();
  }

  /**
   * Verifies a wallet signature and processes role assignment.
   * 
   * The flow includes:
   * 1. Validate the request structure using DTO validation
   * 2. Transform the payload to match internal interfaces
   * 3. Delegate to VerifyService for signature verification and role assignment
   * 4. Return success result or handle errors gracefully
   * 
   * Security considerations:
   * - All errors are logged but sanitized before returning to prevent information disclosure
   * - Generic error messages are returned to avoid exposing internal system details
   * - Input validation is handled by class-validator decorators on the DTO
   * 
   * @param body - The verification request containing data and signature
   * @returns Promise<{message: string, address: string, assignedRoles: string[]}> - Verification result
   * @throws HttpException with appropriate status codes for various error conditions
   */
  @Post('verify-signature')
  async verify(@Body() body: VerifySignatureDto) {
    try {
      // Transform DTO data to match expected DecodedData interface
      const decodedData = {
        address: body.data.address || '',
        ...(body.data.walletType !== undefined ? { walletType: body.data.walletType } : {}),
        userId: body.data.userId || '',
        userTag: body.data.userTag || '',
        avatar: body.data.avatar || '',
        discordId: body.data.discordId || '',
        discordName: body.data.discordName || '',
        discordIcon: body.data.discordIconURL || body.data.discordIcon || '',
        nonce: body.data.nonce || '',
        expiry: body.data.expiry || 0,
      };

      // Delegate to VerifyService for the complete verification and role assignment flow
      const result = await this.verifySvc.verifySignatureFlow(
        decodedData,
        body.signature
      );
      return result;
    } catch (error) {
      // Log detailed error information for debugging and monitoring
      const errorMessage = SecurityUtil.sanitizeErrorMessage(error, false); // Always get details for logging
      
      // Only log stack traces in development
      if (SecurityUtil.shouldLogDetails()) {
        const errorStack = error?.stack || '';
        Logger.error(`Verification error: ${errorMessage}`, errorStack);
      } else {
        Logger.error(`Verification error: ${errorMessage}`);
      }
      
      // Preserve HTTP exceptions with their intended status codes
      if (error instanceof HttpException) {
        throw error;
      }
      
      // Check if this is a user-friendly verification error that should be shown to the user
      if (errorMessage.includes('Invalid or expired nonce.')) {
        throw new HttpException(
          'This verification link is no longer active. Please return to Discord and request a new one.',
          HttpStatus.BAD_REQUEST
        );
      }

      const userFriendlyErrors = [
        'does not own the required assets',
        'does not own any assets',
        'No verification rules found',
        'This verification link has expired',
        'Invalid signature',
        'Invalid Bitcoin signature',
        'Invalid Bitcoin verification challenge',
        'Collection verification is temporarily unavailable',
        'Signature verification failed',
        CONSTANTS.ERRORS.WALLET_ADDRESS_ALREADY_VERIFIED
      ];
      
      const isUserFriendlyError = userFriendlyErrors.some(pattern => 
        errorMessage.includes(pattern)
      );
      
      if (isUserFriendlyError) {
        // Return user-friendly verification errors with BAD_REQUEST status
        throw new HttpException(
          SecurityUtil.sanitizeErrorMessage(error), // Use sanitized message for response
          HttpStatus.BAD_REQUEST
        );
      }
      
      // Convert unexpected errors to generic 500 responses to avoid information disclosure
      throw new HttpException(
        'Verification failed. Please try again.',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('verification-context')
  async verificationContext(@Body() body: VerificationContextDto) {
    try { return await this.bitcoinSvc.getContext(body.userId, body.discordId, body.nonce); }
    catch { throw new HttpException('This verification link is no longer active. Please return to Discord and request a new one.', HttpStatus.BAD_REQUEST); }
  }

  @Post('bitcoin-challenge')
  async bitcoinChallenge(@Body() body: BitcoinChallengeDto) {
    try { return await this.bitcoinSvc.createChallenge(body.userId, body.discordId, body.nonce, body.address); }
    catch (error) {
      throw new HttpException(error.message?.startsWith('Use ') ? error.message : 'Could not create the Bitcoin verification message. Please return to Discord and request a new link.', HttpStatus.BAD_REQUEST);
    }
  }
}
