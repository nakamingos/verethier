import { COINBASE_SIGNER_TYPE_KEY, isBaseAccount } from './smart-wallet.util';

describe('Base Account detection', () => {
  afterEach(() => localStorage.removeItem(COINBASE_SIGNER_TYPE_KEY));
  const account = (id: string, isConnected = true) => ({ isConnected, connector: { id } });
  it('recognises the Base Account connector', () => {
    expect(isBaseAccount(account('baseAccount'))).toBeTrue();
    expect(isBaseAccount(account('baseAccount', false))).toBeFalse();
  });
  it('recognises a Coinbase smart wallet through the Coinbase Wallet connector', () => {
    localStorage.setItem(COINBASE_SIGNER_TYPE_KEY, 'scw');
    expect(isBaseAccount(account('coinbaseWalletSDK'))).toBeTrue();
  });
  it('treats the Coinbase Wallet app key and unknown signers as ordinary wallets', () => {
    expect(isBaseAccount(account('coinbaseWalletSDK'))).toBeFalse();
    localStorage.setItem(COINBASE_SIGNER_TYPE_KEY, 'walletlink');
    expect(isBaseAccount(account('coinbaseWalletSDK'))).toBeFalse();
  });
  it('never treats other wallets as Base Account', () => {
    localStorage.setItem(COINBASE_SIGNER_TYPE_KEY, 'scw');
    expect(isBaseAccount(account('injected'))).toBeFalse();
    expect(isBaseAccount(account('walletConnect'))).toBeFalse();
  });
});
