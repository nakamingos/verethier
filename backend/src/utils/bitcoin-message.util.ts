/**
 * Short Bitcoin sign-in messages. Members may copy them into a wallet by hand
 * (Freewallet and others), so they carry only what the signature must bind:
 * purpose, site, address, a code from the one-time nonce, the expiry and,
 * when present, the privacy-choice commitment. The server stores the exact
 * message it issued and verifies against it.
 */
export function bitcoinMessage(input: {
  purpose: 'verify' | 'link';
  origin: string;
  address: string;
  nonce: string;
  expiry: number;
  consent?: string;
}): string {
  if (!/^[0-9a-f]{32,}$/i.test(input.nonce)) throw new Error('Invalid verification nonce.');
  const expires = new Date(input.expiry * 1000).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  return [
    input.purpose === 'verify' ? 'Bouncer verification' : 'Bouncer wallet link',
    `Site: ${input.origin}`,
    `Address: ${input.address}`,
    // 128 bits of the one-time nonce keep each message unique without the full value.
    `Code: ${input.nonce.slice(0, 32).toLowerCase()}`,
    `Expires: ${expires}`,
    ...(input.consent ? [`Consent: ${input.consent.replace(/^0x/, '').slice(0, 32)}`] : []),
  ].join('\n');
}
