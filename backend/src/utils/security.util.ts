import { CONSTANTS } from '@/constants';

/**
 * Security utility functions for the application
 * Provides centralized security features and data sanitization
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
   * Mask sensitive data in logs
   * @param data The data to mask
   * @param fieldsToMask Fields that should be masked
   * @returns Data with sensitive fields masked
   */
  static maskSensitiveData(data: Record<string, unknown>, fieldsToMask: string[] = ['token', 'key', 'secret', 'password']): Record<string, unknown> {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const masked = { ...data };
    fieldsToMask.forEach(field => {
      if (field in masked) {
        const value = masked[field];
        if (typeof value === 'string' && value.length > 0) {
          masked[field] = value.length > 8 
            ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
            : '***';
        }
      }
    });

    return masked;
  }

  /**
   * Validate that a string contains only safe characters
   * @param input The input to validate
   * @param allowedPattern Regex pattern for allowed characters
   * @returns Whether the input is safe
   */
  static isStringSafe(input: string, allowedPattern: RegExp = /^[a-zA-Z0-9\s\-_@#\.]*$/): boolean {
    return allowedPattern.test(input);
  }

  /**
   * Remove potentially dangerous characters from user input
   * @param input The input to sanitize
   * @returns Sanitized input
   */
  static sanitizeUserInput(input: string): string {
    return input
      .replace(/[<>\"'&]/g, '') // Remove common XSS characters
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+=/gi, '') // Remove event handlers
      .trim();
  }

  /**
   * Check if we should log detailed information based on environment
   * @returns Whether detailed logging is allowed
   */
  static shouldLogDetails(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  /**
   * Generate a safe error response for APIs
   * @param error The original error
   * @param defaultMessage Default message to show if error is not user-friendly
   * @returns Safe error response
   */
  static createSafeErrorResponse(error: unknown, defaultMessage = 'An error occurred'): { message: string } {
    return {
      message: this.sanitizeErrorMessage(error, process.env.NODE_ENV === 'production') || defaultMessage
    };
  }
}
