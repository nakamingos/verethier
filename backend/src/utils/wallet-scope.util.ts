/** null is a key-based proof; contract authorization applies only on proven chains. */
export function walletOnChain(
  wallet: { wallet_type?: string; evm_chain_ids?: number[] | null },
  chainId: number,
): boolean {
  return (
    (wallet.wallet_type === undefined || wallet.wallet_type === "evm") &&
    (wallet.evm_chain_ids == null || wallet.evm_chain_ids.includes(chainId))
  );
}
