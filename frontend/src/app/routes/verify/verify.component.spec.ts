import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Subject, firstValueFrom } from 'rxjs';
import { VerifyComponent } from './verify.component';
import { WalletService } from '../../services/wallet.service';
import { BitcoinWalletService } from '../../services/bitcoin-wallet.service';

const address = 'bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler';
const expiry = Math.floor(Date.now() / 1000) + 300;
const data = { userId: 'user', userTag: 'User', avatar: '', discordId: 'guild', discordName: 'Guild', discordIcon: '', nonce: 'nonce', expiry, address: '' };

describe('Verification page wallet choice', () => {
  let http: HttpTestingController;
  let ethereum: any;
  let bitcoin: any;
  let routeParams: BehaviorSubject<{ data: string }>;
  let originalUrl: string;
  beforeEach(async () => {
    originalUrl = window.location.href;
    ethereum = { syncConnectedAccount: jasmine.createSpy().and.resolveTo('0x' + '1'.repeat(40)), getSigningChainId: jasmine.createSpy().and.resolveTo(1), connectedState$: new BehaviorSubject({ isConnecting: false, isConnected: false }), connectionErrors$: new Subject<string | null>(), connect: jasmine.createSpy().and.resolveTo(), disconnectWeb3: jasmine.createSpy().and.resolveTo(), signTypedMessage: jasmine.createSpy().and.resolveTo({ address: '0x' + '1'.repeat(40), signature: 'eth-signature' }) };
    bitcoin = { address$: new BehaviorSubject<string | null>(null), disconnect: () => bitcoin.address$.next(null),
      preferredProvider: jasmine.createSpy().and.returnValue('xverse'), isUniSatAvailable: jasmine.createSpy().and.returnValue(false),
      openUniSatMobile: jasmine.createSpy(),
      connect: jasmine.createSpy().and.callFake(async () => bitcoin.address$.next(address)),
      syncConnectedAccount: jasmine.createSpy().and.resolveTo(address), signMessage: jasmine.createSpy().and.resolveTo({ address, signature: 'btc-signature' }) };
    const encoded = btoa(JSON.stringify(['user', 'User', '', 'guild', 'Guild', '', 'role', 'Holder', 'nonce', expiry]));
    routeParams = new BehaviorSubject({ data: encoded });
    await TestBed.configureTestingModule({ imports: [VerifyComponent], providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { params: routeParams } }],
    }).overrideComponent(VerifyComponent, { set: { providers: [{ provide: WalletService, useValue: ethereum }, { provide: BitcoinWalletService, useValue: bitcoin }] } }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); history.replaceState(null, '', originalUrl); });

  function page(walletTypes: string[]) {
    const fixture = TestBed.createComponent(VerifyComponent);
    fixture.detectChanges();
    http.expectOne(request => request.url.endsWith('/verification-context')).flush({ walletTypes, expiry });
    fixture.detectChanges();
    return fixture;
  }

  it('uses Connect Phantom without a competing mobile action on desktop', async () => {
    const fixture = page(['solana']);
    const wallet = fixture.componentInstance.solanaWalletSvc;
    spyOn(wallet, 'canOpenPhantomMobile').and.returnValue(false);
    const connect = spyOn(wallet, 'connect').and.resolveTo('So11111111111111111111111111111111111111112');
    fixture.detectChanges();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.some((button) => button.textContent?.includes('Open in Phantom app'))).toBeFalse();
    buttons.find((button) => button.textContent?.includes('Connect Phantom'))!.click();
    await fixture.whenStable();
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it('shows the app handoff separately when needed on mobile', () => {
    const fixture = page(['solana']);
    const wallet = fixture.componentInstance.solanaWalletSvc;
    spyOn(wallet, 'canOpenPhantomMobile').and.returnValue(true);
    const open = spyOn(wallet, 'openPhantomMobile');
    fixture.detectChanges();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    buttons.find((button) => button.textContent?.includes('Open in Phantom app'))!.click();
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('selects Solana after returning through the Phantom mobile app', () => {
    history.replaceState(null, '', '?wallet=phantom');
    const fixture = page(['evm', 'solana']);
    expect(fixture.componentInstance.state$.value.walletType).toBe('solana');
  });
  it('ignores the Phantom preference when the channel has no Solana rules', () => {
    history.replaceState(null, '', '?wallet=phantom');
    const fixture = page(['evm']);
    expect(fixture.componentInstance.state$.value.walletType).toBe('evm');
  });
  it('selects Xverse automatically for an Ordinals-only channel', () => {
    const fixture = page(['bitcoin']);
    expect(fixture.componentInstance.state$.value.walletType).toBe('bitcoin');
    expect(fixture.nativeElement.textContent).toContain('Connect your Xverse wallet');
    expect(fixture.nativeElement.querySelectorAll('.wallet-choice button').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.bitcoin-wallet-choice button').length).toBe(2);
  });

  it('keeps the existing Ethereum flow for an Ethereum-only channel', () => {
    const fixture = page(['evm']);
    expect(fixture.componentInstance.state$.value.walletType).toBe('evm');
    expect(fixture.nativeElement.querySelector('.wallet-choice')).toBeNull();
  });

  it('retains an approved Ethereum session on a fresh link and still requires a signature', () => {
    const evmAddress = '0x' + '1'.repeat(40);
    ethereum.connectedState$.next({ isConnecting: false, isConnected: true, address: evmAddress });
    const fixture = page(['evm']);
    expect(fixture.componentInstance.state$.value).toEqual(jasmine.objectContaining({
      walletConnected: true, connectedAddress: evmAddress, messageSigned: false, messageVerified: false,
    }));
    expect(fixture.nativeElement.querySelector('.step-2').classList.contains('active')).toBeTrue();
    expect(ethereum.disconnectWeb3).not.toHaveBeenCalled();
    expect(ethereum.signTypedMessage).not.toHaveBeenCalled();
    const changeWallet = Array.from(fixture.nativeElement.querySelectorAll('.step-2 button'))
      .find((button: any) => button.textContent.trim() === 'Change wallet') as HTMLButtonElement;
    changeWallet.click();
    expect(ethereum.connect).toHaveBeenCalledTimes(1);
  });

  it('restores the Ethereum account after switching back from Bitcoin without disconnecting it', () => {
    const fixture = page(['evm', 'bitcoin']);
    const evmAddress = '0x' + '2'.repeat(40);
    fixture.componentInstance.selectWallet('bitcoin');
    ethereum.connectedState$.next({ isConnecting: false, isConnected: true, address: evmAddress });
    expect(fixture.componentInstance.state$.value.connectedAddress).toBeNull();
    fixture.componentInstance.selectWallet('evm');
    expect(fixture.componentInstance.state$.value).toEqual(jasmine.objectContaining({
      walletConnected: true, connectedAddress: evmAddress,
    }));
    expect(ethereum.disconnectWeb3).not.toHaveBeenCalled();
  });

  it('selects Bitcoin-only context even while Ethereum is restoring a session', () => {
    ethereum.connectedState$.next({ isConnecting: true, isConnected: false });
    const fixture = page(['bitcoin']);
    expect(fixture.componentInstance.state$.value).toEqual(jasmine.objectContaining({
      walletType: 'bitcoin', walletConnecting: false, walletConnected: false,
    }));
    expect(ethereum.disconnectWeb3).not.toHaveBeenCalled();
  });

  it('waits for session restoration before enabling signing with a saved address', () => {
    const evmAddress = '0x' + '1'.repeat(40);
    ethereum.connectedState$.next({ isConnecting: false, isReconnecting: true, isConnected: true, address: evmAddress });
    const fixture = page(['evm']);
    expect(fixture.componentInstance.state$.value.walletConnected).toBeFalse();
    expect(fixture.nativeElement.querySelector('.step-2 button').disabled).toBeTrue();
    ethereum.connectedState$.next({ isConnecting: false, isReconnecting: false, isConnected: true, address: evmAddress });
    fixture.detectChanges();
    expect(fixture.componentInstance.state$.value.walletConnected).toBeTrue();
    expect(fixture.nativeElement.querySelector('.step-2 button').disabled).toBeFalse();
  });

  it('disables changing the Ethereum wallet during signing and verification', () => {
    ethereum.connectedState$.next({ isConnecting: false, isConnected: true, address: '0x' + '1'.repeat(40) });
    const fixture = page(['evm']);
    for (const busy of [{ messageSigning: true, verificationSubmitting: false }, { messageSigning: false, verificationSubmitting: true }]) {
      fixture.componentInstance.setState(busy); fixture.detectChanges();
      const buttons = Array.from(fixture.nativeElement.querySelectorAll('.step-2 button')) as HTMLButtonElement[];
      expect(buttons.every(button => button.disabled)).toBeTrue();
    }
  });

  it('keeps Connect disabled until the Ethereum picker finishes, then allows another attempt', async () => {
    let dismiss!: () => void;
    ethereum.connect.and.returnValue(new Promise<void>(resolve => { dismiss = resolve; }));
    const fixture = page(['evm']);
    const pending = fixture.componentInstance.connect();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.step-1 button').disabled).toBeTrue();
    await fixture.componentInstance.connect();
    expect(ethereum.connect).toHaveBeenCalledTimes(1);
    dismiss(); await pending; fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.step-1 button').disabled).toBeFalse();
  });

  it('shows Ethereum picker errors and clears them when another wallet is selected', () => {
    const fixture = page(['evm', 'bitcoin']);
    ethereum.connectionErrors$.next('A wallet connection request is already pending.');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('A wallet connection request is already pending.');
    ethereum.connectionErrors$.next(null);
    expect(fixture.componentInstance.state$.value.errorMessage).toBeNull();
    fixture.componentInstance.selectWallet('bitcoin');
    ethereum.connectionErrors$.next('Ethereum connection failed');
    expect(fixture.componentInstance.state$.value.errorMessage).toBeNull();
  });

  it('keeps a signing error visible when AppKit reports an already-connected wallet again', async () => {
    const fixture = page(['evm']);
    const component = fixture.componentInstance;
    ethereum.connectedState$.next({ isConnected: true, isConnecting: false });
    ethereum.signTypedMessage.and.rejectWith(new Error('A signature request is already pending.'));
    await component.verify(data);
    ethereum.connectionErrors$.next(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('A signature request is already pending.');
    http.expectNone(request => request.url.endsWith('/verify-signature'));
  });

  it('keeps a verification rejection visible through repeated connection notifications', async () => {
    const fixture = page(['evm']);
    const component = fixture.componentInstance;
    ethereum.connectedState$.next({ isConnected: true, isConnecting: false });
    const pending = component.verify(data);
    await new Promise(resolve => setTimeout(resolve, 0));
    http.expectOne(request => request.url.endsWith('/verify-signature')).flush(
      { message: 'This verification link is no longer active.' }, { status: 400, statusText: 'Bad Request' },
    );
    await pending;
    ethereum.connectionErrors$.next('Late connection notification');
    ethereum.connectionErrors$.next(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('This verification link is no longer active.');
    expect(fixture.nativeElement.textContent).not.toContain('Late connection notification');
    expect(component.state$.value.messageVerified).toBeFalse();
  });

  it('explains a rate-limited context request without claiming the link has expired', () => {
    const fixture = TestBed.createComponent(VerifyComponent);
    fixture.detectChanges();
    http.expectOne(request => request.url.endsWith('/verification-context')).flush(
      { message: 'ThrottlerException: Too Many Requests' }, { status: 429, statusText: 'Too Many Requests' },
    );
    ethereum.connectionErrors$.next(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Too many requests right now. Please wait a moment and try again.');
    expect(fixture.nativeElement.textContent).not.toContain('no longer active');
    expect(ethereum.connect).not.toHaveBeenCalled();
  });

  it('shows a rate-limit retry delay and preserves it when a wallet session refreshes', async () => {
    const fixture = page(['evm']);
    const component = fixture.componentInstance;
    ethereum.connectedState$.next({ isConnected: true, isConnecting: false });
    const pending = component.verify(data);
    await new Promise(resolve => setTimeout(resolve, 0));
    http.expectOne(request => request.url.endsWith('/verify-signature')).flush(
      { message: 'ThrottlerException: Too Many Requests' },
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After-short': '2' } },
    );
    await pending;
    ethereum.connectionErrors$.next(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Too many requests right now. Please wait 2 seconds and try again.');
    expect(component.state$.value.verificationSubmitting).toBeFalse();
  });

  it('offers a small choice in mixed channels and resets the previous connection', async () => {
    const fixture = page(['evm', 'bitcoin']);
    expect(fixture.nativeElement.querySelectorAll('.wallet-choice button').length).toBe(2);
    fixture.componentInstance.selectWallet('bitcoin');
    await fixture.componentInstance.connect();
    expect(bitcoin.connect).toHaveBeenCalledWith('xverse');
    expect(ethereum.connect).not.toHaveBeenCalled();
    expect(fixture.componentInstance.state$.value.connectedAddress).toBe(address);
    fixture.componentInstance.selectWallet('evm');
    expect(fixture.componentInstance.state$.value.connectedAddress).toBeNull();
  });

  it('connects and signs with the selected UniSat provider using the existing Bitcoin endpoints', async () => {
    bitcoin.isUniSatAvailable.and.returnValue(true);
    const fixture = page(['evm','bitcoin']); const component = fixture.componentInstance;
    expect(fixture.nativeElement.querySelector('.bitcoin-wallet-choice')).toBeNull();
    expect(Array.from(fixture.nativeElement.querySelectorAll('.wallet-choice button')).map((button: any) => button.textContent.trim())).toEqual(['EVM', 'Bitcoin']);
    fixture.nativeElement.querySelector('[aria-label="Bitcoin"]').click(); fixture.detectChanges();
    const choice = fixture.nativeElement.querySelector('[aria-label="Bitcoin with UniSat"]'); choice.click();
    fixture.detectChanges();
    expect(component.state$.value.bitcoinProvider).toBe('unisat');
    expect(fixture.nativeElement.textContent).toContain('Connect your UniSat wallet');
    await component.connect(); expect(bitcoin.connect).toHaveBeenCalledWith('unisat');
    const pending = component.verify(data); await Promise.resolve();
    http.expectOne(request => request.url.endsWith('/bitcoin-challenge')).flush({ address, message: 'UniSat challenge\nNonce: nonce', expiry });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(bitcoin.signMessage).toHaveBeenCalledWith(address, 'UniSat challenge\nNonce: nonce');
    const proof = http.expectOne(request => request.url.endsWith('/verify-signature'));
    expect(proof.request.body.data.walletType).toBe('bitcoin'); expect(proof.request.body.data.address).toBe(address);
    expect(proof.request.body.data.walletProvider).toBeUndefined();
    proof.flush({ assignedRoles: ['holder'] }); await pending;
    expect(component.state$.value.messageVerified).toBeTrue(); expect(ethereum.signTypedMessage).not.toHaveBeenCalled();
  });

  it('offers a mobile app launch when UniSat is not injected and Connect inside its browser', () => {
    const fixture = page(['bitcoin']); const component = fixture.componentInstance;
    component.selectWallet('bitcoin','unisat'); fixture.detectChanges();
    const button = Array.from(fixture.nativeElement.querySelectorAll('.step-1 button')).find((button: any) => button.textContent.includes('Open in UniSat')) as HTMLButtonElement;
    expect(button).toBeTruthy(); button.click(); expect(bitcoin.openUniSatMobile).toHaveBeenCalledTimes(1);
    expect(bitcoin.connect).not.toHaveBeenCalled();
    bitcoin.isUniSatAvailable.and.returnValue(true); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.step-1 .actions button .button-label > span:not([aria-hidden])').textContent).toBe('Connect');
  });

  it('selects UniSat automatically inside its browser for an Ordinals-only channel', () => {
    bitcoin.preferredProvider.and.returnValue('unisat'); bitcoin.isUniSatAvailable.and.returnValue(true);
    const fixture = page(['bitcoin']);
    expect(fixture.componentInstance.state$.value.bitcoinProvider).toBe('unisat');
    expect(fixture.nativeElement.querySelector('[aria-label="Bitcoin with UniSat"]').getAttribute('aria-pressed')).toBe('true');
    expect(bitcoin.connect).not.toHaveBeenCalled();
  });

  it('retains the explicit UniSat mobile selection after opening the same link in a mixed channel', () => {
    const target = new URL(window.location.href); target.searchParams.set('wallet','unisat'); history.replaceState(null,'',target);
    const fixture = page(['evm','bitcoin']);
    expect(fixture.componentInstance.state$.value.walletType).toBe('bitcoin');
    expect(fixture.componentInstance.state$.value.bitcoinProvider).toBe('unisat');
    expect(bitcoin.connect).not.toHaveBeenCalled();
  });

  it('does not let a mobile selection hint override an Ethereum-only verification context', () => {
    const target = new URL(window.location.href); target.searchParams.set('wallet','unisat'); history.replaceState(null,'',target);
    const fixture = page(['evm']); expect(fixture.componentInstance.state$.value.walletType).toBe('evm');
    expect(fixture.nativeElement.querySelector('.wallet-choice')).toBeNull();
  });

  it('clears the previous account when switching Bitcoin wallet providers', async () => {
    const fixture = page(['bitcoin']); const component = fixture.componentInstance;
    await component.connect(); component.setState({ messageSigned: true, errorMessage: 'Old error' });
    component.selectWallet('bitcoin','unisat');
    expect(component.state$.value).toEqual(jasmine.objectContaining({ bitcoinProvider:'unisat',walletConnected:false,connectedAddress:null,messageSigned:false,errorMessage:null }));
  });

  it('keeps provider changes and app launches locked during signing and submission', async () => {
    const fixture = page(['bitcoin']); const component = fixture.componentInstance;
    component.selectWallet('bitcoin','unisat'); await component.connect();
    component.setState({ messageSigning:true }); component.selectWallet('bitcoin','xverse'); component.openUniSatMobile();
    fixture.detectChanges();
    expect(component.state$.value.bitcoinProvider).toBe('unisat'); expect(component.state$.value.connectedAddress).toBe(address);
    expect(Array.from(fixture.nativeElement.querySelectorAll('.wallet-choice button')).every((button:any)=>button.disabled)).toBeTrue();
    expect(bitcoin.openUniSatMobile).not.toHaveBeenCalled();
    component.setState({messageSigning:false,verificationSubmitting:true}); component.selectWallet('bitcoin','xverse'); component.openUniSatMobile();
    expect(component.state$.value.bitcoinProvider).toBe('unisat'); expect(bitcoin.openUniSatMobile).not.toHaveBeenCalled();
  });

  it('shows a mobile-launch error without starting a wallet signature or submitting a proof', () => {
    const fixture = page(['bitcoin']); const component = fixture.componentInstance;
    component.selectWallet('bitcoin','unisat'); bitcoin.openUniSatMobile.and.throwError('Could not open UniSat'); component.openUniSatMobile();
    expect(component.state$.value.errorMessage).toBe('Could not open UniSat'); expect(bitcoin.signMessage).not.toHaveBeenCalled();
    http.expectNone(request => request.url.endsWith('/verify-signature'));
  });

  it('signs the server challenge and submits the Bitcoin proof with its exact expiry', async () => {
    const fixture = page(['bitcoin']);
    const component = fixture.componentInstance;
    await component.connect();
    const pending = component.verify(data);
    await Promise.resolve();
    const challenge = http.expectOne(request => request.url.endsWith('/bitcoin-challenge'));
    expect(challenge.request.body.address).toBe(address);
    challenge.flush({ address, message: 'trusted server message', expiry: expiry - 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(bitcoin.signMessage).toHaveBeenCalledWith(address, 'trusted server message');
    const verify = http.expectOne(request => request.url.endsWith('/verify-signature'));
    expect(verify.request.body.data).toEqual(jasmine.objectContaining({ address, walletType: 'bitcoin', expiry: expiry - 1 }));
    expect(component.state$.value.verificationSubmitting).toBeTrue();
    await component.verify(data);
    http.expectNone(request => request.url.endsWith('/bitcoin-challenge'));
    verify.flush({ assignedRoles: ['holder'] });
    await pending;
    expect(component.state$.value.messageVerified).toBeTrue();
    expect(ethereum.signTypedMessage).not.toHaveBeenCalled();
  });

  it('shows the server challenge error and allows retry without submitting a signature', async () => {
    const fixture = page(['bitcoin']);
    const component = fixture.componentInstance;
    await component.connect();
    const pending = component.verify(data);
    await Promise.resolve();
    http.expectOne(request => request.url.endsWith('/bitcoin-challenge')).flush({ message: 'Request a new verification link from Discord.' }, { status: 400, statusText: 'Bad Request' });
    await pending;
    expect(component.state$.value.errorMessage).toBe('Request a new verification link from Discord.');
    expect(component.state$.value.messageSigning).toBeFalse();
    expect(bitcoin.signMessage).not.toHaveBeenCalled();
    http.expectNone(request => request.url.endsWith('/verify-signature'));
  });

  it('shows an expired context without starting a wallet connection', () => {
    const fixture = TestBed.createComponent(VerifyComponent);
    fixture.detectChanges();
    http.expectOne(request => request.url.endsWith('/verification-context')).flush('expired', { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('return to Discord');
    expect(bitcoin.connect).not.toHaveBeenCalled();
  });

  async function shortLinkPage(walletType: 'evm' | 'bitcoin') {
    const nonce = 'a'.repeat(64);
    const trustedData = { ...data, nonce, userTag: '🍕 User', discordName: '🍕 Comrades' };
    routeParams.next({ data: nonce });
    const fixture = TestBed.createComponent(VerifyComponent);
    fixture.detectChanges();
    const request = http.expectOne(request => request.url.endsWith('/verification-context'));
    expect(request.request.body).toEqual({ nonce });
    request.flush({ walletTypes: [walletType], expiry, data: trustedData });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(trustedData.discordName);
    const resolvedData = await firstValueFrom(fixture.componentInstance.routeData$);
    expect(resolvedData).toEqual(trustedData);
    return { fixture, resolvedData: resolvedData! };
  }

  it('signs and submits the saved Ethereum identity after resolving a short link', async () => {
    const { fixture, resolvedData } = await shortLinkPage('evm');
    const component = fixture.componentInstance;
    component.state$.next({ ...component.state$.value, walletConnected: true });
    const pending = component.verify(resolvedData);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(ethereum.signTypedMessage).toHaveBeenCalledWith(jasmine.objectContaining({ domain: {
      name: 'Bouncer', version: '1', chainId: 1,
    }, message: {
      UserID: resolvedData.userId, UserTag: resolvedData.userTag, ServerID: resolvedData.discordId,
      ServerName: resolvedData.discordName, Nonce: resolvedData.nonce, Expiry: resolvedData.expiry, WalletAddress: '0x' + '1'.repeat(40),
    } }));
    const verify = http.expectOne(request => request.url.endsWith('/verify-signature'));
    expect(verify.request.body.data).toEqual({ ...resolvedData, walletType: 'evm', chainId: 1, address: '0x' + '1'.repeat(40) });
    verify.flush({ assignedRoles: ['holder'] });
    await pending;
    expect(component.state$.value.messageVerified).toBeTrue();
  });

  it('uses the saved Discord IDs and token for the Xverse challenge and proof', async () => {
    const { fixture, resolvedData } = await shortLinkPage('bitcoin');
    const component = fixture.componentInstance;
    await component.connect();
    const pending = component.verify(resolvedData);
    await Promise.resolve();
    const challenge = http.expectOne(request => request.url.endsWith('/bitcoin-challenge'));
    expect(challenge.request.body).toEqual({ userId: resolvedData.userId, discordId: resolvedData.discordId, nonce: resolvedData.nonce, address });
    challenge.flush({ address, message: 'trusted server message', expiry });
    await new Promise(resolve => setTimeout(resolve, 0));
    const verify = http.expectOne(request => request.url.endsWith('/verify-signature'));
    expect(verify.request.body.data).toEqual({ ...resolvedData, walletType: 'bitcoin', address });
    verify.flush({ assignedRoles: ['holder'] });
    await pending;
    expect(component.state$.value.messageVerified).toBeTrue();
  });

  it('shows an inactive link if the short-link response is missing its Discord context', () => {
    routeParams.next({ data: 'a'.repeat(64) });
    const fixture = page(['bitcoin']);
    expect(fixture.nativeElement.textContent).toContain('return to Discord');
    expect(bitcoin.connect).not.toHaveBeenCalled();
    expect(ethereum.signTypedMessage).not.toHaveBeenCalled();
  });
});
