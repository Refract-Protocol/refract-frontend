import { EXPECTED_NETWORK, EXPECTED_NETWORK_PASSPHRASE } from "@/lib/config";
import { useWallet } from "@/lib/wallet/WalletProvider";

/** Pure check behind `useNetworkGuard` — an unknown (not-yet-connected) network counts as correct. */
export function isExpectedNetwork(network: string | null, networkPassphrase: string | null): boolean {
  if (network === null && networkPassphrase === null) return true;
  if (networkPassphrase !== null) return networkPassphrase === EXPECTED_NETWORK_PASSPHRASE;
  return network?.toUpperCase() === EXPECTED_NETWORK;
}

/** Whether the connected wallet is on the network this app transacts against. */
export function useNetworkGuard(): { isCorrectNetwork: boolean; expectedNetwork: string; currentNetwork: string | null } {
  const { network, networkPassphrase } = useWallet();
  return {
    isCorrectNetwork: isExpectedNetwork(network, networkPassphrase),
    expectedNetwork: EXPECTED_NETWORK,
    currentNetwork: network,
  };
}
