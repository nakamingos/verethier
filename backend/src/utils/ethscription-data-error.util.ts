/** Shared provider failure: DataService already logged the failed read once. */
export class EthscriptionDataUnavailableError extends Error {
  constructor() {
    super('Ethscriptions verification is temporarily unavailable. Please try again.');
    this.name = 'EthscriptionDataUnavailableError';
  }
}
