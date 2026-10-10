import { mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Signer, Verifier } from 'bip322-js';
const { saveWallet } = require('../scripts/ordnet-wallet.cjs');

describe('Dedicated ord.net test wallet setup',()=>{
  let directory: string;
  beforeEach(()=>{directory=mkdtempSync(join(tmpdir(),'verethier-ordnet-wallet-test-'));});
  afterEach(()=>rmSync(directory,{recursive:true,force:true}));
  it('creates a private wallet file whose one key controls both public addresses without returning the key',()=>{
    const filename=join(directory,'.env.ordnet');const result=saveWallet(filename);
    expect(Object.keys(result).sort()).toEqual(['ordinalsAddress','paymentAddress']);
    expect(statSync(filename).mode & 0o777).toBe(0o600);
    const data=readFileSync(filename,'utf8');expect(data).toContain('ORDINALS_PROVIDER=ordnet');
    const wif=data.match(/^ORDNET_ORDINALS_WIF=(.+)$/m)[1];
    for(const address of Object.values(result) as string[])expect(Verifier.verifySignature(address,'test',Signer.sign(wif,address,'test'))).toBe(true);
  });
  it('refuses to replace an existing wallet file',()=>{
    const filename=join(directory,'.env.ordnet');writeFileSync(filename,'existing wallet',{mode:0o600});
    expect(()=>saveWallet(filename)).toThrow();expect(readFileSync(filename,'utf8')).toBe('existing wallet');
  });
});
