export const BOUNCER_LOG_EVENTS = [
  'verification_success', 'verification_failed', 'verification_blocked',
  'wallet_added', 'wallet_removed', 'role_added', 'role_removed',
] as const;
export type BouncerLogKind = typeof BOUNCER_LOG_EVENTS[number];
export type BouncerLogSource = 'discord' | 'portal' | 'background';
export type BouncerLogReason = 'no_assets' | 'provider_unavailable' | 'requirements_changed' | 'verification_failed';
