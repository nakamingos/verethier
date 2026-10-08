import { AsyncPipe, NgTemplateOutlet } from '@angular/common';
import { Component } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';

import { BehaviorSubject, Observable, catchError, firstValueFrom, map, of, tap, switchMap, shareReplay } from 'rxjs';

import { WalletService } from '@/services/wallet.service';
import { BitcoinWalletService } from '@/services/bitcoin-wallet.service';

import { DecodedData } from '@/models/app.interface';

import { env } from 'src/env/env';

interface State {
  walletType: 'evm' | 'bitcoin';
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
        NgTemplateOutlet
    ],
    providers: [
        WalletService,
        BitcoinWalletService
    ],
    templateUrl: './verify.component.html',
    styleUrl: './verify.component.scss'
})
export class VerifyComponent {

  routeData$!: Observable<DecodedData | null>;

  state$: BehaviorSubject<State> = new BehaviorSubject<State>({
    walletType: 'evm',
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
      switchMap(data => this.http.post<{ walletTypes: Array<'evm' | 'bitcoin'>; expiry: number; data?: DecodedData }>(env.apiUrl + '/verification-context', {
        ...(data.userId !== undefined ? { userId: data.userId } : {}),
        ...(data.discordId !== undefined ? { discordId: data.discordId } : {}),
        nonce: data.nonce,
      }).pipe(map(context => {
        if (!context.walletTypes?.length) throw new Error('No supported wallets for this verification channel.');
        const resolvedData = { ...data, ...context.data, expiry: context.expiry };
        if (!resolvedData.userId || !resolvedData.discordId || !resolvedData.nonce
          || !resolvedData.userTag || !resolvedData.discordName) throw new Error('Missing verification context.');
        this.setState({ walletTypes: context.walletTypes });
        this.selectWallet(context.walletTypes[0]);
        return resolvedData as DecodedData;
      }))),
      catchError((err) => {
        // Only log detailed errors in development (check for localhost)
        if (window.location.hostname === 'localhost') {
          // Error already handled by UI feedback
        }
        this.setState({ errorMessage: 'This verification link is no longer active. Please return to Discord and request a new one.' });
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    // Set connected state to local state
    this.walletSvc.connectedState$.pipe(
      tap((account) => {
        if (this.state$.value.walletType !== 'evm') return;
        this.setState({
          walletConnecting: account.isConnecting,
          walletConnected: account.isConnected,
          connectedAddress: account.isConnected ? account.address || null : null,
        });
      }),
      takeUntilDestroyed(),
    ).subscribe();
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

      // Create message to sign
      const domain = {
        name: 'verethier',
        version: '1',
        chainId: 1,
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

      const typedData = {
        types,
        domain,
        message,
        primaryType: 'Verification',
      };

      let proof: { signature: string; address: string };
      let verificationData = { ...data, walletType: this.state$.value.walletType };
      if (verificationData.walletType === 'bitcoin') {
        const address = await this.bitcoinWalletSvc.syncConnectedAccount();
        const challenge = await firstValueFrom(this.http.post<{ address: string; message: string; expiry: number }>(env.apiUrl + '/bitcoin-challenge', {
          userId: data.userId, discordId: data.discordId, nonce: data.nonce, address,
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
      const errorMessage = typeof responseError === 'string' ? responseError : responseError?.message
        || (error instanceof Error ? error.message : 'Failed to sign message with wallet');
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
  setState(state: Partial<State>): void {
    this.state$.next({
      ...this.state$.value,
      ...state
    });
  }

  selectWallet(walletType: 'evm' | 'bitcoin'): void {
    if (!this.state$.value.walletTypes.includes(walletType)) return;
    this.bitcoinWalletSvc.disconnect();
    void this.walletSvc.disconnectWeb3();
    this.setState({ walletType, walletConnecting: false, walletConnected: false, connectedAddress: null,
      messageSigning: false, verificationSubmitting: false, messageSigned: false, messageVerified: false,
      successMessage: null, errorMessage: null });
  }

  async connect(): Promise<void> {
    if (this.state$.value.walletConnecting || this.state$.value.messageSigning || this.state$.value.verificationSubmitting) return;
    this.setState({ walletConnecting: true, errorMessage: null });
    try {
      if (this.state$.value.walletType === 'bitcoin') await this.bitcoinWalletSvc.connect();
      else await this.walletSvc.connect();
    } catch (error) {
      this.setState({ errorMessage: error instanceof Error ? error.message : 'Could not connect your wallet.' });
    } finally {
      this.setState({ walletConnecting: false });
    }
  }

  formatAddress(address: string | null): string {
    if (!address) {
      return '';
    }

    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
}
