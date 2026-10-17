import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { WalletService } from '../../services/wallet.service';
import { WalletCheckComponent } from './wallet-check.component';

describe('Wallet signing diagnostics', () => {
  let wallet: any;
  const signature = `0x${'11'.repeat(65)}`;
  const address = `0x${'22'.repeat(20)}`;

  beforeEach(async () => {
    const listeners = new Map();
    const events = { on: (event: string, listener: Function) => listeners.set(event, listener),
      off: (event: string) => listeners.delete(event) };
    wallet = {
      modal: { ready: async () => {}, getUniversalProvider: async () => ({
        client: { ...events, core: { relayer: { ...events, connected: true } } },
        ...events, removeListener: events.off,
      }), subscribeEvents: () => () => {} },
      connectedState$: new BehaviorSubject({ isConnected: true, isReconnecting: false }),
      signTypedMessage: jasmine.createSpy().and.resolveTo({ signature, address }),
      connect: jasmine.createSpy(),
    };
    await TestBed.configureTestingModule({ imports: [WalletCheckComponent], providers: [
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map() } } },
      { provide: WalletService, useValue: wallet },
    ] }).compileComponents();
  });

  it('reuses an approved session, signs only on demand, and exports no proof data', async () => {
    const fixture = TestBed.createComponent(WalletCheckComponent);
    const page = fixture.componentInstance;
    await page.start();
    expect(wallet.connect).not.toHaveBeenCalled();
    expect(wallet.signTypedMessage).not.toHaveBeenCalled();
    await page.sign();
    const typedData = wallet.signTypedMessage.calls.mostRecent().args[0];
    expect(typedData.domain.name).toBe('Bouncer Wallet Check');
    expect(typedData.primaryType).toBe('WalletCheck');
    expect(typedData.message.Purpose).toContain('does not verify holdings or change Discord roles');
    expect(typedData.message.Challenge).toMatch(/^[a-f0-9]{32}$/);
    expect(page.status()).toBe('Signature received successfully');
    await page.sign();
    expect(wallet.signTypedMessage.calls.mostRecent().args[0].message.Challenge).not.toBe(typedData.message.Challenge);
    for (const secret of [address, signature, typedData.message.Challenge]) expect(page.report).not.toContain(secret);
  });

  it('keeps one signing request pending and leaves the report available while waiting', async () => {
    let finish!: (proof: any) => void;
    wallet.signTypedMessage.and.returnValue(new Promise(resolve => { finish = resolve; }));
    const fixture = TestBed.createComponent(WalletCheckComponent);
    const page = fixture.componentInstance;
    await page.start();
    const pending = page.sign();
    await page.sign();
    fixture.detectChanges();
    expect(wallet.signTypedMessage).toHaveBeenCalledTimes(1);
    expect(page.status()).toBe('Waiting for the wallet signature');
    expect(fixture.nativeElement.querySelector('textarea').disabled).toBeFalse();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.find(button => button.textContent?.trim() === 'Test signature')?.disabled).toBeTrue();
    expect(buttons.find(button => button.textContent?.trim() === 'Copy connection details')?.disabled).toBeFalse();
    finish({ signature, address });
    await pending;
    expect(page.busy()).toBeFalse();
  });

  it('reports a rejected signature without including the wallet proof or connection link', async () => {
    wallet.signTypedMessage.and.rejectWith(new Error(`User rejected wc:private-link ${address}`));
    const page = TestBed.createComponent(WalletCheckComponent).componentInstance;
    await page.start();
    await page.sign();
    expect(page.status()).toBe('Signature failed');
    expect(page.report).toContain('User rejected');
    expect(page.report).not.toContain(address);
    expect(page.report).not.toContain('private-link');
    expect(page.busy()).toBeFalse();
  });
});
