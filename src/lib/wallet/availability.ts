/**
 * How far along Freighter is before the user connects. Detection limits:
 * Freighter exposes no direct "is locked" flag. `isAllowed()` answers
 * without unlocking, but `getAddress()` only returns an address for an
 * allowed dApp while the extension is unlocked — so an allowed dApp with
 * no address is reported as "locked". A dApp that was never allowed can't
 * be probed further without a popup, so a locked extension that has also
 * never granted access shows up as "installed-not-allowed".
 */
export type WalletAvailability = "not-installed" | "installed-not-allowed" | "locked" | "ready";

export interface FreighterProbe {
  /** `window.freighterApi` present and `isConnected()` resolved true. */
  installed: boolean;
  /** `isAllowed()` result; ignored when not installed. */
  allowed: boolean;
  /** `getAddress()` result (empty/undefined when locked or not allowed). */
  address?: string | null;
}

export function deriveAvailability({ installed, allowed, address }: FreighterProbe): WalletAvailability {
  if (!installed) return "not-installed";
  if (!allowed) return "installed-not-allowed";
  if (!address) return "locked";
  return "ready";
}
