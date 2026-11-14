import { ValidationPipeOptions } from '@nestjs/common';
import { EnvironmentConfig } from './environment.config';

/** Global request validation. Shared by main.ts and tests so they cannot drift. */
export const validationPipeOptions = (): ValidationPipeOptions => ({
  whitelist: true, // Strip unknown properties for security
  forbidNonWhitelisted: true, // Reject unknown properties
  transform: true,
  disableErrorMessages: EnvironmentConfig.NODE_ENV === 'production',
  skipMissingProperties: false, // Enforce required properties
});
