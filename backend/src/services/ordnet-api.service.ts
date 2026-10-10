import { Injectable } from '@nestjs/common';
import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { Signer, Verifier, Address } from 'bip322-js';
import { EnvironmentConfig } from '@/config/environment.config';
import { normalizeBitcoinAddress } from '@/utils/wallet-address.util';
import { OrdnetUnavailableError } from '@/utils/ordnet-error.util';

const API_URL = 'https://ord.net/api/v1';
const REQUEST_GAP = 2100; // ord.net permits 30 trading reads per profile per minute.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validToken = (value: unknown): value is string => typeof value === 'string' && /^[\x21-\x7e]{1,4096}$/.test(value);

class OrdnetUnauthorized extends Error {}

/** The service only exposes documented read endpoints and wallet authentication. */
@Injectable()
export class OrdnetApiService {
  private requestTail: Promise<unknown> = Promise.resolve();
  private session?: { token: string; expires: number };
  private authentication?: Promise<string>;

  async get(path: string): Promise<any> {
    if (!/^\/collection\/[a-z0-9][a-z0-9._-]{0,99}\/inscriptions\?/.test(path)
      && !/^\/collection-stats\/floors\?/.test(path)) throw new Error('Unsupported ord.net read endpoint.');
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getToken();
      try { return await this.request(path, { token }); }
      catch (error) {
        if (!(error instanceof OrdnetUnauthorized)) throw error;
        if (EnvironmentConfig.ORDNET_SESSION_TOKEN) {
          throw new Error('ord.net session token is invalid or expired. Update ORDNET_SESSION_TOKEN, or configure an automatic API wallet.');
        }
        if (this.session?.token === token) this.session = undefined;
        if (attempt === 1) throw new OrdnetUnavailableError('read session rejected after automatic renewal');
      }
    }
    throw new OrdnetUnavailableError('read session could not be established');
  }

  private async getToken(): Promise<string> {
    if (EnvironmentConfig.ORDNET_SESSION_TOKEN) {
      if (!validToken(EnvironmentConfig.ORDNET_SESSION_TOKEN)) throw new Error('Invalid ORDNET_SESSION_TOKEN configuration.');
      return EnvironmentConfig.ORDNET_SESSION_TOKEN;
    }
    if (this.session && this.session.expires > Date.now() + 30000) return this.session.token;
    if (!this.authentication) {
      this.authentication = this.authenticate();
      // Share a renewal across concurrent collection reads. Never retain a failed login.
      this.authentication.then(() => { this.authentication = undefined; }, () => { this.authentication = undefined; });
    }
    return this.authentication;
  }

  private async authenticate(): Promise<string> {
    let ordinalsAddress: string;
    let paymentAddress: string;
    const ordinalsWif = EnvironmentConfig.ORDNET_ORDINALS_WIF;
    const paymentWif = EnvironmentConfig.ORDNET_PAYMENT_WIF || ordinalsWif;
    if (!ordinalsWif || !EnvironmentConfig.ORDNET_ORDINALS_ADDRESS || !EnvironmentConfig.ORDNET_PAYMENT_ADDRESS) {
      throw new Error('ord.net verification is not configured. Set ORDNET_SESSION_TOKEN, or ORDNET_ORDINALS_ADDRESS, ORDNET_PAYMENT_ADDRESS and ORDNET_ORDINALS_WIF on the backend.');
    }
    try {
      ordinalsAddress = normalizeBitcoinAddress(EnvironmentConfig.ORDNET_ORDINALS_ADDRESS);
      paymentAddress = this.signingAddress(EnvironmentConfig.ORDNET_PAYMENT_ADDRESS);
      // Check that the supplied keys control these addresses before contacting the API.
      for (const [address, wif] of [[ordinalsAddress, ordinalsWif], [paymentAddress, paymentWif]]) {
        if (!/^[KL][1-9A-HJ-NP-Za-km-z]{51}$/.test(wif)
          || !Verifier.verifySignature(address, 'Verethier ord.net API wallet configuration', Signer.sign(wif, address, 'Verethier ord.net API wallet configuration'))) throw new Error();
      }
    } catch { throw new Error('Invalid ord.net API wallet configuration. Check the mainnet addresses and their compressed WIF keys.'); }

    const challenge = await this.request('/auth/challenge', { body: { ordinalsAddress, paymentAddress } });
    if (!UUID.test(challenge?.authRequestId) || !Array.isArray(challenge.challenges)
      || challenge.challenges.length < 1 || challenge.challenges.length > 2) throw new OrdnetUnavailableError('auth/challenge returned an invalid response');
    const signedAddresses = new Set<string>();
    const challengeIds = new Set<string>();
    const verifications = challenge.challenges.map(entry => {
      const address = entry?.role === 'ordinals' ? ordinalsAddress : entry?.role === 'payment' ? paymentAddress : undefined;
      if (!address || entry.address !== address || !UUID.test(entry.challengeId) || challengeIds.has(entry.challengeId)
        || !this.isLoginMessage(entry.message, address)) throw new Error('Invalid ord.net wallet authentication challenge.');
      challengeIds.add(entry.challengeId);
      signedAddresses.add(address);
      try {
        const signature = Signer.sign(entry.role === 'ordinals' ? ordinalsWif : paymentWif, address, entry.message);
        if (!Verifier.verifySignature(address, entry.message, signature)) throw new Error();
        return { challengeId: entry.challengeId, address, signature: Buffer.from(signature, 'base64').toString('hex') };
      } catch { throw new Error('Could not sign the ord.net API wallet challenge. Check the configured wallet keys.'); }
    });
    if (![ordinalsAddress, paymentAddress].every(address => signedAddresses.has(address))) throw new Error('Incomplete ord.net wallet authentication challenge.');
    const data = await this.request('/auth/verify', { body: { authRequestId: challenge.authRequestId, verifications } });
    const expires = Date.parse(data?.expiresAt);
    if (!validToken(data?.sessionToken) || !Number.isFinite(expires) || expires <= Date.now() + 30000
      || !Array.isArray(data.walletBindings) || !data.walletBindings.some(binding => binding.ordinalsAddress === ordinalsAddress && binding.paymentAddress === paymentAddress)) throw new OrdnetUnavailableError('auth/verify returned an invalid session or wallet binding');
    this.session = { token: data.sessionToken, expires: Math.min(expires, Date.now() + 3600000) };
    return this.session.token;
  }

  private isLoginMessage(message: unknown, address: string): message is string {
    if (typeof message !== 'string' || !message.length || message.length > 8192) return false;
    // Retain the format shown in the public docs while validating the live API's login envelope.
    if (message.startsWith('Sign in to ord.net at ')) return true;
    const lines = message.split(/\r?\n/);
    if (lines.length !== 6 || lines[0] !== 'ORD.NET wallet verification'
      || lines[1] !== 'Domain: ord.net' || lines[2] !== `Address: ${address}`
      || !/^Nonce: [0-9a-f]{32,128}$/i.test(lines[3])
      || !lines[4].startsWith('Issued At: ') || !lines[5].startsWith('Expiration Time: ')) return false;
    const issued = Date.parse(lines[4].slice('Issued At: '.length));
    const expires = Date.parse(lines[5].slice('Expiration Time: '.length));
    return Number.isFinite(issued) && Number.isFinite(expires)
      && issued <= Date.now() + 60000 && expires > Date.now() && expires > issued;
  }

  private signingAddress(value: string): string {
    if (value !== value.trim()) throw new Error();
    bitcoinAddress.toOutputScript(value, networks.bitcoin);
    if (!Address.isP2WPKH(value) && !Address.isP2TR(value) && !Address.isP2SH(value)) throw new Error();
    return /^bc1/i.test(value) ? value.toLowerCase() : value;
  }

  private request(path: string, options: { token?: string; body?: object }): Promise<any> {
    const queuedAt = Date.now();
    const route = `${options.body ? 'POST' : 'GET'} ${path.split('?')[0]}`;
    const result = this.requestTail.then(async () => {
      if (Date.now() - queuedAt > 45000) throw new OrdnetUnavailableError(`${route}: request queue exceeded 45 seconds`);
      const attempts = options.body ? 1 : 3; // Failed auth flows must start with a fresh challenge.
      let failure = 'network request failed';
      for (let attempt = 0; attempt < attempts; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let retryDelay = REQUEST_GAP * (attempt + 1);
        try {
          const response = await fetch(API_URL + path, {
            method: options.body ? 'POST' : 'GET',
            headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}),
              ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
            ...(options.body ? { body: JSON.stringify(options.body) } : {}),
            signal: controller.signal, redirect: 'error',
          });
          if (response.ok) return await response.json();
          failure = `HTTP ${response.status}`;
          if (response.status === 401 && !options.body) throw new OrdnetUnauthorized();
          if (response.status === 403 && options.body) throw new Error('ord.net rejected the API wallet. Its payment address must hold at least 0.001 BTC confirmed and be eligible for API access.');
          if (response.status === 404 && !options.body) throw new Error('This collection was not found on ord.net. Check its collection slug.');
          if (options.body || (response.status !== 429 && response.status < 500)) throw new OrdnetUnavailableError(`${route}: ${failure}`);
          if (response.status === 429) {
            const body = await response.json().catch(() => ({}));
            const seconds = Number(response.headers.get('retry-after'));
            const delay = Math.max(Number.isFinite(seconds) ? seconds * 1000 : 0,
              Number.isSafeInteger(body?.retryAfterMs) ? body.retryAfterMs : 0);
            // Do not retry early when the provider asks for a wait beyond this request's budget.
            if (delay > 15000) throw new OrdnetUnavailableError(`${route}: rate limit requires ${Math.ceil(delay / 1000)} seconds before retry`);
            retryDelay = Math.max(retryDelay, delay);
          }
        } catch (error) {
          if (error instanceof OrdnetUnauthorized || error instanceof OrdnetUnavailableError
            || error.message?.startsWith('ord.net rejected') || error.message?.includes('not found on ord.net')) throw error;
          failure = error?.name === 'AbortError' ? 'request timed out' : error?.name === 'SyntaxError' ? 'invalid JSON response' : 'network request failed';
          if (attempt === attempts - 1) throw new OrdnetUnavailableError(`${route}: ${failure}`);
        } finally { clearTimeout(timeout); }
        if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
      throw new OrdnetUnavailableError(`${route}: ${failure} after ${attempts} attempts`);
    });
    this.requestTail = result.catch(() => undefined).then(() => new Promise(resolve => setTimeout(resolve, REQUEST_GAP)));
    return result;
  }
}
