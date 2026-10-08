import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, EMPTY, firstValueFrom } from 'rxjs';
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
  beforeEach(async () => {
    ethereum = { connectedState$: EMPTY, connect: jasmine.createSpy().and.resolveTo(), disconnectWeb3: jasmine.createSpy().and.resolveTo(), signTypedMessage: jasmine.createSpy().and.resolveTo({ address: '0x' + '1'.repeat(40), signature: 'eth-signature' }) };
    bitcoin = { address$: new BehaviorSubject<string | null>(null), disconnect: () => bitcoin.address$.next(null),
      connect: jasmine.createSpy().and.callFake(async () => bitcoin.address$.next(address)),
      syncConnectedAccount: jasmine.createSpy().and.resolveTo(address), signMessage: jasmine.createSpy().and.resolveTo({ address, signature: 'btc-signature' }) };
    const encoded = btoa(JSON.stringify(['user', 'User', '', 'guild', 'Guild', '', 'role', 'Holder', 'nonce', expiry]));
    routeParams = new BehaviorSubject({ data: encoded });
    await TestBed.configureTestingModule({ imports: [VerifyComponent], providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { params: routeParams } }],
    }).overrideComponent(VerifyComponent, { set: { providers: [{ provide: WalletService, useValue: ethereum }, { provide: BitcoinWalletService, useValue: bitcoin }] } }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function page(walletTypes: string[]) {
    const fixture = TestBed.createComponent(VerifyComponent);
    fixture.detectChanges();
    http.expectOne(request => request.url.endsWith('/verification-context')).flush({ walletTypes, expiry });
    fixture.detectChanges();
    return fixture;
  }

  it('selects Xverse automatically for an Ordinals-only channel', () => {
    const fixture = page(['bitcoin']);
    expect(fixture.componentInstance.state$.value.walletType).toBe('bitcoin');
    expect(fixture.nativeElement.textContent).toContain('Connect your Xverse wallet');
    expect(fixture.nativeElement.querySelector('.wallet-choice')).toBeNull();
  });

  it('keeps the existing Ethereum flow for an Ethereum-only channel', () => {
    const fixture = page(['evm']);
    expect(fixture.componentInstance.state$.value.walletType).toBe('evm');
    expect(fixture.nativeElement.querySelector('.wallet-choice')).toBeNull();
  });

  it('offers a small choice in mixed channels and resets the previous connection', async () => {
    const fixture = page(['evm', 'bitcoin']);
    expect(fixture.nativeElement.querySelectorAll('.wallet-choice button').length).toBe(2);
    fixture.componentInstance.selectWallet('bitcoin');
    await fixture.componentInstance.connect();
    expect(bitcoin.connect).toHaveBeenCalled();
    expect(ethereum.connect).not.toHaveBeenCalled();
    expect(fixture.componentInstance.state$.value.connectedAddress).toBe(address);
    fixture.componentInstance.selectWallet('evm');
    expect(fixture.componentInstance.state$.value.connectedAddress).toBeNull();
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
    expect(ethereum.signTypedMessage).toHaveBeenCalledWith(jasmine.objectContaining({ message: {
      UserID: resolvedData.userId, UserTag: resolvedData.userTag, ServerID: resolvedData.discordId,
      ServerName: resolvedData.discordName, Nonce: resolvedData.nonce, Expiry: resolvedData.expiry,
    } }));
    const verify = http.expectOne(request => request.url.endsWith('/verify-signature'));
    expect(verify.request.body.data).toEqual({ ...resolvedData, walletType: 'evm', address: '0x' + '1'.repeat(40) });
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
