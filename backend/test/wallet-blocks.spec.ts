import { WalletBlockService, normalizeBlockedWallet, WALLET_BLOCKED } from '../src/services/wallet-block.service';
import { WalletBlockHandler } from '../src/services/discord-commands/handlers/wallet-block.handler';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { WalletService } from '../src/services/wallet.service';
import { PermissionFlagsBits } from 'discord.js';
import vectors from './fixtures/bip322-taproot.json';

const wallet = '0x' + 'a'.repeat(40);
const other = '0x' + 'b'.repeat(40);
const bitcoin = vectors.valid[0].address;
const guild = '1369930881267142686';
const admin = '585432476332064769';
const base = { id: 1, server_id: guild, server_name: 'Guild', channel_id: 'verify', channel_name: 'Verify',
  role_id: 'holder', role_name: 'Holder', asset_type: 'ethscription', slug: 'comrades', attribute_key: 'ALL', attribute_value: 'ALL', min_items: 1 } as any;

function database() {
  const client: any = {};
  for (const method of ['from','select','upsert','delete','eq','order']) client[method] = jest.fn().mockReturnValue(client);
  client.single = jest.fn(); client.range = jest.fn(); client.in = jest.fn();
  let server: string;
  const denied = new Map<string, Set<string>>();
  client.eq.mockImplementation((column,value) => { if (column === 'server_id') server=value; return client; });
  client.in.mockImplementation(async (_column, addresses) => ({data:addresses.filter(address => denied.get(server)?.has(address)).map(address=>({address})),error:null}));
  return {client, denied, blocks:new WalletBlockService(client)};
}

describe('Wallet block storage and lookup', () => {
  it('normalizes case and surrounding whitespace while validating both supported address types', () => {
    expect(normalizeBlockedWallet(' 0x'+'A'.repeat(40)+' ')).toBe(wallet);
    expect(normalizeBlockedWallet(bitcoin.toUpperCase())).toBe(bitcoin);
    for (const invalid of ['0x123','example.eth',bitcoin.slice(0,-1)+'a','tb1p'+bitcoin.slice(4),'0x'+'g'.repeat(40)]) {
      expect(()=>normalizeBlockedWallet(invalid)).toThrow();
    }
  });
  it('records the server, address, admin, and trimmed reason with one row per server/address', async () => {
    const {client,blocks}=database();client.single.mockResolvedValue({data:{address:wallet},error:null});
    await blocks.block(guild,'0x'+'A'.repeat(40),admin,' Shared asset ');
    expect(client.upsert).toHaveBeenCalledWith(expect.objectContaining({server_id:guild,address:wallet,wallet_type:'evm',blocked_by:admin,reason:'Shared asset'}),{onConflict:'server_id,address'});
    await expect(blocks.block(guild,wallet,admin,'x'.repeat(201))).rejects.toThrow('200');
    client.single.mockResolvedValue({data:null,error:{message:'permission denied'}});
    await expect(blocks.block(guild,wallet,admin)).rejects.toThrow('Could not save');
  });
  it('removes only the requested server’s block and reports when none existed', async () => {
    const {client,blocks}=database();client.select.mockResolvedValueOnce({data:[{address:wallet}],error:null});
    expect(await blocks.unblock(guild,'0x'+'A'.repeat(40))).toBe(true);
    expect(client.eq.mock.calls).toEqual([['server_id',guild],['address',wallet]]);
    client.select.mockResolvedValueOnce({data:[],error:null});
    expect(await blocks.unblock(guild,wallet)).toBe(false);
  });
  it('excludes a blocked wallet only in its server, shares reads within a run, and refreshes the next run', async () => {
    const {client,denied,blocks}=database();denied.set(guild,new Set([wallet]));
    const context={checks:new Map()};
    expect(await blocks.allowedAddresses(guild,[wallet,other,wallet.toUpperCase()],context)).toEqual([other]);
    expect(await blocks.allowedAddresses(guild,[other,wallet],context)).toEqual([other]);
    expect(client.in).toHaveBeenCalledTimes(1);
    expect(await blocks.allowedAddresses('another-server',[wallet])).toEqual([wallet]);
    denied.get(guild).clear();
    expect(await blocks.allowedAddresses(guild,[wallet],{checks:new Map()})).toEqual([wallet]);
  });
  it('rejects a fresh signature lookup even without an existing wallet link', async () => {
    const {denied,blocks}=database();denied.set(guild,new Set([bitcoin]));
    await expect(blocks.assertAllowed(guild,bitcoin)).rejects.toThrow(WALLET_BLOCKED);
  });
  it('fails closed on missing tables, failed reads, and malformed responses', async () => {
    const {client,blocks}=database();
    for (const response of [{data:null,error:{message:'missing table'}},{data:null,error:null},{data:[{address:other}],error:null}]) {
      client.in.mockResolvedValueOnce(response);
      await expect(blocks.assertAllowed(guild,wallet)).rejects.toThrow('Could not check');
    }
    client.in.mockRejectedValueOnce(new Error('network failure'));
    await expect(blocks.assertAllowed(guild,wallet)).rejects.toThrow('Could not check');
  });
  it('batches large linked-wallet lists without silently omitting blocks and paginates admin reads', async () => {
    const {client,denied,blocks}=database();const wallets=Array.from({length:205},(_,n)=>'0x'+n.toString(16).padStart(40,'0'));
    denied.set(guild,new Set([wallets[204]]));expect(await blocks.allowedAddresses(guild,wallets)).toHaveLength(204);
    expect(client.in.mock.calls.map(call=>call[1].length)).toEqual([100,100,5]);
    client.range.mockResolvedValue({data:[],count:20,error:null});
    expect(await blocks.list(guild,1,8)).toEqual({rows:[],total:20});
    expect(client.range).toHaveBeenCalledWith(8,15);
  });
});

