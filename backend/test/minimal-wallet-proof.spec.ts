import { privateKeyToAccount } from 'viem/accounts';
import { consentCommitment, minimalEvmVerificationProof } from '../src/utils/wallet-proof.util';
import { privacyProof } from '../src/portal/privacy.service';
import { WalletService } from '../src/services/wallet.service';
import { NonceService } from '../src/services/nonce.service';
import { EvmSignatureService } from '../src/services/evm-signature.service';
import { EnvironmentConfig } from '../src/config/environment.config';

const account = privateKeyToAccount(('0x'+'13'.repeat(32)) as `0x${string}`);
const privacy = {epoch:'11111111-2222-4333-8444-555555555555',share:true,exports:false,notice:'2026-10-27'};

describe('Minimal EVM proof and server-side Discord binding',()=>{
  let nonces:NonceService, service:WalletService, addresses:any;
  beforeEach(()=>{
    const entries=new Map();
    nonces=new NonceService({get:async key=>entries.get(key),set:async(key,value)=>{entries.set(key,value);},del:async key=>{entries.delete(key);}} as any);
    const evm=new EvmSignatureService();
    jest.spyOn(evm as any,'client').mockImplementation((chainId:number)=>({getChainId:async()=>chainId,getCode:async()=> '0x'}));
    addresses={addUserAddress:jest.fn().mockResolvedValue({success:true,isNewAddress:true})};
    service=new WalletService(nonces,addresses,{getUser:jest.fn().mockResolvedValue({username:'Collector'})} as any,{} as any,
      {assertAllowed:jest.fn().mockResolvedValue(undefined)} as any,undefined,{assertActive:jest.fn(),choose:jest.fn()} as any,evm);
    jest.replaceProperty(EnvironmentConfig,'BASE_URL','https://verify.example.test');
  });
  afterEach(()=>jest.restoreAllMocks());
  async function proof(withPrivacy=false) {
    const nonce=await nonces.createNonce('private-discord-user','private-discord-server',undefined,'private-channel');
    const context=await nonces.getActiveNonce('private-discord-user','private-discord-server',nonce);
    const data:any={proofVersion:2,address:account.address,chainId:1,userId:context.userId,discordId:context.guildId,
      userTag:'Private username',discordName:'Private community',nonce,expiry:context.expiry,...(withPrivacy?{privacy}:{})};
    const typedData=minimalEvmVerificationProof({origin:EnvironmentConfig.BASE_URL,...data});
    const signature=await account.signTypedData(typedData as any);
    return {data,typedData,signature};
  }
  it('signs only essential fields, saves to the nonce-bound Discord user, and consumes the proof once',async()=>{
    const {data,typedData,signature}=await proof();
    expect(Object.keys(typedData.message)).toEqual(['Purpose','Domain','WalletAddress','Nonce','Expiry']);
    expect(JSON.stringify(typedData)).not.toMatch(/private-discord|Private username|Private community|private-channel|UserID|UserTag|ServerID|ServerName/);
    await expect(service.verifySignature(data,signature)).resolves.toMatchObject({address:account.address.toLowerCase()});
    expect(addresses.addUserAddress).toHaveBeenCalledWith('private-discord-user',account.address.toLowerCase(),expect.anything(),'evm',expect.anything());
    await expect(service.verifySignature(data,signature)).rejects.toThrow('Invalid or expired nonce');
  });
  it.each(['userId','discordId','nonce','expiry','chainId','address'])('rejects a changed %s while preserving the valid original proof',async field=>{
    const {data,signature}=await proof();
    const changed={...data,[field]:field==='expiry'?data.expiry+1:field==='chainId'?8453:field==='address'?'0x'+'22'.repeat(20):'other'};
    await expect(service.verifySignature(changed,signature)).rejects.toThrow();
    expect(addresses.addUserAddress).not.toHaveBeenCalled();
    await expect(service.verifySignature(data,signature)).resolves.toBeDefined();
  });
  it('rejects another origin or purpose even with a valid signature from the correct wallet',async()=>{
    const {data,typedData}=await proof();
    for(const message of [{...typedData.message,Domain:'https://other.example'},{...typedData.message,Purpose:'Link wallet to Bouncer'}]) {
      const signature=await account.signTypedData({...typedData,message} as any);
      await expect(service.verifySignature(data,signature)).rejects.toThrow();
    }
    expect(addresses.addUserAddress).not.toHaveBeenCalled();
  });
  it('commits to privacy choices without exposing them or producing a stable community fingerprint',async()=>{
    const {data,typedData,signature}=await proof(true);
    expect(typedData.message.ConsentHash).toBe(consentCommitment(data.nonce,privacyProof(privacy)));
    expect(JSON.stringify(typedData)).not.toMatch(/epoch|exports|share|2026-10-27|11111111-2222/);
    expect(consentCommitment('another-nonce',privacyProof(privacy))).not.toBe(typedData.message.ConsentHash);
    await expect(service.verifySignature({...data,privacy:{...privacy,exports:true}},signature)).rejects.toThrow();
    await expect(service.verifySignature(data,signature)).resolves.toBeDefined();
  });
});
