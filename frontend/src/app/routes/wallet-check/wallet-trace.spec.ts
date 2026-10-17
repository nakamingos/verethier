import { safeWalletError, traceWalletClient } from './wallet-trace';

describe('Wallet connection diagnostics', () => {
  it('keeps readable errors while removing pairing links, credentials, topics, and addresses', () => {
    const topic = 'a'.repeat(64);
    const address = '0x' + 'b'.repeat(40);
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
    const report = safeWalletError(new Error(`No matching key ${topic}; ${address}; wc:${topic}@2?symKey=secret; https://relay.test/?auth=private ${token}\nextra details`));
    expect(report).toContain('No matching key');
    for (const secret of [topic, address, token, 'secret', 'private', 'extra details']) expect(report).not.toContain(secret);
    expect(safeWalletError({ message: 'Network failed' })).toBe('Network failed');
    const encrypted = 'Zm9vYmFy'.repeat(20);
    expect(safeWalletError(`Inbound message failed: ${encrypted}`)).not.toContain(encrypted);
    expect(safeWalletError('Cannot open rainbow://wc?uri=wc%3Aprivate')).not.toContain('private');
  });

  it('reports protocol stages without exporting encrypted messages or session objects', () => {
    const listeners = new Map<string, Function>();
    const relay = {
      connected: true,
      on: (event: string, listener: Function) => listeners.set(event, listener),
      off: (event: string) => listeners.delete(event),
    };
    const client = {
      core: { relayer: relay },
      on: (event: string, listener: Function) => listeners.set(event, listener),
      off: (event: string) => listeners.delete(event),
    } as unknown as Parameters<typeof traceWalletClient>[0];
    const stages: string[] = [];
    const stop = traceWalletClient(client, stage => stages.push(stage));
    listeners.get('relayer_message')!({ topic: 'private-topic', message: 'encrypted-payload' });
    listeners.get('session_connect')!({ session: { topic: 'private-session', accounts: ['private-address'] } });
    listeners.get('session_request_sent')!({ topic: 'private-session', request: { method: 'eth_signTypedData_v4', params: ['private-address', 'private-message'] } });
    listeners.get('session_request_sent')!({ request: { method: 'private-method', params: ['private-payload'] } });
    listeners.get('session_request_expire')!({ id: 'private-request' });
    listeners.get('session_delete')!({ topic: 'private-session' });
    listeners.get('session_expire')!({ topic: 'private-session' });
    expect(stages).toEqual(['Relay already connected', 'Encrypted relay message received', 'Wallet session established',
      'Typed-data signature request sent to relay', 'Wallet request sent to relay', 'Wallet request expired',
      'Wallet session deleted', 'Wallet session expired']);
    expect(stages.join(' ')).not.toContain('private');
    expect(stages.join(' ')).not.toContain('payload');
    stop();
    expect(listeners.size).toBe(0);
  });
});
