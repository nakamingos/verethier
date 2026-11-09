/** Expected server policy outcome, rather than a Discord/provider failure. */
export class RoleExcludedError extends Error {
  constructor() {
    super('This role is excluded by another role you hold in this server.');
    this.name = 'RoleExcludedError';
  }
}
