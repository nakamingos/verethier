import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Signer } from 'bip322-js';
import { payments } from 'bitcoinjs-lib';
import { secp256k1 } from '@noble/curves/secp256k1';
import { encode } from 'wif';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { VerifyService } from '../src/services/verify.service';
import { MemberService } from '../src/portal/member.service';
import { SolanaSignatureService } from '../src/services/solana-signature.service';
import { BitcoinSignatureService } from '../src/services/bitcoin-signature.service';
import { BitcoinRelayService } from '../src/services/bitcoin-relay.service';
import { corsDelegate } from '../src/config/cors.config';
import { bitcoinMessage } from '../src/utils/bitcoin-message.util';
import { validationPipeOptions } from '../src/config/validation.config';

const secret = new Uint8Array(32); secret[31] = 1;
const pubkey = secp256k1.getPublicKey(secret, true);
const key = encode({ version: 128, privateKey: secret, compressed: true });
const legacy = payments.p2pkh({ pubkey }).address!;
const native = payments.p2wpkh({ pubkey }).address!;
const challenge = (address: string) => bitcoinMessage({ purpose: 'verify', origin: 'https://bouncer.test', address, nonce: 'ab'.repeat(32), expiry: 1_900_000_000 });
// Freewallet signs with the legacy compact format for every address type.
const freewalletSign = (message: string) => Signer.sign(key, legacy, message);

describe('Bitcoin signing relay', () => {
  let relay: BitcoinRelayService;
  beforeEach(() => (relay = new BitcoinRelayService(new BitcoinSignatureService(undefined as any, undefined as any))));
  afterEach(() => jest.restoreAllMocks());

  it('carries a valid signature for the requested address and message', () => {
    const message = challenge(native);
    const { id } = relay.create(native, message);
    expect(id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(relay.read(id)).toBeNull();
    relay.deliver(id, native, `${freewalletSign(message)}\n`);
    expect(relay.read(id)).toBe(freewalletSign(message));
  });

  it('only relays Bouncer challenges for the stated address', () => {
    expect(() => relay.create(native, 'Sign anything\nAddress: ' + native + '\n')).toThrow();
    expect(() => relay.create(native, challenge(legacy))).toThrow();
    expect(() => relay.create('not-an-address', challenge(native))).toThrow();
    expect(relay.create(legacy, bitcoinMessage({ purpose: 'link', origin: 'https://bouncer.test', address: legacy, nonce: 'cd'.repeat(32), expiry: 1_900_000_000 })).id).toBeTruthy();
    // Challenges issued just before this release still use the long format.
    expect(relay.create(legacy, `Bouncer saved-wallet link\n\nAddress: ${legacy}\nNonce: abc`).id).toBeTruthy();
  });

  it('rejects wrong signatures, other addresses and unknown requests', () => {
    const message = challenge(native);
    const { id } = relay.create(native, message);
    expect(() => relay.deliver(id, native, freewalletSign(message + 'x'))).toThrow();
    expect(() => relay.deliver(id, legacy, freewalletSign(message))).toThrow();
    expect(() => relay.deliver('unknown', native, freewalletSign(message))).toThrow();
    expect(relay.read(id)).toBeNull();
    expect(relay.read('unknown')).toBeUndefined();
  });

  it('expires requests after fifteen minutes', () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const message = challenge(native);
    const { id } = relay.create(native, message);
    clock.mockReturnValue(now + 15 * 60 * 1000);
    expect(relay.read(id)).toBeUndefined();
    expect(() => relay.deliver(id, native, freewalletSign(message))).toThrow();
  });
});

describe('Short Bitcoin messages', () => {
  const base = { origin: 'https://bouncer.test', address: native, nonce: 'ab'.repeat(32), expiry: 1_900_000_000 };
  it('distinguishes verification from wallet linking and binds a nonce code and expiry', () => {
    expect(bitcoinMessage({ ...base, purpose: 'verify' })).toBe(
      `Bouncer verification\nSite: https://bouncer.test\nAddress: ${native}\nCode: ${'ab'.repeat(16)}\nExpires: 2030-03-17 17:46:40 UTC`);
    expect(bitcoinMessage({ ...base, purpose: 'link' }).split('\n')[0]).toBe('Bouncer wallet link');
    expect(bitcoinMessage({ ...base, purpose: 'verify', consent: '0x' + 'ef'.repeat(32) })).toMatch(/\nConsent: (ef){16}$/);
    expect(() => bitcoinMessage({ ...base, purpose: 'verify', nonce: 'short' })).toThrow();
  });
});

describe('Bitcoin relay HTTP', () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    const signatures = new BitcoinSignatureService(undefined as any, undefined as any);
    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: AppService, useValue: {} }, { provide: VerifyService, useValue: {} },
        { provide: MemberService, useValue: {} }, { provide: SolanaSignatureService, useValue: {} },
        { provide: BitcoinSignatureService, useValue: signatures },
        { provide: BitcoinRelayService, useValue: new BitcoinRelayService(signatures) },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe(validationPipeOptions()));
    app.enableCors(corsDelegate(['https://bouncer.test']));
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1') + '/api';
  });
  afterAll(() => app.close());

  it('accepts Freewallet\'s form post from its app origin and hands the signature to the page', async () => {
    const message = challenge(native);
    const created = await fetch(base + '/bitcoin-relay', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://bouncer.test' },
      body: JSON.stringify({ address: native, message }),
    });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect((await (await fetch(`${base}/bitcoin-relay/${id}`)).json()).signature).toBeNull();
    // jQuery's $.ajax sends a form body; NW.js pages carry a non-web origin.
    const delivered = await fetch(`${base}/bitcoin-relay/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Origin: 'chrome-extension://freewallet' },
      body: new URLSearchParams({ address: native, message, signature: freewalletSign(message) }).toString(),
    });
    expect(delivered.status).toBe(204);
    expect(delivered.headers.get('access-control-allow-origin')).toBeNull();
    expect((await (await fetch(`${base}/bitcoin-relay/${id}`)).json()).signature).toBe(freewalletSign(message));
  });

  it('rejects a bad delivery and reports unknown requests', async () => {
    const response = await fetch(`${base}/bitcoin-relay/unknown`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ signature: 'abc' }).toString(),
    });
    expect(response.status).toBe(400);
    expect((await fetch(`${base}/bitcoin-relay/unknown`)).status).toBe(404);
  });

  it('keeps other routes closed to unknown origins', async () => {
    const response = await fetch(base + '/bitcoin-relay', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' },
      body: JSON.stringify({ address: native, message: challenge(native) }),
    });
    expect(response.status).toBe(500);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