describe('Wallet blocks across verification and earned-role reconciliation', () => {
  it.each(['ethscription','nft','erc20','ordinal'])('excludes blocked holdings from %s rules and keeps eligible stacked wallets', async assetType => {
    const {denied,blocks}=database();const address=assetType==='ordinal'?bitcoin:wallet;denied.set(guild,new Set([address]));
    const count=jest.fn(async (_rule,addresses)=>BigInt(addresses.length));
    const rule={...base,asset_type:assetType,...(assetType==='erc20'?{min_balance:'1',token_decimals:0,token_symbol:'TEST'}:{})};
    const addresses={getUserAddresses:jest.fn().mockResolvedValue([address])};
    const engine=new VerificationEngine({getRuleById:jest.fn().mockResolvedValue(rule)} as any,{count} as any,addresses as any,blocks);
    expect(await engine.verifyUser('member',1,address)).toMatchObject({status:'failed',matchingAssetCount:assetType==='erc20'?'0':0,verificationDetails:{blockedWallets:[address]}});
    expect(count).not.toHaveBeenCalled();
    addresses.getUserAddresses.mockResolvedValue([address,other]);
    expect(await engine.verifyUser('member',1,address)).toMatchObject({status:'passed'});
    expect(count.mock.calls[0][1]).toEqual([other]);
  });
  it('rejects blocked Bitcoin verification before storing/transferring the wallet or rechecking a previous owner', async () => {
    const {denied,blocks}=database();denied.set(guild,new Set([bitcoin]));
    const addresses={addUserAddress:jest.fn()};const roles={reverifyUser:jest.fn()};
    const signature={verify:jest.fn().mockResolvedValue({address:bitcoin,context:{}})};
    const service=new WalletService({} as any,addresses as any,{getUser:jest.fn()} as any,roles as any,blocks,signature as any);
    await expect(service.verifySignature({walletType:'bitcoin',discordId:guild} as any,'signed')).rejects.toThrow(WALLET_BLOCKED);
    expect(addresses.addUserAddress).not.toHaveBeenCalled();expect(roles.reverifyUser).not.toHaveBeenCalled();
  });
  it('revokes roles backed only by a blocked wallet, preserves another server, and restores earned roles after unblock', async () => {
    const {denied,blocks}=database();denied.set(guild,new Set([wallet]));
    const assignment={id:1,user_id:'member',server_id:guild,role_id:'holder',status:'active'};
    const db={getEarnedRoleAssignments:jest.fn().mockResolvedValue([assignment]),getRoleMappings:jest.fn(server=>Promise.resolve([{...base,server_id:server}])),
      saveRoleCheckDetails:jest.fn(),updateRoleAssignmentStatus:jest.fn(),updateLastVerified:jest.fn()};
    const ownership={count:jest.fn().mockResolvedValue(1n)};
    const engine=new VerificationEngine(db as any,ownership as any,{getUserAddresses:jest.fn().mockResolvedValue([wallet])} as any,blocks);
    const discord={removeUserRole:jest.fn().mockResolvedValue(true),addUserRoleDynamic:jest.fn().mockResolvedValue(true)};
    const roles=new DynamicRoleService(db as any,engine,discord as any);
    expect(await roles.reverifyUserInServer('member',guild)).toEqual({verified:0,revoked:1,errors:0});
    expect(db.getEarnedRoleAssignments).toHaveBeenCalledWith({userId:'member',serverId:guild});
    expect(discord.removeUserRole).toHaveBeenCalledWith('member',guild,'holder',expect.any(Map));
    expect(ownership.count).not.toHaveBeenCalled();
    expect((await engine.evaluateRole('member','other-server','holder')).status).toBe('passed');
    denied.get(guild).clear();assignment.status='revoked';
    expect(await roles.reverifyUserInServer('member',guild)).toEqual({verified:1,revoked:0,errors:0});
    expect(db.updateRoleAssignmentStatus).toHaveBeenLastCalledWith(1,'active');
  });
  it('preserves existing roles when wallet restrictions cannot be read', async () => {
    const {client,blocks}=database();client.in.mockResolvedValue({error:{message:'outage'},data:null});
    const db={getEarnedRoleAssignments:jest.fn().mockResolvedValue([{id:1,user_id:'member',server_id:guild,role_id:'holder',status:'active'}]),
      getRoleMappings:jest.fn().mockResolvedValue([base]),saveRoleCheckDetails:jest.fn(),updateRoleAssignmentStatus:jest.fn()};
    const count=jest.fn();const engine=new VerificationEngine(db as any,{count} as any,{getUserAddresses:jest.fn().mockResolvedValue([wallet])} as any,blocks);
    const discord={removeUserRole:jest.fn(),addUserRoleDynamic:jest.fn()};
    expect(await new DynamicRoleService(db as any,engine,discord as any).reverifyUserInServer('member',guild)).toEqual({verified:0,revoked:0,errors:1});
    expect(count).not.toHaveBeenCalled();expect(discord.removeUserRole).not.toHaveBeenCalled();expect(discord.addUserRoleDynamic).not.toHaveBeenCalled();
    expect(db.saveRoleCheckDetails).toHaveBeenCalledWith(1,expect.objectContaining({last_check_status:'unavailable'}));
  });
});

