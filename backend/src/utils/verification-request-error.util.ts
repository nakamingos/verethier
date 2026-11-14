/** A verification-request refusal whose message is written for the member. */
export class VerificationRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationRequestError';
  }
}

/** Shown for any other failure, so internal or provider details never reach Discord. */
export const VERIFICATION_REQUEST_UNAVAILABLE = 'Could not start verification right now. Please try again shortly.';
