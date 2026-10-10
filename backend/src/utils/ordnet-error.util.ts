const UNAVAILABLE = 'Ordinals verification is temporarily unavailable. Please try again.';

/** Only use locally constructed reasons; never include response payloads, tokens, or signing errors. */
export class OrdnetUnavailableError extends Error {
  constructor(reason: string) {
    super(`${UNAVAILABLE} (ord.net: ${reason})`);
  }
}
