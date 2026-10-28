import { PrivacyChoicesComponent } from '@/components/privacy-choices/privacy-choices.component';
import { privacyChoiceDraft } from '@/utils/privacy-choice.util';
import { AsyncPipe, NgTemplateOutlet } from '@angular/common';
import { Component } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';

import { BehaviorSubject, Observable, catchError, firstValueFrom, map, of, tap, switchMap, shareReplay } from 'rxjs';

import { WalletService } from '@/services/wallet.service';
import { BitcoinWalletProvider, BitcoinWalletService } from '@/services/bitcoin-wallet.service';

import { DecodedData } from '@/models/app.interface';

import { env } from 'src/env/env';
import type { GetAccountReturnType } from '@wagmi/core';

interface State {
  walletType: 'evm' | 'bitcoin';
  bitcoinProvider: BitcoinWalletProvider;
  walletTypes: Array<'evm' | 'bitcoin'>;
  walletConnecting: boolean;
  walletConnected: boolean;
  connectedAddress: string | null;
  messageSigning: boolean;
  verificationSubmitting: boolean;
  messageSigned: boolean;
  messageVerified: boolean;
  successMessage: string | null;
  errorMessage: string | null;
};

@Component({
    selector: 'app-verify',
    imports: [
        AsyncPipe,
        RouterLink,
        NgTemplateOutlet,
        PrivacyChoicesComponent
    ],
    providers: [
        BitcoinWalletService
    ],
    templateUrl: './verify.component.html',
    styleUrl: './verify.component.scss'
})
export class VerifyComponent {
  readonly fromMember = new URL(window.location.href).searchParams.get('from') === 'member';

  privacyPolicy: any = null;
  privacyChoice: any = null;
  routeData$!: Observable<DecodedData | null>;
  private evmAccount?: GetAccountReturnType;
  private errorSource: 'connection' | 'verification' | null = null;

  state$: BehaviorSubject<State> = new BehaviorSubject<State>({
    walletType: 'evm',
    bitcoinProvider: 'xverse',
    walletTypes: ['evm'],
    walletConnecting: false,
    walletConnected: false,
    connectedAddress: null,
    messageSigning: false,
    verificationSubmitting: false,
    messageSigned: false,
    messageVerified: false,
    successMessage: null,
    errorMessage: null,
  });

