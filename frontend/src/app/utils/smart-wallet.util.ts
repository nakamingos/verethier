/**
 * Coinbase Wallet SDK 4 records which signer the member picked in its popup:
 * 'scw' is the Coinbase smart wallet (now Base Account), 'walletlink' is the
 * Coinbase Wallet app's own key. Recheck this key when upgrading the SDK.
 */
export const COINBASE_SIGNER_TYPE_KEY = '-CBWSDK:SignerConfigurator:SignerType';

/**
 * A Base Account, whether connected through AppKit's Base Account connector or,
 * as on phones, through its Coinbase Wallet connector. These accounts have no
 * network control of their own, so Bouncer offers a network chooser.
 */
export function isBaseAccount(account: { isConnected: boolean; connector?: { id: string } }): boolean {
  if (!account.isConnected) return false;
  if (account.connector?.id === 'baseAccount') return true;
  if (account.connector?.id !== 'coinbaseWalletSDK') return false;
  try {
    return localStorage.getItem(COINBASE_SIGNER_TYPE_KEY) === 'scw';
  } catch {
    return false;
  }
}

/** Phones and tablets, where Discord opens links in its own built-in browser. */
export const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
