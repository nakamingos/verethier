import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BouncerLogService } from '../src/services/bouncer-log.service';
import { PortalService } from '../src/portal/portal.service';
import { PortalSettingsDto } from '../src/portal/portal.dto';
import { BOUNCER_LOG_EVENTS } from '../src/models/bouncer-log.interface';

const server='111111111111111111', user='222222222222222222', channel='333333333333333333', role='444444444444444444';
const job={id:'12345678-1234-4000-8000-123456789abc',server_id:server,user_id:user,channel_id:channel,kind:'verification_success',source:'discord',config_version:'v1',occurred_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),attempts:1};
function fixture() {
  let settings:any={log_channel_id:channel,log_events:[...BOUNCER_LOG_EVENTS],log_version:'v1'};
  const query:any={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),maybeSingle:jest.fn(async()=>({data:settings,error:null})),delete:jest.fn().mockReturnThis(),update:jest.fn().mockReturnThis()};
  query.then=(resolve:any)=>Promise.resolve({error:null}).then(resolve);
  const db={from:jest.fn(()=>query),rpc:jest.fn().mockResolvedValue({error:null})};
  const privacy={assertActive:jest.fn().mockResolvedValue(undefined),policy:jest.fn().mockResolvedValue({share_since:'2020-01-01T00:00:00Z'}),visible:jest.fn((since,time)=>!!since && Date.parse(time)>=Date.parse(since))};
  const send=jest.fn().mockResolvedValue({id:'message'}),has=jest.fn().mockReturnValue(true);
  const logChannel={id:channel,type:ChannelType.GuildText,guild:{id:server},permissionsFor:()=>({has}),send};
  const guild={id:server,channels:{fetch:jest.fn().mockResolvedValue(logChannel)},members:{fetch:jest.fn().mockResolvedValue({}),fetchMe:jest.fn().mockResolvedValue({})}};
  const service=new BouncerLogService(db as any,privacy as any);
  service.initialize({guilds:{cache:new Map([[server,guild]])}} as any);
  return {service,db,query,privacy,send,has,guild,logChannel,setSettings:(v:any)=>{settings=v}};
}
describe('Bouncer Discord channel log',()=>{
  it.each(BOUNCER_LOG_EVENTS)('sends %s without secrets, arbitrary error text or pings',async kind=>{
    const f=fixture();await (f.service as any).deliver({...job,kind,role_id:role,address:'0x-secret',nonce:'secret-token',reason:'raw-provider-error-secret'});
    const message=f.send.mock.calls[0][0];
    expect(message.content).toContain(`<@${user}>`);expect(message.content).toContain('<t:');
    expect(message.content).not.toMatch(/0x-secret|secret-token|raw-provider-error-secret|undefined/);
    expect(message.allowedMentions).toEqual({parse:[]});expect(message.enforceNonce).toBe(true);expect(message.nonce.length).toBeLessThanOrEqual(25);
  });
  it.each([null,{log_channel_id:null,log_events:[...BOUNCER_LOG_EVENTS],log_version:'v1'},{log_channel_id:channel,log_events:[],log_version:'v1'},{log_channel_id:channel,log_events:[...BOUNCER_LOG_EVENTS],log_version:'changed'}])('discards disabled or stale configurations',async settings=>{
    const f=fixture();f.setSettings(settings);await (f.service as any).deliver(job);expect(f.send).not.toHaveBeenCalled();
  });
  it('discards expired events and events for members who left',async()=>{
    const f=fixture();await (f.service as any).deliver({...job,expires_at:new Date(0).toISOString()});
    f.guild.members.fetch.mockRejectedValue({code:10007});await (f.service as any).deliver(job);expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['wallet_added','wallet_removed'])('rechecks sharing permission before delivering %s',async kind=>{
    const f=fixture();f.privacy.policy.mockResolvedValue({share_since:null});
    await (f.service as any).deliver({...job,kind});expect(f.send).not.toHaveBeenCalled();
    f.privacy.policy.mockResolvedValue({share_since:new Date(Date.now()+5000).toISOString()});
    await (f.service as any).deliver({...job,kind});expect(f.send).not.toHaveBeenCalled();
  });
  it('discards events while deletion is processing and retries privacy lookup outages',async()=>{
    const f=fixture();f.privacy.assertActive.mockRejectedValue(new ConflictException());await (f.service as any).deliver(job);expect(f.send).not.toHaveBeenCalled();
    f.privacy.assertActive.mockRejectedValue(new Error('db unavailable'));await expect((f.service as any).deliver(job)).rejects.toThrow();expect(f.send).not.toHaveBeenCalled();
  });
  it('refuses cross-server, non-text and inaccessible channels',async()=>{
    const f=fixture();f.logChannel.guild.id='other';await expect((f.service as any).deliver(job)).rejects.toThrow();
    f.logChannel.guild.id=server;f.has.mockReturnValue(false);await expect((f.service as any).deliver(job)).rejects.toThrow();expect(f.send).not.toHaveBeenCalled();
    expect(f.has).toHaveBeenCalledWith([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]);
  });
  it('sends a stable nonce on retries and retains failed sends',async()=>{
    const f=fixture();f.send.mockRejectedValue(new Error('Discord offline'));
    await (f.service as any).process(job);
    expect(f.query.update).toHaveBeenCalledWith(expect.objectContaining({locked_by:null,locked_until:null,available_at:expect.any(String)}));
    expect(f.query.delete).not.toHaveBeenCalled();
    f.send.mockResolvedValue({id:'sent'});await (f.service as any).process(job);
    expect(f.send.mock.calls[0][0].nonce).toEqual(f.send.mock.calls[1][0].nonce);expect(f.query.delete).toHaveBeenCalledTimes(1);
  });
  it('does not propagate an enqueue outage into verification or role operations',async()=>{
    const f=fixture();f.db.rpc.mockRejectedValue(new Error('db offline'));
    await expect(f.service.record(server,user,'role_added','background',role)).resolves.toBeUndefined();
  });
});
describe('Log configuration authorization and validation',()=>{
  it('validates channels, event choices and input shape',async()=>{
    for(const input of [{log_channel_id:'wrong'},{log_events:['anything']},{log_events:'wallet_added'}]) {
      const dto=plainToInstance(PortalSettingsDto,{background_checks_enabled:true,...input});
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
    expect(await validate(plainToInstance(PortalSettingsDto,{background_checks_enabled:true,log_channel_id:null,log_events:[...BOUNCER_LOG_EVENTS]}))).toEqual([]);
  });
  it('requires ordinary server management access and validates bot permissions before saving',async()=>{
    const s:any=Object.create(PortalService.prototype), f=fixture();
    s.access=jest.fn().mockResolvedValue(f.guild);s.channel=jest.fn().mockResolvedValue(f.logChannel);s.settings=jest.fn().mockResolvedValue({});
    const upsert=jest.fn().mockResolvedValue({error:null});s.db={from:()=>({upsert})};
    await s.saveSettings({user:{id:user}},server,{background_checks_enabled:true,log_channel_id:channel,log_events:['role_added']});
    expect(s.access).toHaveBeenCalled();expect(upsert).toHaveBeenCalledWith(expect.objectContaining({log_channel_id:channel,log_events:['role_added']}));
    f.has.mockReturnValue(false);await expect(s.saveSettings({user:{id:user}},server,{background_checks_enabled:true,log_channel_id:channel})).rejects.toThrow('View Channel');
    expect(upsert).toHaveBeenCalledTimes(1);
  });
  it('leaves logging settings intact when older clients omit them',async()=>{
    const s:any=Object.create(PortalService.prototype);s.access=jest.fn().mockResolvedValue({});s.settings=jest.fn().mockResolvedValue({});
    const upsert=jest.fn().mockResolvedValue({error:null});s.db={from:()=>({upsert})};
    await s.saveSettings({user:{id:user}},server,{background_checks_enabled:false});
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('log_channel_id');expect(upsert.mock.calls[0][0]).not.toHaveProperty('log_events');
  });
});

describe('Bouncer event integration',()=>{
  it.each([
    ['Collection verification is temporarily unavailable. Please try again.','provider_unavailable'],
    ['No verification rules found for this channel','requirements_changed'],
    ['Address does not meet any verification requirements','no_assets'],
    ['Provider error contains private diagnostics','verification_failed'],
  ])('logs a signed failure with a fixed reason for %s',async(error,reason)=>{
    const {VerifyService}=require('../src/services/verify.service');
    const service:any=Object.create(VerifyService.prototype);
    service.discordVerificationSvc={retainVerificationRequest:jest.fn().mockReturnValue(()=>{})};
    service.walletSvc={verifySignature:jest.fn().mockResolvedValue({address:'0x-private-wallet',activity:{source:'portal'}})};
    service.activityLog={record:jest.fn().mockResolvedValue(undefined)};
    service.completeVerification=jest.fn().mockRejectedValue(new Error(error));
    await expect(service.verifySignatureFlow({userId:user,discordId:server},'private-signature')).rejects.toThrow(error);
    expect(service.activityLog.record).toHaveBeenCalledWith(server,user,'verification_failed','portal',undefined,reason);
    expect(JSON.stringify(service.activityLog.record.mock.calls)).not.toMatch(/private-wallet|private-signature|private diagnostics/);
  });
  it('does not attribute an unproven request to a Discord member',async()=>{
    const {VerifyService}=require('../src/services/verify.service');
    const service:any=Object.create(VerifyService.prototype);
    service.discordVerificationSvc={retainVerificationRequest:jest.fn().mockReturnValue(()=>{})};
    service.walletSvc={verifySignature:jest.fn().mockRejectedValue(new Error('Invalid signature'))};
    service.activityLog={record:jest.fn()};
    await expect(service.verifySignatureFlow({userId:user,discordId:server},'bad-signature')).rejects.toThrow('Invalid signature');
    expect(service.activityLog.record).not.toHaveBeenCalled();
  });
  it('logs actual role changes and stays quiet on repeated checks',async()=>{
    const {DiscordVerificationService}=require('../src/services/discord-verification.service');
    const service:any=Object.create(DiscordVerificationService.prototype);
    const member:any={roles:{cache:new Map(),add:jest.fn(),remove:jest.fn()}};
    const discordRole={id:role,name:'Holder'};
    member.roles.add.mockImplementation(async()=>{member.roles.cache.set(role,discordRole);return member});
    member.roles.remove.mockImplementation(async()=>{member.roles.cache.delete(role);return member});
    const guild={name:'Server',members:{fetch:jest.fn().mockResolvedValue(member)},roles:{fetch:jest.fn().mockResolvedValue(discordRole)}};
    service.client={guilds:{fetch:jest.fn().mockResolvedValue(guild)}};
    service.privacy={assertActive:jest.fn().mockResolvedValue(undefined)};
    service.roleActions={blockedBy:jest.fn().mockResolvedValue(false)};
    service.activityLog={record:jest.fn().mockResolvedValue(undefined)};
    await service.addUserRoleDynamic(user,server,role);await service.addUserRoleDynamic(user,server,role);
    expect(service.activityLog.record).toHaveBeenCalledTimes(1);
    expect(service.activityLog.record).toHaveBeenCalledWith(server,user,'role_added','background',role);
    await service.removeUserRole(user,server,role);await service.removeUserRole(user,server,role);
    expect(service.activityLog.record).toHaveBeenCalledTimes(2);
    expect(service.activityLog.record).toHaveBeenLastCalledWith(server,user,'role_removed','background',role);
    member.roles.add.mockRejectedValue(new Error('Discord denied'));
    expect(await service.addUserRoleDynamic(user,server,role)).toBe(false);
    expect(service.activityLog.record).toHaveBeenCalledTimes(2);
  });
});
