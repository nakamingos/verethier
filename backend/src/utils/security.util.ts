import { CONSTANTS } from '@/constants';

/**
 * Security utility functions for the application
 * Provides centralized error-message sanitization
 */
export class SecurityUtil {
  /**
   * Sanitize error messages to prevent information disclosure
   * @param error The error to sanitize
   * @param isProduction Whether we're in production mode
   * @returns Sanitized error message
   */
  static sanitizeErrorMessage(error: unknown, isProduction = process.env.NODE_ENV === 'production'): string {
    if (!isProduction) {
      return error instanceof Error ? error.message : 'Unknown error occurred';
    }

    // In production, return generic error messages for most cases
    const userFriendlyErrors = [
      'does not own the required assets',
      'does not own any assets', 
      'No verification rules found',
      'This verification link has expired',
      'Invalid signature',
      'Invalid Bitcoin signature',
      'Invalid Solana signature',
      'Invalid Solana verification challenge',
      'Invalid Bitcoin verification challenge',
      'Collection verification is temporarily unavailable',
      'Signature verification failed',
      CONSTANTS.ERRORS.WALLET_ADDRESS_ALREADY_VERIFIED,
      'Not allowed by CORS',
      'Validation failed'
    ];

    const errorMessage = error instanceof Error ? error.message : '';
    const isUserFriendly = userFriendlyErrors.some(pattern => 
      errorMessage.includes(pattern)
    );

    return isUserFriendly ? errorMessage : 'An error occurred while processing your request';
  }

  /**
   * Check if we should log detailed information based on environment
   * @returns Whether detailed logging is allowed
   */
  static shouldLogDetails(): boolean {
    return process.env.NODE_ENV === 'development';
  }
}
