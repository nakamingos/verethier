import { BitcoinSignatureService } from '../src/services/bitcoin-signature.service';
import { NonceService } from '../src/services/nonce.service';
import { normalizeBitcoinAddress, normalizeBitcoinProofAddress } from '../src/utils/wallet-address.util';
import { normalizeBlockedWallet } from '../src/services/wallet-block.service';
import { EnvironmentConfig } from '../src/config/environment.config';
import { Signer } from 'bip322-js';
import { payments } from 'bitcoinjs-lib';
import { secp256k1 } from '@noble/curves/secp256k1';
import { encode } from 'wif';
import vectors from './fixtures/bip322-segwit.json';
const secret=new Uint8Array(32);secret[31]=1;
const pubkey=secp256k1.getPublicKey(secret,true);
const key=encode({version:128,privateKey:secret,compressed:true});
const legacy=payments.p2pkh({pubkey}).address;
const native=payments.p2wpkh({pubkey}).address;
const nested=payments.p2sh({redeem:payments.p2wpkh({pubkey})}).address;

describe('Stamps Bitcoin signature support',()=>{
 let signatures:BitcoinSignatureService,nonces:NonceService,db:any;
 beforeEach(()=>{
  const cache=new Map();
  nonces=new NonceService({get:async k=>cache.get(k),set:async(k,v)=>cache.set(k,v),del:async k=>cache.delete(k)} as any);
  db={getRulesByChannel:jest.fn().mockResolvedValue([{asset_type:'stamp'}]),getRoleMappings:jest.fn()};
  signatures=new BitcoinSignatureService(nonces,db);
  jest.replaceProperty(EnvironmentConfig,'BASE_URL','https://bouncer.test');
 });
 afterEach(()=>jest.restoreAllMocks());
 it.each(vectors.valid)('accepts independent BIP-322 native SegWit vectors',v=>{
  for(const signature of v.bip322_signatures) expect(()=>signatures.verifyMessage(v.address,v.message,signature)).not.toThrow();
 });
 it.each([legacy,native,nested])('verifies fresh single-key Stamps proof for %s',async address=>{
  const nonce=await nonces.createNonce('member','guild','message','channel');
  const challenge=await signatures.createChallenge('member','guild',nonce,address);
  expect(challenge.address).toBe(address);
  expect(challenge.message).toContain('Network: Bitcoin mainnet');
  expect(challenge.message).toContain(address);
  expect(challenge.message).not.toMatch(/Discord (?:user|server|channel):/);
  const signature=Signer.sign(key,address,challenge.message);
  const data:any={userId:'member',discordId:'guild',nonce,address,expiry:challenge.expiry,walletType:'bitcoin'};
  expect((await signatures.verify(data,signature)).address).toBe(address);
  await expect(signatures.verify(data,signature)).rejects.toThrow();
 });
 it.each([legacy,native,nested])('rejects wrong messages and mismatched addresses for %s',address=>{
  const signature=Signer.sign(key,address,'Bouncer challenge');
  expect(()=>signatures.verifyMessage(address,'Another message',signature)).toThrow();
  expect(()=>signatures.verifyMessage('1BoatSLRHtKNngkdXEeobR76b53LETtpyT','Bouncer challenge',signature)).toThrow();
  expect(()=>signatures.verifyMessage(address,'Bouncer challenge',signature+'AA')).toThrow();
 });
 it('does not offer EVM wallets for a Stamps-only channel',async()=>{
  const nonce=await nonces.createNonce('member','guild','message','channel');
  expect(await signatures.getContext('member','guild',nonce)).toMatchObject({walletTypes:['bitcoin'],bitcoinStamps:true});
 });
 it.each([legacy,native,nested])('keeps non-Taproot address %s out of Ordinals-only challenges',async address=>{
  db.getRulesByChannel.mockResolvedValue([{asset_type:'ordinal'}]);
  const nonce=await nonces.createNonce('member','guild','message','channel');
  await expect(signatures.createChallenge('member','guild',nonce,address)).rejects.toThrow('Ordinals address');
  expect(()=>normalizeBitcoinAddress(address)).toThrow();
 });
 it('preserves Base58 case and normalizes only Bech32 addresses',()=>{
  expect(normalizeBitcoinProofAddress(legacy)).toBe(legacy);
  expect(normalizeBitcoinProofAddress(nested)).toBe(nested);
  expect(normalizeBitcoinProofAddress(native.toUpperCase())).toBe(native);
  expect(normalizeBlockedWallet(legacy)).toBe(legacy);
  expect(()=>normalizeBitcoinProofAddress(legacy.toLowerCase())).toThrow();
 });
 it('rejects testnet, P2WSH and malformed/checksum-invalid Bitcoin addresses',()=>{
  const script=payments.p2wsh({redeem:{output:new Uint8Array([0x51])}}).address;
  for(const address of [script,'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn',legacy+'x',' '+native,'bc1q-not-an-address'])
   expect(()=>normalizeBitcoinProofAddress(address)).toThrow();
 });
});