  constructor(
    private route: ActivatedRoute,
    public walletSvc: WalletService,
    private http: HttpClient,
    public bitcoinWalletSvc: BitcoinWalletService
  ) {

    // Resolve short links through the backend, while accepting existing encoded links.
    this.routeData$ = this.route.params.pipe(
      map((params: any) => this.decodeData(params.data)),
      switchMap(data => this.http.post<{ walletTypes: Array<'evm' | 'bitcoin'>; expiry: number; data?: DecodedData; privacy?: any }>(env.apiUrl + '/verification-context', {
        ...(data.userId !== undefined ? { userId: data.userId } : {}),
        ...(data.discordId !== undefined ? { discordId: data.discordId } : {}),
        nonce: data.nonce,
      }).pipe(map(context => {
        this.privacyPolicy = context.privacy || null;
        this.privacyChoice = context.privacy ? privacyChoiceDraft(context.privacy) : null;
        if (!context.walletTypes?.length) throw new Error('No supported wallets for this verification channel.');
        const resolvedData = { ...data, ...context.data, expiry: context.expiry };
        if (!resolvedData.userId || !resolvedData.discordId || !resolvedData.nonce
          || !resolvedData.userTag || !resolvedData.discordName) throw new Error('Missing verification context.');
        this.setState({ walletTypes: context.walletTypes });
        if (context.walletTypes.includes('bitcoin') && new URL(window.location.href).searchParams.get('wallet') === 'unisat') {
          this.setWalletType('bitcoin', 'unisat');
        } else this.setWalletType(context.walletTypes[0]);
        return resolvedData as DecodedData;
      }))),
      catchError((err) => {
        // Only log detailed errors in development (check for localhost)
        if (window.location.hostname === 'localhost') {
          // Error already handled by UI feedback
        }
        this.setState({ errorMessage: this.rateLimitMessage(err)
          || 'This verification link is no longer active. Please return to Discord and request a new one.' });
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    // Set connected state to local state
    this.walletSvc.connectedState$.pipe(
      tap((account) => {
        this.evmAccount = account;
        if (this.state$.value.walletType !== 'evm') return;
        this.setState({
          walletConnecting: account.isConnecting || account.isReconnecting,
          walletConnected: account.isConnected && !account.isReconnecting,
          connectedAddress: account.isConnected ? account.address || null : null,
        });
      }),
      takeUntilDestroyed(),
    ).subscribe();
    this.walletSvc.connectionErrors$.pipe(takeUntilDestroyed()).subscribe(errorMessage => {
      const state = this.state$.value;
      if (state.walletType !== 'evm') return;
      // AppKit can repeat CONNECT_SUCCESS while reusing an approved session.
      // Those notifications may clear a picker error, never a signing/API error.
      if (errorMessage === null) {
        if (this.errorSource === 'connection') this.setState({ errorMessage: null });
      } else if (!state.messageSigning && !state.verificationSubmitting && !state.messageVerified
        && this.errorSource !== 'verification') {
        this.setState({ errorMessage }, 'connection');
      }
    });
    this.bitcoinWalletSvc.address$.pipe(takeUntilDestroyed()).subscribe(address => {
      if (this.state$.value.walletType === 'bitcoin') {
        this.setState({ walletConnected: !!address, connectedAddress: address });
      }
    });
  }

  /**
   * Decodes the given data string and returns the decoded data as a shaped object.
   * @param data - The data string to decode.
   * @returns The decoded data object.
   * @throws Error if the decoding or parsing fails.
   */
  decodeData(data: string): Partial<DecodedData> {
    if (/^[a-f0-9]{64}$/.test(data)) return { nonce: data };
    const decodedData = atob(data);
    if (!decodedData) throw new Error('Failed to decode data');

    const arr = JSON.parse(decodedData);
    if (!arr) throw new Error('Failed to parse decoded data');

    return {
      address: '',  // Will be filled in when wallet is connected
      userId: arr[0],
      userTag: arr[1],
      avatar: arr[2],
      discordId: arr[3],
      discordName: arr[4],
      discordIcon: arr[5],
      nonce: arr[8],
      expiry: arr[9],
    } as DecodedData;
  }

  /**
   * Verifies the provided data by performing the following steps:
   * 1. Checks if the verification has expired.
   * 2. Creates a message to sign using the provided data.
   * 3. Signs the message using the wallet service.
   * 4. Sends the signed message and data to the server for verification.
   *
   * @param data - The decoded data to be verified.
   * @returns A Promise that resolves to void.
   */
  async verify(data: DecodedData): Promise<void> {
    if (!this.state$.value.walletConnected || this.state$.value.messageSigning
      || this.state$.value.verificationSubmitting || this.state$.value.messageVerified) return;

    // Check if verification has expired
    const expiry = new Date(data.expiry * 1000).getTime();
    const expired = expiry < Date.now();
    if (expired) return this.setState({ errorMessage: 'This verification link has expired.' });

    try {
      // Set signing state
      this.setState({
        messageSigning: true,
        verificationSubmitting: false,
        messageSigned: false,
        messageVerified: false,
        successMessage: null,
        errorMessage: null,
      });

      const evmAddress = this.state$.value.walletType === 'evm' ? await this.walletSvc.syncConnectedAccount() : undefined;
      // Create message to sign
      const domain = {
        name: 'Bouncer',
        version: '1',
        chainId: this.state$.value.walletType === 'evm' ? await this.walletSvc.getSigningChainId() : 1,
      };

      const types = {
        Verification: [
          { name: 'UserID', type: 'string' },
          { name: 'UserTag', type: 'string' },
          { name: 'ServerID', type: 'string' },
          { name: 'ServerName', type: 'string' },
          { name: 'Nonce', type: 'string' },
          { name: 'Expiry', type: 'uint256' },
        ]
      };

      const message = {
        UserID: data.userId,
        UserTag: data.userTag,
        ServerID: data.discordId,
        ServerName: data.discordName,
        Nonce: data.nonce,
        Expiry: data.expiry,
      };

      if (evmAddress) {
        types.Verification.push({ name: 'WalletAddress', type: 'address' });
        (message as any).WalletAddress = evmAddress;
      }
      const choice = this.privacyChoice ? { epoch: this.privacyChoice.epoch, share: this.privacyChoice.share, exports: this.privacyChoice.exports, notice: this.privacyChoice.notice } : undefined;
      if (choice) {
        types.Verification.push({ name: 'Privacy', type: 'string' });
        (message as any).Privacy = JSON.stringify(choice);
      }
      const typedData = {
        types,
        domain,
        message,
        primaryType: 'Verification',
      };

      let proof: { signature: string; address: string };
      let verificationData = { ...data, ...(this.state$.value.walletType === 'evm' ? { chainId: domain.chainId } : {}), ...(choice ? { privacy: choice } : {}), walletType: this.state$.value.walletType };
      if (verificationData.walletType === 'bitcoin') {
        const address = await this.bitcoinWalletSvc.syncConnectedAccount();
        const challenge = await firstValueFrom(this.http.post<{ address: string; message: string; expiry: number }>(env.apiUrl + '/bitcoin-challenge', {
          userId: data.userId, discordId: data.discordId, nonce: data.nonce, address, ...(choice ? { privacy: choice } : {}),
        }));
        proof = await this.bitcoinWalletSvc.signMessage(challenge.address, challenge.message);
        verificationData = { ...verificationData, expiry: challenge.expiry };
      } else {
        proof = await this.walletSvc.signTypedMessage(typedData);
      }
      const { signature, address } = proof;
      
      if (!signature) {
        return this.setState({
          messageSigning: false,
          verificationSubmitting: false,
          messageSigned: false,
          messageVerified: false,
          successMessage: null,
          errorMessage: 'Failed to sign message'
        });
      }

      // Keep the action locked while the verification request is in flight.
      this.setState({
        messageSigning: false,
        verificationSubmitting: true,
        messageSigned: true,
      });

      await firstValueFrom(
        this.http.post(env.apiUrl + '/verify-signature', {
          data: {
            ...verificationData,
            address
          },
          signature
        }).pipe(
          map((res: any) => {
            if (res.error) {
              this.setState({
                verificationSubmitting: false,
                messageVerified: false,
                successMessage: null,
                errorMessage: res.error
              });
              return;
            }

            this.setState({
              verificationSubmitting: false,
              messageVerified: true,
              successMessage: res?.walletOwnershipTransferred
                ? 'This wallet was previously linked to another Discord account and has now been moved to this account.'
                : null,
              errorMessage: null
            });
            return;
          }),
          catchError((error) => {
            // Handle HTTP errors (like when user doesn't have required assets)
            let errorMessage = 'Verification failed. Please try again.';
            
            // Try different ways to extract the error message
            if (error.error) {
              if (typeof error.error === 'string') {
                errorMessage = error.error;
              } else if (error.error.message) {
                errorMessage = error.error.message;
              }
            } else if (error.message) {
              errorMessage = error.message;
            }
            
            // If it's still the generic message, try to extract from statusText
            if (errorMessage === 'Verification failed. Please try again.' && error.statusText) {
              errorMessage = error.statusText;
            }

            errorMessage = this.rateLimitMessage(error) || errorMessage;

            if (
              errorMessage.includes('already verified by another user') &&
              this.state$.value.connectedAddress
            ) {
              errorMessage += ` Connected wallet: ${this.formatAddress(this.state$.value.connectedAddress)}.`;
            }
            
            this.setState({
              verificationSubmitting: false,
              messageVerified: false,
              successMessage: null,
              errorMessage
            });
            return of(null);
          })
        )
      );
    } catch (error) {
      // Handle wallet signing errors
      const responseError = error instanceof HttpErrorResponse ? error.error : null;
      const errorMessage = this.rateLimitMessage(error)
        || (typeof responseError === 'string' ? responseError : responseError?.message
          || (error instanceof Error ? error.message : 'Failed to sign message with wallet'));
      this.setState({ 
        messageSigning: false,
        verificationSubmitting: false,
        messageVerified: false,
        successMessage: null,
        errorMessage
      });
    }
  }

  /**
   * Updates the state of the subject by merging the provided partial state object
   * with the current state.
   *
   * @param state - The partial state object containing the properties to update.
   * @returns void
   */
  setState(state: Partial<State>, errorSource: 'connection' | 'verification' = 'verification'): void {
    if (state.errorMessage !== undefined) this.errorSource = state.errorMessage ? errorSource : null;
    this.state$.next({
      ...this.state$.value,
      ...state
    });
  }

  private rateLimitMessage(error: unknown): string | null {
    if (!(error instanceof HttpErrorResponse) || error.status !== 429) return null;
    const seconds = Math.ceil(Math.max(0, ...[
      'Retry-After', 'Retry-After-short', 'Retry-After-medium', 'Retry-After-long',
    ].map(header => Number(error.headers.get(header))).filter(Number.isFinite)));
    const wait = seconds > 0 ? `${seconds} second${seconds === 1 ? '' : 's'}` : 'a moment';
    return `Too many requests right now. Please wait ${wait} and try again.`;
  }

  selectWallet(walletType: 'evm' | 'bitcoin', bitcoinProvider?: BitcoinWalletProvider): void {
    const state = this.state$.value;
    if (!state.walletTypes.includes(walletType) || state.walletConnecting || state.messageSigning
      || state.verificationSubmitting || state.messageVerified) return;
    this.setWalletType(walletType, bitcoinProvider);
  }

  private setWalletType(walletType: 'evm' | 'bitcoin', bitcoinProvider?: BitcoinWalletProvider): void {
    const state = this.state$.value;
    this.bitcoinWalletSvc.disconnect();
    const account = walletType === 'evm' ? this.evmAccount : undefined;
    this.setState({ walletType, bitcoinProvider: walletType === 'bitcoin' ? bitcoinProvider || this.bitcoinWalletSvc.preferredProvider() : state.bitcoinProvider,
      walletConnecting: account?.isConnecting || account?.isReconnecting || false,
      walletConnected: !!account?.isConnected && !account.isReconnecting,
      connectedAddress: account?.isConnected ? account.address || null : null,
      messageSigning: false, verificationSubmitting: false, messageSigned: false, messageVerified: false,
      successMessage: null, errorMessage: null });
  }

  async connect(): Promise<void> {
    if (this.state$.value.walletConnecting || this.state$.value.messageSigning || this.state$.value.verificationSubmitting) return;
    this.setState({ walletConnecting: true, errorMessage: null });
    try {
      if (this.state$.value.walletType === 'bitcoin') await this.bitcoinWalletSvc.connect(this.state$.value.bitcoinProvider);
      else await this.walletSvc.connect();
    } catch (error) {
      this.setState({ errorMessage: error instanceof Error ? error.message : 'Could not connect your wallet.' });
    } finally {
      this.setState({ walletConnecting: false });
    }
  }

  openUniSatMobile(): void {
    const state = this.state$.value;
    if (state.walletType !== 'bitcoin' || state.bitcoinProvider !== 'unisat' || state.walletConnecting
      || state.messageSigning || state.verificationSubmitting || state.messageVerified) return;
    try { this.bitcoinWalletSvc.openUniSatMobile(); }
    catch (error) { this.setState({ errorMessage: error instanceof Error ? error.message : 'Could not open UniSat.' }); }
  }

  formatAddress(address: string | null): string {
    if (!address) {
      return '';
    }

    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
}
