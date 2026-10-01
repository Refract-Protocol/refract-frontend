"use client";

import { useEffect, useState } from "react";
import { Input } from "./Input";
import { Button } from "./Button";
import { isFederationAddress, isStellarPublicKey, resolveFederationAddress } from "@/lib/stellar/federation";
import { truncateAddress } from "@/lib/wallet/WalletProvider";

interface AddressInputProps {
  label?: string;
  placeholder?: string;
  /** Called with the accepted `G...` public key, or `null` when the input no longer holds an accepted address. */
  onChange: (address: string | null) => void;
}

type Resolution =
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "resolving" }
  | { status: "resolved"; address: string }
  | { status: "failed" };

/**
 * Accepts a raw `G...` Stellar address or a federation address
 * (`name*domain.com`). Federation inputs are resolved and shown for explicit
 * confirmation before being passed to `onChange`.
 */
export function AddressInput({ label = "Stellar address", placeholder = "G… or name*domain.com", onChange }: AddressInputProps) {
  const [value, setValue] = useState("");
  const [resolution, setResolution] = useState<Resolution>({ status: "empty" });
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const input = value.trim();
    setConfirmed(false);
    onChange(null);

    if (!input) return setResolution({ status: "empty" });
    if (isStellarPublicKey(input)) {
      setResolution({ status: "resolved", address: input });
      onChange(input);
      return;
    }
    if (!isFederationAddress(input)) return setResolution({ status: "invalid" });

    let cancelled = false;
    setResolution({ status: "resolving" });
    // Debounce so we don't hit the federation server on every keystroke.
    const timer = setTimeout(() => {
      void resolveFederationAddress(input).then((address) => {
        if (!cancelled) setResolution(address ? { status: "resolved", address } : { status: "failed" });
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the typed value changes
  }, [value]);

  const isFederation = isFederationAddress(value.trim());
  const error =
    resolution.status === "invalid"
      ? "Enter a G… public key or a federation address like name*domain.com"
      : resolution.status === "failed"
        ? "Couldn't resolve this federation address"
        : undefined;

  return (
    <div className="w-full">
      <Input
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={error}
        hint={resolution.status === "resolving" ? "Resolving federation address…" : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      {isFederation && resolution.status === "resolved" && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-pm-violet/20 bg-pm-violet/[0.06] px-3 py-2 text-[11px]">
          <span className="text-pm-text/60">
            Resolves to <span className="font-mono text-pm-text" title={resolution.address}>{truncateAddress(resolution.address, 6, 6)}</span>
          </span>
          {confirmed ? (
            <span className="text-pm-green">✓ Confirmed</span>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setConfirmed(true);
                onChange(resolution.address);
              }}
            >
              Use this address
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
