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

describe('Member portal wallet disconnect', () => {
  let component: any;
  beforeEach(() => {
    component = Object.create(MemberComponent.prototype);
    Object.assign(component, {
      evm: { disconnectWeb3: jasmine.createSpy('disconnectWeb3').and.resolveTo() },
      solana: { disconnect: jasmine.createSpy('solana'), disconnectWallet: jasmine.createSpy('solana approval').and.resolveTo() },
      bitcoin: { disconnect: jasmine.createSpy('bitcoin') },
      busy: false, connecting: false, networkSwitching: false, disconnecting: false, error: '',
      walletKind: 'evm', address: '0xabc', evmAddress: '0xabc',
      linkFlow: { id: 'flow' }, transferProof: { flow: 'flow', signature: '0x' }, transferPending: true,
    });
  });
  it('ends the EVM session and clears any pending link or transfer', async () => {
    await component.disconnectWallet();
    expect(component.evm.disconnectWeb3).toHaveBeenCalled();
    expect(component.address).toBe('');
    expect(component.evmAddress).toBe('');
    expect(component.linkFlow).toBeNull();
    expect(component.transferProof).toBeNull();
    expect(component.transferPending).toBeFalse();
    expect(component.disconnecting).toBeFalse();
  });
  it('disconnects the selected Solana or Bitcoin wallet', async () => {
    component.walletKind = 'solana';
    await component.disconnectWallet();
    expect(component.solana.disconnectWallet).toHaveBeenCalled();
    component.walletKind = 'xverse';
    component.address = 'bc1p';
    await component.disconnectWallet();
    expect(component.bitcoin.disconnect).toHaveBeenCalled();
    expect(component.evm.disconnectWeb3).not.toHaveBeenCalled();
  });
  it('waits for a running action and reports a failed disconnect', async () => {
    component.busy = true;
    await component.disconnectWallet();
    expect(component.evm.disconnectWeb3).not.toHaveBeenCalled();
    component.busy = false;
    component.evm.disconnectWeb3.and.rejectWith(new Error('boom'));
    await component.disconnectWallet();
    expect(component.error).toBe('Could not disconnect your wallet. Please try again.');
    expect(component.address).toBe('0xabc');
  });
});
