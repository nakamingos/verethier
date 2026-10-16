// Public Reown project ID. Its origin allowlist must include the deployed frontend.
export const projectId = 'de9770bd24af8a4e743551a95c3cde67';

export function evmWalletMetadata() {
  return {
    name: 'Bouncer',
    description: 'Verify your wallet. Get your roles.',
    url: window.location.origin,
    icons: [new URL('/assets/bouncer.svg', window.location.origin).href],
  };
}
