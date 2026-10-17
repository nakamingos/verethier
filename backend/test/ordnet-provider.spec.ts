import { OrdnetApiService } from '../src/services/ordnet-api.service';
import { OrdnetOwnershipService } from '../src/services/ordnet-ownership.service';
import { OrdinalsOwnershipService } from '../src/services/ordinals-ownership.service';
import { EnvironmentConfig } from '../src/config/environment.config';
import { NftCheckContext } from '../src/services/nft-ownership.service';
import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { Verifier } from 'bip322-js';
import { OrdinalsRequestScheduler } from '../src/services/ordinals-request-scheduler.service';
import vectors from './fixtures/bip322-taproot.json';

const wallet = vectors.valid[0].address;
const otherWallet = vectors.valid[1].address;
const rule: any = { id:1, server_id:'guild', role_id:'holder', asset_type:'ordinal', slug:'pizza-comrades',
  attribute_key:'ALL', attribute_value:'ALL', min_items:1 };
const item = (number: number, owner: string | null = wallet) => ({ id:'a'.repeat(64)+'i'+number,
  inscriptionId:'a'.repeat(64)+'i'+number, collection:'pizza-comrades', collections:['pizza-comrades'],
  owner, traits:[{type:'Background',value:'Blue'}] });
const page = (items: any[] = [], nextCursor: string | null = null) => ({ items,
  pagination:{pageSize:100,hasNext:nextCursor!==null,nextCursor} });
const context = (): NftCheckContext => ({checks:new Map()});

