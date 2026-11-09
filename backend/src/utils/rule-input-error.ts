/** Only trusted, user-facing input guidance belongs here; never wrap provider or database errors. */
export class RuleInputError extends Error {
  constructor(message: string) { super(message); this.name = 'RuleInputError'; }
}
