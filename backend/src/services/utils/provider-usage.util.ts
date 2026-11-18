/**
 * In-memory tally of billed Ordinals API calls, so Xverse and Ordiscan usage
 * can be read from the logs. Counts reset on restart; nothing is persisted.
 */
const counts = new Map<string, number>();

export type UsageProvider = 'xverse' | 'ordiscan';

/** Records one outgoing HTTP request, including retries, since each is billed. */
export function recordProviderCall(provider: UsageProvider, kind: string, priority: 'interactive' | 'background'): void {
  const key = `${provider} ${kind} ${priority}`;
  counts.set(key, (counts.get(key) || 0) + 1);
}

/** Returns and clears the calls recorded since the previous call. */
export function takeProviderUsage(): Map<string, number> {
  const snapshot = new Map(counts);
  counts.clear();
  return snapshot;
}

/** Names an Xverse API path by what it reads, without the wallet address. */
export function xverseCallKind(path: string): string {
  if (path.startsWith('/v1/inscriptions/batch')) return 'batch-owners';
  if (path.startsWith('/v1/ordinals/collections/')) return 'collection-info';
  if (/^\/v1\/ordinals\/address\/[^/]+\/inscriptions\/collection\//.test(path)) return 'wallet-collection-items';
  if (/^\/v1\/ordinals\/address\/[^/]+\/collections/.test(path)) return 'wallet-collections';
  if (/^\/v1\/ordinals\/address\/[^/]+\/inscriptions/.test(path)) return 'wallet-inventory';
  return 'other';
}

/** Names an Ordiscan URL by what it reads, without the wallet address. */
export function ordiscanCallKind(url: string): string {
  if (url.includes('/inscription-ids')) return 'wallet-ids';
  if (url.includes('/inscriptions')) return 'wallet-inventory';
  return 'other';
}

/** Formats a tally as "xverse 12 (wallet-inventory 10 background, ...)" per provider. */
export function formatProviderUsage(usage: Map<string, number>): string {
  const providers = new Map<string, { total: number; parts: string[] }>();
  for (const [key, count] of [...usage].sort(([a], [b]) => a.localeCompare(b))) {
    const [provider, kind, priority] = key.split(' ');
    const entry = providers.get(provider) || { total: 0, parts: [] };
    entry.total += count;
    entry.parts.push(`${kind} ${priority} ${count}`);
    providers.set(provider, entry);
  }
  return [...providers].map(([provider, { total, parts }]) => `${provider} ${total} (${parts.join(', ')})`).join('; ');
}