describe('ord.net ownership provider',()=>{
  let get: jest.Mock;
  let service: OrdnetOwnershipService;
  beforeEach(()=>{
    get=jest.fn();service=new OrdnetOwnershipService({get} as any);
    jest.replaceProperty(EnvironmentConfig,'ORDINALS_PROVIDER','ordnet');
    jest.replaceProperty(EnvironmentConfig,'XVERSE_API_KEY',undefined);
  });
  afterEach(()=>jest.restoreAllMocks());

  it('validates collection existence and uses the documented canonical slug as its label',async()=>{
    get.mockResolvedValue({success:true,data:[{slug:'pizza-comrades',floor:null}]});
    await expect(new OrdinalsOwnershipService(service).prepareRule(' Pizza-Comrades ')).resolves.toMatchObject({asset_type:'ordinal',slug:'pizza-comrades',collection_name:'pizza-comrades'});
    expect(get).toHaveBeenCalledWith('/collection-stats/floors?slugs=pizza-comrades');
  });
  it('rejects unknown collections rather than storing a rule that cannot be checked',async()=>{
    get.mockResolvedValue({success:true,data:[]});
    await expect(service.prepareRule('pizza-comrades')).rejects.toThrow('not found on ord.net');
  });
  it.each([{success:false,data:[]},{success:true,data:[{slug:'other'}]},{success:true,data:[{slug:'pizza-comrades'},{slug:'other'}]},{}])('rejects malformed collection lookups',async payload=>{
    get.mockResolvedValue(payload);await expect(service.prepareRule('pizza-comrades')).rejects.toThrow('unavailable');
  });
  it('reads every page and shares the complete collection across wallets, roles, and stacked wallets',async()=>{
    get.mockResolvedValueOnce(page([item(1)],'cursor +/?')).mockResolvedValueOnce(page([item(2,otherWallet),item(3)]));
    const facade=new OrdinalsOwnershipService(service);const run=context();
    await expect(Promise.all([facade.count(rule,[wallet],run),facade.count(rule,[otherWallet],run),
      facade.count({...rule,role_id:'bonus'},[wallet,otherWallet,wallet],run)])).resolves.toEqual([2n,1n,3n]);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toContain('cursor=cursor+%2B%2F%3F');
  });
  it('fetches fresh ownership for a new run and verifies zero only after complete pagination',async()=>{
    get.mockResolvedValueOnce(page([item(1,otherWallet)])).mockResolvedValueOnce(page([item(1)]));
    const facade=new OrdinalsOwnershipService(service);
    await expect(facade.count(rule,[wallet],context())).resolves.toBe(0n);
    await expect(facade.count(rule,[wallet],context())).resolves.toBe(1n);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('shares one complete in-flight scan between independent member verifications', async () => {
    let finish: (data: any) => void;
    get.mockResolvedValueOnce(page([item(1)], 'next')).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const first = service.count('pizza-comrades', [wallet], context());
    const second = service.count('pizza-comrades', [otherWallet], context());
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(get).toHaveBeenCalledTimes(2);
    finish(page([item(2, otherWallet), item(3)]));
    await expect(Promise.all([first, second])).resolves.toEqual([2n, 1n]);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('clears a shared failed scan so the next member gets a fresh attempt', async () => {
    get.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(page([item(1)]));
    const results = await Promise.allSettled([
      service.count('pizza-comrades', [wallet], context()),
      service.count('pizza-comrades', [otherWallet], context()),
    ]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(get).toHaveBeenCalledTimes(1);
    await expect(service.count('pizza-comrades', [wallet], context())).resolves.toBe(1n);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('promotes a paused scheduled scan when a member needs it instead of starting a duplicate', async () => {
    const requests = new OrdinalsRequestScheduler();
    const finish = requests.beginVerification();
    const read = jest.fn().mockResolvedValue(page([item(1)]));
    get.mockImplementation((_path, work) => requests.enqueue('ordnet', work, read));
    service = new OrdnetOwnershipService({ get } as any, requests);
    const scheduled = service.count('pizza-comrades', [otherWallet], { ...context(), ordinalMode: 'scheduled' });
    expect(read).not.toHaveBeenCalled();
    const member = service.count('pizza-comrades', [wallet], context());
    await expect(Promise.all([scheduled, member])).resolves.toEqual([0n, 1n]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    finish();
  });
  it('supports a complete empty collection and avoids lookups for an empty wallet list',async()=>{
    get.mockResolvedValue(page());const facade=new OrdinalsOwnershipService(service);
    await expect(facade.count(rule,[])).resolves.toBe(0n);expect(get).not.toHaveBeenCalled();
    await expect(facade.count(rule,[wallet])).resolves.toBe(0n);
  });
  it('reports trait coverage without treating missing metadata as failed quantity verification',async()=>{
    get.mockResolvedValue(page([item(1),{...item(2),traits:undefined}]));
    const run=context();const snapshot=await service.snapshot('pizza-comrades',run);
    expect(snapshot.items.get(item(1).id).traits).toEqual([{type:'Background',value:'Blue'}]);
    expect(snapshot.items.get(item(2).id).traits).toBeNull();
    await expect(service.count('pizza-comrades',[wallet],run)).resolves.toBe(2n);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('accepts the live card payload with empty supplemental memberships and the matching collection slug',async()=>{
    get.mockResolvedValue(page([{...item(1),collections:[]},{...item(2),collections:[]}]));
    await expect(service.count('pizza-comrades',[wallet],context())).resolves.toBe(2n);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('treats unknown ownership as unavailable, including when other known items already meet the minimum',async()=>{
    get.mockResolvedValue(page([item(1),item(2,null)]));
    await expect(new OrdinalsOwnershipService(service).count(rule,[wallet])).rejects.toThrow('collection pizza-comrades contains an unknown owner');
  });
  it.each(['missing-owner','bad-owner','wrong-id','wrong-collection','invalid-membership','invalid-id','too-many-items','bad-page-size','missing-next-cursor','unexpected-final-cursor','empty-next-page'])('rejects %s data instead of returning a partial count',async problem=>{
    const data:any=page([item(1)]);
    if(problem==='missing-owner')delete data.items[0].owner;
    if(problem==='bad-owner')data.items[0].owner='not-an-address';
    if(problem==='wrong-id')data.items[0].id=item(2).id;
    if(problem==='wrong-collection')data.items[0].collection='other';
    if(problem==='invalid-membership')data.items[0].collections=undefined;
    if(problem==='invalid-id')data.items[0].inscriptionId=data.items[0].id='bad';
    if(problem==='too-many-items')data.items=Array.from({length:101},(_,i)=>item(i));
    if(problem==='bad-page-size')data.pagination.pageSize=0;
    if(problem==='missing-next-cursor')data.pagination.hasNext=true;
    if(problem==='unexpected-final-cursor')data.pagination.nextCursor='bad';
    if(problem==='empty-next-page'){data.items=[];data.pagination={pageSize:100,hasNext:true,nextCursor:'next'};}
    get.mockResolvedValue(data);
    await expect(service.count('pizza-comrades',[wallet],context())).rejects.toThrow('unavailable');
  });
  it('rejects duplicate IDs and cursor loops across pages',async()=>{
    get.mockResolvedValueOnce(page([item(1)],'next')).mockResolvedValueOnce(page([item(1)]));
    await expect(service.snapshot('pizza-comrades',context())).rejects.toThrow('unavailable');
    get.mockReset().mockResolvedValueOnce(page([item(1)],'next')).mockResolvedValueOnce(page([item(2)],'next'));
    await expect(service.snapshot('pizza-comrades',context())).rejects.toThrow('unavailable');
  });
  it('bounds collection scans',async()=>{
    get.mockImplementation(async()=>page([item(get.mock.calls.length)],'cursor-'+get.mock.calls.length));
    await expect(service.snapshot('pizza-comrades',context())).rejects.toThrow('unavailable');
    expect(get).toHaveBeenCalledTimes(200);
  });
  it('keeps roles and successful check timestamps when ord.net fails',async()=>{
    get.mockRejectedValue(new Error('unavailable'));
    const db:any={getDisabledBackgroundServers: jest.fn().mockResolvedValue(new Set()), getEarnedRoleAssignments:jest.fn().mockResolvedValue([{id:'assignment',user_id:'user',server_id:'guild',role_id:'holder'}]),
      getRoleMappings:jest.fn().mockResolvedValue([rule]),saveRoleCheckDetails:jest.fn(),updateLastVerified:jest.fn(),updateRoleAssignmentStatus:jest.fn()};
    const engine=new VerificationEngine(db,new AssetOwnershipService({} as any,{} as any,new OrdinalsOwnershipService(service)),{getUserAddresses:jest.fn().mockResolvedValue([wallet])} as any, { allowedAddresses: async (_serverId, wallets) => wallets } as any);
    const discord:any={removeUserRole:jest.fn()};
    await new DynamicRoleService(db,engine,discord).performScheduledReverification();
    expect(discord.removeUserRole).not.toHaveBeenCalled();expect(db.updateLastVerified).not.toHaveBeenCalled();
    expect(db.saveRoleCheckDetails).toHaveBeenCalledWith('assignment',expect.objectContaining({last_check_status:'unavailable'}));
  });
  it('rejects provider typos before calling either provider',async()=>{
    const facade=new OrdinalsOwnershipService(service);
    jest.replaceProperty(EnvironmentConfig,'ORDINALS_PROVIDER','ord-net');
    await expect(facade.count(rule,[wallet])).rejects.toThrow('ORDINALS_PROVIDER must be');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('ord.net trait suggestions', () => {
  let get: jest.Mock;
  let service: OrdnetOwnershipService;
  const category = (number: number, value: string) => ({ ...item(number), traits: [{ type: 'Category', value }] });
  const settle = () => new Promise<void>(resolve => setImmediate(resolve));

  beforeEach(() => {
    get = jest.fn();
    service = new OrdnetOwnershipService({ get } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns the first-page values promptly, then adds rare traits from later pages without duplicate scans', async () => {
    let finish: (data: any) => void;
    const later = new Promise(resolve => { finish = resolve; });
    get.mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => category(index, 'Comrade')), 'next +/?'))
      .mockReturnValueOnce(later);
    expect(await service.suggestions('pizza-comrades', 'Category')).toEqual(['Comrade']);
    expect(await service.suggestions('pizza-comrades')).toEqual(['Category']);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toContain('cursor=next+%2B%2F%3F');

    finish(page([category(100, 'Cosmic Oven-Lord')]));
    await settle();
    expect(await service.suggestions('pizza-comrades', 'category')).toEqual(['Comrade', 'Cosmic Oven-Lord']);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps a slow scan shared and starts cache expiration only after all pages finish', async () => {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    let finish: (data: any) => void;
    const later = new Promise(resolve => { finish = resolve; });
    get.mockResolvedValueOnce(page([category(1, 'Comrade')], 'next')).mockReturnValueOnce(later)
      .mockResolvedValueOnce(page([category(3, 'Honorary')]));
    expect(await service.suggestions('pizza-comrades', 'Category')).toEqual(['Comrade']);
    now += 8 * 24 * 60 * 60 * 1000;
    expect(await service.suggestions('pizza-comrades', 'Category')).toEqual(['Comrade']);
    expect(get).toHaveBeenCalledTimes(2);
    finish(page([category(2, 'Cosmic Oven-Lord')]));
    await settle();
    now += 7 * 24 * 60 * 60 * 1000 - 1;
    expect(await service.suggestions('pizza-comrades', 'Category')).toEqual(['Comrade', 'Cosmic Oven-Lord']);
    expect(get).toHaveBeenCalledTimes(2);
    now += 2;
    expect(await service.suggestions('pizza-comrades', 'Category')).toEqual(['Honorary']);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('reuses verification trait menus six days later while still fetching fresh ownership', async () => {
    const now = Date.now();
    get.mockResolvedValueOnce(page([category(1, 'Cosmic Oven-Lord')]))
      .mockResolvedValueOnce(page([{ ...category(1, 'Cosmic Oven-Lord'), owner: otherWallet }]));
    expect(await service.count('pizza-comrades', [wallet], context())).toBe(1n);
    jest.spyOn(Date, 'now').mockReturnValue(now + 6 * 24 * 60 * 60 * 1000);
    expect(await service.suggestions('pizza-comrades', 'Category')).toEqual(['Cosmic Oven-Lord']);
    expect(get).toHaveBeenCalledTimes(1);
    expect(await service.count('pizza-comrades', [wallet], context())).toBe(0n);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('retries after a later page fails instead of caching an incomplete sample permanently', async () => {
    get.mockResolvedValueOnce(page([category(1, 'Comrade')], 'next'))
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(page([category(2, 'Cosmic Oven-Lord')]));
    await service.suggestions('pizza-comrades', 'Category');
    await settle();
    expect(await service.suggestions('pizza-comrades', 'Category')).toEqual(['Cosmic Oven-Lord']);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('replays earlier validated traits when autocomplete joins a verification midway through its scan', async () => {
    let finish: (data: any) => void;
    get.mockResolvedValueOnce(page([category(1, 'Comrade')], 'next'))
      .mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const verification = service.snapshot('pizza-comrades', context());
    await settle();
    expect(await service.suggestions('pizza-comrades', 'Category')).toEqual(['Comrade']);
    expect(get).toHaveBeenCalledTimes(2);
    finish(page([category(2, 'Cosmic Oven-Lord')]));
    await verification;
    expect(await service.suggestions('pizza-comrades', 'Category')).toEqual(['Comrade', 'Cosmic Oven-Lord']);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('resolves autocomplete when it joins just after an empty final page', async () => {
    get.mockResolvedValue(page());
    const verification = service.snapshot('pizza-comrades', context());
    await Promise.resolve();
    const suggestions = service.suggestions('pizza-comrades');
    await expect(suggestions).resolves.toEqual([]);
    await verification;
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('shares an autocomplete scan with verification and retains its complete trait menu', async () => {
    let finish: (data: any) => void;
    const later = new Promise(resolve => { finish = resolve; });
    get.mockResolvedValueOnce(page([category(1, 'Comrade')], 'next')).mockReturnValueOnce(later);
    await service.suggestions('pizza-comrades', 'Category');
    const verification = service.snapshot('pizza-comrades', context());
    expect(get).toHaveBeenCalledTimes(2);
    finish(page([category(2, 'Cosmic Oven-Lord')]));
    expect((await verification).items.size).toBe(2);
    await settle();
    expect(await service.suggestions('pizza-comrades', 'Category')).toEqual(['Comrade', 'Cosmic Oven-Lord']);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('retains searchable values beyond the old 500-value sample limit', async () => {
    get.mockImplementation(async path => {
      const cursor = new URLSearchParams(path.split('?')[1]).get('cursor');
      const pageIndex = cursor ? Number(cursor) : 0;
      return page(pageIndex < 5
        ? Array.from({ length: 100 }, (_, index) => category(pageIndex * 100 + index, `Trait ${pageIndex * 100 + index}`))
        : [category(500, 'Cosmic Oven-Lord')], pageIndex < 5 ? String(pageIndex + 1) : null);
    });
    await service.suggestions('pizza-comrades', 'Category');
    await settle();
    const values = await service.suggestions('pizza-comrades', 'Category');
    expect(values).toHaveLength(501);
    expect(values).toContain('Cosmic Oven-Lord');
    expect(get).toHaveBeenCalledTimes(6);
  });

  it('clears a failed initial scan so the next autocomplete request can recover', async () => {
    get.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(page([category(1, 'Cosmic Oven-Lord')]));
    await expect(service.suggestions('pizza-comrades', 'Category')).rejects.toThrow('unavailable');
    expect(await service.suggestions('pizza-comrades', 'Category')).toEqual(['Cosmic Oven-Lord']);
  });
});

// Public, unfunded example key from bip322-js documentation, used only against mock HTTP.
const TEST_WIF='L3VFeEujGtevx9w18HD1fhRbCH67Az2dpCymeRE1SoPK6XQtaN2k';
const ORD_ADDRESS='bc1ppv609nr0vr25u07u95waq5lucwfm6tde4nydujnu8npg4q75mr5sxq8lt3';
const PAY_ADDRESS='bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l';
const AUTH_ID='11111111-1111-1111-1111-111111111111';
const challenge=()=>({authRequestId:AUTH_ID,challenges:[{challengeId:'22222222-2222-2222-2222-222222222222',role:'ordinals',address:ORD_ADDRESS,message:'Sign in to ord.net at 2026-10-10T12:00:00Z (nonce: first)'},
  {challengeId:'33333333-3333-3333-3333-333333333333',role:'payment',address:PAY_ADDRESS,message:'Sign in to ord.net at 2026-10-10T12:00:00Z (nonce: second)'}]});
// The live API uses this envelope rather than the shorter documentation example.
const liveChallenge=()=>({ ...challenge(), challenges:challenge().challenges.map(entry=>({ ...entry,
  message:['ORD.NET wallet verification','Domain: ord.net',`Address: ${entry.address}`,
    'Nonce: cf18a879cd6f4198275344ab0fdaea3a',`Issued At: ${new Date(Date.now()).toISOString()}`,
    `Expiration Time: ${new Date(Date.now()+600000).toISOString()}`].join('\n'),
})) });
const session=(token='session-token')=>({sessionToken:token,expiresAt:new Date(Date.now()+3600000).toISOString(),walletBindings:[{ordinalsAddress:ORD_ADDRESS,paymentAddress:PAY_ADDRESS}]});
const response=(data:any,status=200,headers?:HeadersInit)=>new Response(JSON.stringify(data),{status,headers});
const GET_PATH='/collection/pizza-comrades/inscriptions?limit=100&sort=oldest';

describe('ord.net API authentication and transport',()=>{
  beforeEach(()=>{
    jest.useFakeTimers();jest.setSystemTime(new Date('2026-10-10T12:00:00Z'));
    jest.replaceProperty(EnvironmentConfig,'ORDNET_SESSION_TOKEN',undefined);
    jest.replaceProperty(EnvironmentConfig,'ORDNET_ORDINALS_ADDRESS',ORD_ADDRESS);
    jest.replaceProperty(EnvironmentConfig,'ORDNET_PAYMENT_ADDRESS',PAY_ADDRESS);
    jest.replaceProperty(EnvironmentConfig,'ORDNET_ORDINALS_WIF',TEST_WIF);
    jest.replaceProperty(EnvironmentConfig,'ORDNET_PAYMENT_WIF',undefined);
  });
  afterEach(async()=>{await jest.runAllTimersAsync();jest.useRealTimers();jest.restoreAllMocks();});

  it('signs both fresh challenges as hex BIP-322 witnesses and shares a session across reads',async()=>{
    const fetch=jest.spyOn(global,'fetch').mockResolvedValueOnce(response(challenge())).mockResolvedValueOnce(response(session())).mockImplementation(async()=>response(page()));
    const api=new OrdnetApiService();const first=api.get(GET_PATH);const second=api.get(GET_PATH);
    await jest.advanceTimersByTimeAsync(6500);
    await Promise.all([first,second]);expect(fetch).toHaveBeenCalledTimes(4);
    const body=JSON.parse(String(fetch.mock.calls[1][1].body));
    expect(body.authRequestId).toBe(AUTH_ID);
    for(const [index,entry] of body.verifications.entries()) {
      expect(entry.signature).toMatch(/^(?:[0-9a-f]{2})+$/);
      expect(Verifier.verifySignature(entry.address,challenge().challenges[index].message,Buffer.from(entry.signature,'hex').toString('base64'))).toBe(true);
    }
    for(const [url,options] of fetch.mock.calls)expect(url).toMatch(/^https:\/\/ord\.net\/api\/v1\//);
    expect(fetch.mock.calls[0][1]).toMatchObject({method:'POST',redirect:'error'});
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    expect(fetch.mock.calls[2][1]).toMatchObject({method:'GET',redirect:'error',headers:{Authorization:'Bearer session-token'}});
  });
  it('signs the exact live login envelope for both addresses',async()=>{
    const data=liveChallenge();
    const fetch=jest.spyOn(global,'fetch').mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response(session())).mockResolvedValueOnce(response(page()));
    const pending=new OrdnetApiService().get(GET_PATH);await jest.advanceTimersByTimeAsync(4200);await pending;
    const body=JSON.parse(String(fetch.mock.calls[1][1].body));
    expect(body.verifications).toHaveLength(2);
    for(const [index,entry]of body.verifications.entries()) {
      expect(Verifier.verifySignature(entry.address,data.challenges[index].message,Buffer.from(entry.signature,'hex').toString('base64'))).toBe(true);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('promotes authentication as well as the scan when verification joins paused background work', async () => {
    const requests = new OrdinalsRequestScheduler();
    const finish = requests.beginVerification();
    const work = { priority: 'background' as const };
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce(response(challenge()))
      .mockResolvedValueOnce(response(session())).mockResolvedValueOnce(response(page()));
    const pending = new OrdnetApiService(requests).get(GET_PATH, work);
    await jest.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
    requests.promote(work);
    await jest.advanceTimersByTimeAsync(4200);
    await pending;
    expect(fetch).toHaveBeenCalledTimes(3);
    finish();
  });
  it.each(['wrong-domain','wrong-message-address','missing-nonce','expired','invalid-date','future-issued','invalid-order','extra-instructions'])(
    'rejects a live login envelope with %s before signing',async problem=>{
      const data=liveChallenge();
      let message=data.challenges[0].message;
      if(problem==='wrong-domain')message=message.replace('Domain: ord.net','Domain: example.com');
      if(problem==='wrong-message-address')message=message.replace(`Address: ${ORD_ADDRESS}`,`Address: ${wallet}`);
      if(problem==='missing-nonce')message=message.replace(/Nonce: [^\n]+/,'Nonce: ');
      if(problem==='expired')message=message.replace(/Expiration Time: .+/,`Expiration Time: ${new Date(Date.now()-1).toISOString()}`);
      if(problem==='invalid-date')message=message.replace(/Issued At: [^\n]+/,'Issued At: invalid');
      if(problem==='future-issued')message=message.replace(/Issued At: [^\n]+/,`Issued At: ${new Date(Date.now()+120000).toISOString()}`);
      if(problem==='invalid-order')message=message.replace(/Issued At: [^\n]+/,`Issued At: ${new Date(Date.now()+30000).toISOString()}`).replace(/Expiration Time: .+/,`Expiration Time: ${new Date(Date.now()+10000).toISOString()}`);
      if(problem==='extra-instructions')message+='\nApprove a transfer.';
      data.challenges[0].message=message;
      const fetch=jest.spyOn(global,'fetch').mockResolvedValue(response(data));
      await expect(new OrdnetApiService().get(GET_PATH)).rejects.toThrow('authentication challenge');
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  it('renews an expired automatic session before the next run',async()=>{
    const fetch=jest.spyOn(global,'fetch').mockImplementation(async url=>String(url).endsWith('/auth/challenge')?response(challenge()):String(url).endsWith('/auth/verify')?response(session()):response(page()));
    const api=new OrdnetApiService();const first=api.get(GET_PATH);await jest.advanceTimersByTimeAsync(4200);await first;
    await jest.advanceTimersByTimeAsync(3600000);
    const second=api.get(GET_PATH);await jest.advanceTimersByTimeAsync(4200);await second;
    expect(fetch.mock.calls.filter(([url])=>String(url).endsWith('/auth/verify'))).toHaveLength(2);
  });
  it('renews once and retries a read when an automatic session is rejected early',async()=>{
    const fetch=jest.spyOn(global,'fetch').mockResolvedValueOnce(response(challenge())).mockResolvedValueOnce(response(session('old')))
      .mockResolvedValueOnce(response({},401)).mockResolvedValueOnce(response(challenge())).mockResolvedValueOnce(response(session('new'))).mockResolvedValueOnce(response(page()));
    const pending=new OrdnetApiService().get(GET_PATH);await jest.advanceTimersByTimeAsync(11000);await pending;
    expect(fetch).toHaveBeenCalledTimes(6);expect(fetch.mock.calls[5][1].headers).toHaveProperty('Authorization','Bearer new');
  });
  it('supports manual tokens without asking the wallet to authenticate',async()=>{
    jest.replaceProperty(EnvironmentConfig,'ORDNET_SESSION_TOKEN','manual-token');
    const fetch=jest.spyOn(global,'fetch').mockResolvedValue(response(page()));
    await new OrdnetApiService().get(GET_PATH);
    expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1].headers).toHaveProperty('Authorization','Bearer manual-token');
  });
  it('makes a rejected manual token actionable without turning it into zero holdings',async()=>{
    jest.replaceProperty(EnvironmentConfig,'ORDNET_SESSION_TOKEN','manual-token');
    const fetch=jest.spyOn(global,'fetch').mockResolvedValue(response({},401));
    await expect(new OrdnetApiService().get(GET_PATH)).rejects.toThrow('Update ORDNET_SESSION_TOKEN');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('requires credentials and checks wallet keys before network access',async()=>{
    const fetch=jest.spyOn(global,'fetch');jest.replaceProperty(EnvironmentConfig,'ORDNET_ORDINALS_WIF',undefined);
    await expect(new OrdnetApiService().get(GET_PATH)).rejects.toThrow('not configured');
    jest.replaceProperty(EnvironmentConfig,'ORDNET_ORDINALS_WIF',TEST_WIF);jest.replaceProperty(EnvironmentConfig,'ORDNET_ORDINALS_ADDRESS',wallet);
    await expect(new OrdnetApiService().get(GET_PATH)).rejects.toThrow('Invalid ord.net API wallet configuration');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['wrong-address','wrong-role','duplicate-challenge','missing-payment','unexpected-message'])('rejects %s authentication challenges without submitting signatures',async problem=>{
    const data:any=challenge();
    if(problem==='wrong-address')data.challenges[0].address=wallet;
    if(problem==='wrong-role')data.challenges[0].role='other';
    if(problem==='duplicate-challenge')data.challenges[1].challengeId=data.challenges[0].challengeId;
    if(problem==='missing-payment')data.challenges.pop();
    if(problem==='unexpected-message')data.challenges[0].message='Please sign an unrelated request';
    const fetch=jest.spyOn(global,'fetch').mockResolvedValue(response(data));
    await expect(new OrdnetApiService().get(GET_PATH)).rejects.toThrow('authentication challenge');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('handles an unfunded API wallet without caching a failed login',async()=>{
    const fetch=jest.spyOn(global,'fetch').mockResolvedValueOnce(response(challenge())).mockResolvedValueOnce(response({},403))
      .mockResolvedValueOnce(response(challenge())).mockResolvedValueOnce(response(session())).mockResolvedValueOnce(response(page()));
    const api=new OrdnetApiService();const first=api.get(GET_PATH);const rejection=expect(first).rejects.toThrow('0.001 BTC');
    await jest.advanceTimersByTimeAsync(2100);await rejection;
    const second=api.get(GET_PATH);await jest.advanceTimersByTimeAsync(6300);await second;expect(fetch).toHaveBeenCalledTimes(5);
  });
  it.each([401,503])('identifies auth/verify HTTP %s without exposing response contents or keys',async status=>{
    const fetch=jest.spyOn(global,'fetch').mockResolvedValueOnce(response(challenge()))
      .mockResolvedValueOnce(response({error:'private-response-details'},status));
    const pending=new OrdnetApiService().get(GET_PATH);
    const rejection=expect(pending).rejects.toThrow(`POST /auth/verify: HTTP ${status}`);
    await jest.advanceTimersByTimeAsync(2100);await rejection;
    const error=await pending.catch(e=>e);
    expect(error.message).not.toContain('private-response-details');expect(error.message).not.toContain(TEST_WIF);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('identifies an invalid session response without exposing its token',async()=>{
    const fetch=jest.spyOn(global,'fetch').mockResolvedValueOnce(response(challenge()))
      .mockResolvedValueOnce(response({...session('private-token'),walletBindings:[]}));
    const pending=new OrdnetApiService().get(GET_PATH);
    const rejection=expect(pending).rejects.toThrow('auth/verify returned an invalid session or wallet binding');
    await jest.advanceTimersByTimeAsync(2100);await rejection;
    expect((await pending.catch(e=>e)).message).not.toContain('private-token');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('identifies failed collection reads after retries without exposing query cursors or response contents',async()=>{
    jest.replaceProperty(EnvironmentConfig,'ORDNET_SESSION_TOKEN','manual-token');
    const fetch=jest.spyOn(global,'fetch').mockResolvedValue(response({error:'private-response-details'},503));
    const pending=new OrdnetApiService().get(GET_PATH+'&cursor=private-cursor');
    const rejection=expect(pending).rejects.toThrow('GET /collection/pizza-comrades/inscriptions: HTTP 503 after 3 attempts');
    await jest.advanceTimersByTimeAsync(6500);await rejection;
    const error=await pending.catch(e=>e);
    for(const secret of ['private-cursor','private-response-details','manual-token'])expect(error.message).not.toContain(secret);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('paces provider calls and honors rate-limit retryAfterMs',async()=>{
    jest.replaceProperty(EnvironmentConfig,'ORDNET_SESSION_TOKEN','manual-token');
    const fetch=jest.spyOn(global,'fetch').mockResolvedValueOnce(response({retryAfterMs:5000},429)).mockResolvedValue(response(page()));
    const pending=new OrdnetApiService().get(GET_PATH);await jest.advanceTimersByTimeAsync(4999);expect(fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);await pending;expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not retry earlier than a long provider cooldown or retry permanent errors',async()=>{
    jest.replaceProperty(EnvironmentConfig,'ORDNET_SESSION_TOKEN','manual-token');
    const fetch=jest.spyOn(global,'fetch').mockResolvedValue(response({retryAfterMs:60000},429));
    await expect(new OrdnetApiService().get(GET_PATH)).rejects.toThrow('unavailable');expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockClear().mockResolvedValue(response({},403));
    await expect(new OrdnetApiService().get(GET_PATH)).rejects.toThrow('unavailable');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('restricts the public API helper to read endpoints',async()=>{
    const fetch=jest.spyOn(global,'fetch');
    await expect(new OrdnetApiService().get('/collection/pizza-comrades/listings/preflight')).rejects.toThrow('Unsupported');
    await expect(new OrdnetApiService().get('https://example.com/')).rejects.toThrow('Unsupported');expect(fetch).not.toHaveBeenCalled();
  });
});