describe('Wallet block admin commands', () => {
  const row={server_id:guild,address:wallet,wallet_type:'evm',reason:'Shared asset',blocked_by:admin,blocked_at:new Date().toISOString()};
  function interaction(command='block-wallet',extra:Record<string,any>={}) {
    return {guildId:guild,user:{id:admin},memberPermissions:{has:jest.fn().mockReturnValue(true)},
      options:{getSubcommand:()=>command,getString:(key)=>key==='address'?wallet:key==='reason'?'Shared asset':null},
      reply:jest.fn(),deferReply:jest.fn(),editReply:jest.fn(),deferUpdate:jest.fn(),...extra} as any;
  }
  function handler() {
    const blocks={block:jest.fn().mockResolvedValue(row),unblock:jest.fn().mockResolvedValue(true),linkedUsers:jest.fn().mockResolvedValue(['member']),list:jest.fn().mockResolvedValue({rows:[row],total:1})};
    const roles={reverifyUserInServer:jest.fn().mockResolvedValue({verified:0,revoked:1,errors:0})};
    return {blocks,roles,handler:new WalletBlockHandler(blocks as any,roles as any)};
  }
  it('requires administrator permissions before changing or reading anything', async () => {
    const {blocks,handler:commands}=handler();const request=interaction('block-wallet',{memberPermissions:{has:jest.fn().mockReturnValue(false)}});
    await commands.handle(request);expect(request.reply).toHaveBeenCalled();expect(blocks.block).not.toHaveBeenCalled();expect(blocks.list).not.toHaveBeenCalled();
    expect(request.memberPermissions.has).toHaveBeenCalledWith(PermissionFlagsBits.Administrator);
  });
  it.each(['block-wallet','unblock-wallet'])('saves %s before immediately rechecking only earned roles in this server', async command => {
    const {blocks,roles,handler:commands}=handler();const request=interaction(command);await commands.handle(request);
    expect(blocks.linkedUsers).toHaveBeenCalledWith(wallet);expect(roles.reverifyUserInServer).toHaveBeenCalledWith('member',guild);
    expect(request.editReply.mock.calls.at(-1)[0].embeds[0].toJSON().description).toContain('rechecked');
  });
  it('reports a saved restriction when immediate checks fail instead of claiming the block failed', async () => {
    const {roles,handler:commands}=handler();roles.reverifyUserInServer.mockRejectedValue(new Error('provider outage'));
    const request=interaction();await commands.handle(request);
    expect(request.editReply.mock.calls.at(-1)[0].embeds[0].toJSON().description).toContain('restriction is saved');
  });
  it('does not recheck when the wallet was already unblocked', async () => {
    const {blocks,roles,handler:commands}=handler();blocks.unblock.mockResolvedValue(false);await commands.handle(interaction('unblock-wallet'));
    expect(roles.reverifyUserInServer).not.toHaveBeenCalled();
  });
  it('paginates a private list and rejects buttons from another member or server', async () => {
    const {blocks,handler:commands}=handler();blocks.list.mockResolvedValue({rows:Array.from({length:6},()=>({...row,address:bitcoin,reason:'`'.repeat(200)})),total:9});
    const request=interaction('list-blocked-wallets');await commands.handle(request);
    const reply=request.editReply.mock.calls[0][0];expect(reply.embeds[0].toJSON().description.length).toBeLessThanOrEqual(4096);
    expect(reply.embeds[0].toJSON().title).toContain('1/2');expect(reply.allowedMentions.parse).toEqual([]);
    const next=reply.components[0].toJSON().components[1].custom_id;
    blocks.list.mockResolvedValue({rows:[row],total:9});
    const button=interaction('list-blocked-wallets',{customId:next});await commands.handlePaginationButton(button);
    expect(blocks.list).toHaveBeenLastCalledWith(guild,1,6);
    expect(button.editReply.mock.calls[0][0].embeds[0].toJSON().title).toContain('2/2');
    blocks.list.mockClear();
    await commands.handlePaginationButton(interaction('list-blocked-wallets',{customId:next,user:{id:'111111111111111111'}}));
    await commands.handlePaginationButton(interaction('list-blocked-wallets',{customId:next,guildId:'111111111111111111'}));
    expect(blocks.list).not.toHaveBeenCalled();
  });
  it('returns a useful error if the administrator list cannot be read', async () => {
    const {blocks,handler:commands}=handler();blocks.list.mockRejectedValue(new Error('Could not list blocked wallets. Please try again.'));
    const request=interaction('list-blocked-wallets');await commands.handle(request);
    expect(request.editReply.mock.calls[0][0].embeds[0].toJSON().title).toContain('Failed');
  });
});
