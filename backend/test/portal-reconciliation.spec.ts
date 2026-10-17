import { VerificationEngine } from '../src/services/verification-engine.service';

describe('Fresh-proof reconciliation',()=>{
  const proof='0x1111111111111111111111111111111111111111';
  const rule={id:1,server_id:'server',role_id:'holder'};
  let engine:VerificationEngine,wallets:any;
  beforeEach(()=>{
    wallets={getUserAddresses:jest.fn().mockResolvedValue([])};
    engine=new VerificationEngine({getRoleMappings:jest.fn().mockResolvedValue([rule])} as any,{} as any,wallets,{} as any);
  });
  it('uses the verified address if its wallet-link insert has not finished',async()=>{
    const bulk=jest.spyOn(engine,'verifyUserBulk').mockResolvedValue({results:[{isValid:true}]} as any);
    const context={checks:new Map(),provenAddresses:new Map([['member',proof]])};
    expect((await engine.evaluateRole('member','server','holder',context)).status).toBe('passed');
    expect(bulk).toHaveBeenCalledWith('member',[1],proof,[rule],context);
  });
  it('does not use another member’s proof for an empty saved-wallet list',async()=>{
    const bulk=jest.spyOn(engine,'verifyUserBulk');
    expect((await engine.evaluateRole('other','server','holder',{checks:new Map(),provenAddresses:new Map([['member',proof]])})).status).toBe('failed');
    expect(bulk).not.toHaveBeenCalled();
  });
  it('does not turn a wallet database error into a failed ownership check',async()=>{
    wallets.getUserAddresses.mockRejectedValue(new Error('database unavailable'));
    await expect(engine.evaluateRole('member','server','holder',{checks:new Map()})).rejects.toThrow('database unavailable');
  });
});
