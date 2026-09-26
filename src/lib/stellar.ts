import { Networks } from '@stellar/stellar-sdk';
import { usePreferencesStore } from './store/preferencesStore';
import { useWallet } from './wallet/WalletProvider';

/**
 * Resolves the Stellar network used for block-explorer links.
 *
 * Resolution order:
 * 1. An explicit `explorerNetwork` preference (`testnet` | `public`) always wins.
 * 2. `auto` derives the network from the connected wallet's reported network
 *    (`network` / `networkPassphrase`).
 * 3. When no wallet is connected (or its network is unknown), `auto` falls back
 *    to testnet, matching the previous hardcoded behaviour so existing links
 *    keep working.
 */
export function useExplorerNetwork(): 'testnet' | 'public' {
  const explorerNetwork = usePreferencesStore((s) => s.explorerNetwork);
  const { network, networkPassphrase } = useWallet();

  if (explorerNetwork === 'testnet' || explorerNetwork === 'public') {
    return explorerNetwork;
  }

  if (network === 'PUBLIC' || networkPassphrase === Networks.PUBLIC) {
    return 'public';
  }

  return 'testnet';
}

/**
 * Builds a StellarExpert transaction URL for the given transaction hash.
 *
 * The network is taken from the preferences store (see `useExplorerNetwork`),
 * defaulting to `auto`, which derives it from the connected wallet's network and
 * falls back to testnet when no wallet is connected.
 */
export function useStellarExpertTxUrl(txHash: string): string {
  const network = useExplorerNetwork();
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}
