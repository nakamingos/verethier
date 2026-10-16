import type SignClient from '@walletconnect/sign-client';

// Diagnostic exports contain stages and readable errors, never pairing links,
// session topics, wallet addresses, message payloads, or verification nonces.
export function safeWalletError(error: unknown): string {
  const message = error instanceof Error ? error.message
    : typeof error === 'string' ? error
    : error && typeof error === 'object' && 'message' in error ? String(error.message)
    : 'Unknown wallet connection error';
  return message
    .replace(/(?:https?:\/\/|wss?:\/\/|rainbow:\/\/|wc:)[^\s"'<>]+/gi, '[link]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
    .replace(/\b(?:0x)?[a-f0-9]{40,}\b/gi, '[identifier]')
    .replace(/[A-Za-z0-9+/_-]{80,}={0,2}/g, '[encoded data]')
    .split('\n')[0].slice(0, 240);
}

export function traceWalletClient(client: Pick<SignClient, 'core' | 'on' | 'off'>, record: (stage: string) => void): () => void {
  const relay = client.core.relayer;
  const bindings: Array<[string, (...args: any[]) => void]> = [
    ['relayer_connect', () => record('Relay connected')],
    ['relayer_disconnect', () => record('Relay disconnected')],
    ['relayer_connection_stalled', () => record('Relay connection stalled')],
    ['relayer_error', error => record(`Relay error: ${safeWalletError(error)}`)],
    ['relayer_message', () => record('Encrypted relay message received')],
  ];
  bindings.forEach(([event, listener]) => relay.on(event, listener));
  const expired = () => record('Wallet proposal expired');
  const connected = () => record('Wallet session established');
  client.on('proposal_expire', expired);
  client.on('session_connect', connected);
  record(relay.connected ? 'Relay already connected' : 'Relay not connected yet');
  return () => {
    bindings.forEach(([event, listener]) => relay.off(event, listener));
    client.off('proposal_expire', expired);
    client.off('session_connect', connected);
  };
}
