import { MemberComponent } from './member.component';

describe('Member portal Base Account network choice', () => {
  let component: any, evm: any;
  beforeEach(() => {
    evm = {
      evmNetworks: [{ id: 1, name: 'Ethereum' }, { id: 8453, name: 'Base' }],
      switchNetwork: jasmine.createSpy('switchNetwork').and.callFake(async (id: number) => id),
    };
    component = Object.create(MemberComponent.prototype);
    Object.assign(component, { evm, busy: false, connecting: false, networkSwitching: false, evmChainId: 8453, error: '' });
  });
  it('switches the wallet network and records the result', async () => {
    await component.chooseNetwork(1);
    expect(evm.switchNetwork).toHaveBeenCalledWith(1);
    expect(component.evmChainId).toBe(1);
    expect(component.networkSwitching).toBeFalse();
  });
  it('does nothing for the current network or while busy', async () => {
    await component.chooseNetwork(8453);
    component.busy = true;
    await component.chooseNetwork(1);
    expect(evm.switchNetwork).not.toHaveBeenCalled();
  });
  it('shows a declined switch and keeps the previous network', async () => {
    evm.switchNetwork.and.rejectWith(new Error('The network change was declined. Try again when you are ready.'));
    await component.chooseNetwork(1);
    expect(component.evmChainId).toBe(8453);
    expect(component.error).toMatch(/declined/);
    expect(component.networkSwitching).toBeFalse();
  });
  it('lists networks only once the wallet service exists', () => {
    expect(component.evmNetworks.length).toBe(2);
    component.evm = undefined;
    expect(component.evmNetworks).toEqual([]);
  });
});
