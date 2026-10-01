import { Networks } from '@stellar/stellar-sdk';
import { usePreferencesStore } from './store/preferencesStore';
import { useWallet } from './wallet/WalletProvider';

/**
 * Refract only runs on Stellar testnet right now (see refract-backend's
 * .env.example — STELLAR_NETWORK defaults to testnet, and mainnet keys are
 * explicitly disallowed there). Hardcoded to the testnet explorer until
 * there's a mainnet deploy and the network becomes configurable here too.
 *
 * Validation contract: Stellar transaction hashes are 64-character hex
 * strings. `isValidTxHash` accepts them case-insensitively (uppercase hex is
 * normalised rather than rejected) and rejects anything else, including the
 * placeholder hashes carried by fixture claim records. `stellarExpertTxUrl`
 * returns `null` for invalid hashes so callers never render a real-looking
 * explorer link that leads to a dead page.
 */
const TX_HASH_PATTERN = /^[0-9a-f]{64}$/i;

export function isValidTxHash(hash: string | null | undefined): hash is string {
  return typeof hash === 'string' && TX_HASH_PATTERN.test(hash);
}

export function stellarExpertTxUrl(txHash: string): string | null {
  if (!isValidTxHash(txHash)) {
    return null;
  }

  return `https://stellar.expert/explorer/testnet/tx/${txHash.toLowerCase()}`;
}

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
