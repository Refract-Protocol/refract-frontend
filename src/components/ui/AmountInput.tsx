"use client";

import { useId, useMemo } from "react";
import { Input } from "./Input";
import { parseAmount, USDC_DECIMALS } from "@/lib/format";

/**
 * Props for the {@link AmountInput} primitive.
 *
 * The component owns formatting, parsing and the quick-amount preset chips so
 * that money-entry surfaces do not re-implement (and mis-parse) them.
 */
export interface AmountInputProps {
  /** Raw string value of the input. Parsing is done via {@link parseAmount}. */
  value: string;
  /** Called with the raw string whenever the value changes. */
  onValueChange: (value: string) => void;
  /** Currency symbol used when formatting preset chips (e.g. `"$"`). */
  currency?: string;
  /** Quick-amount presets, typed as numbers and formatted for display. */
  presets?: number[];
  /** Optional minimum accepted value. */
  min?: number;
  /** Optional maximum accepted value. */
  max?: number;
  /**
   * Optional balance. When supplied, a `MAX` preset is appended that fills the
   * input with the balance.
   */
  balance?: number;
  /** Error message rendered by the underlying {@link Input}. */
  error?: string;
  /** Hint text rendered by the underlying {@link Input}. */
  hint?: string;
  /** Number of decimal places the asset supports. Defaults to USDC. */
  decimals?: number;
  /** Accessible label for the input. */
  label?: string;
  /** Placeholder for the input. */
  placeholder?: string;
  /** Disables the input and its preset chips. */
  disabled?: boolean;
  /** Additional class names for the wrapper. */
  className?: string;
}

/**
 * Format a numeric amount for display on a preset chip.
 *
 * @param amount - The numeric amount to format.
 * @param currency - Optional currency symbol prefix.
 * @returns A human-readable string such as `"$1,000"`.
 */
function formatPreset(amount: number, currency?: string): string {
  const formatted = amount.toLocaleString("en-US", {
    maximumFractionDigits: USDC_DECIMALS,
  });
  return currency ? `${currency}${formatted}` : formatted;
}

/**
 * Currency amount input with quick-amount preset chips.
 *
 * Composes the existing {@link Input} primitive so label/hint/error and
 * `aria-describedby` behaviour are inherited. Presets are numbers and are
 * formatted for display here — no string round-tripping. Parsing is delegated
 * to {@link parseAmount}, which returns `null` instead of `NaN`.
 */
export function AmountInput({
  value,
  onValueChange,
  currency,
  presets,
  min,
  max,
  balance,
  error,
  hint,
  decimals = USDC_DECIMALS,
  label,
  placeholder,
  disabled,
  className,
}: AmountInputProps) {
  const presetsId = useId();

  const chips = useMemo(() => {
    const list = (presets ?? []).map((amount) => ({
      key: `preset-${amount}`,
      amount,
      label: formatPreset(amount, currency),
      ariaLabel: `Set amount to ${formatPreset(amount, currency)}`,
    }));

    if (typeof balance === "number" && Number.isFinite(balance) && balance > 0) {
      list.push({
        key: "preset-max",
        amount: balance,
        label: "MAX",
        ariaLabel: `Set amount to maximum balance of ${formatPreset(
          balance,
          currency,
        )}`,
      });
    }

    return list;
  }, [presets, balance, currency]);

  /**
   * Clamp the number of decimal places to what the asset supports.
   *
   * @param input - Raw input string.
   * @returns The input with excess decimal places removed.
   */
  function clampDecimals(input: string): string {
    const separatorIndex = input.search(/[.,]/);
    if (separatorIndex === -1) return input;
    const head = input.slice(0, separatorIndex + 1);
    const tail = input.slice(separatorIndex + 1).replace(/[.,]/g, "");
    return head + tail.slice(0, decimals);
  }

  function handleChange(next: string) {
    onValueChange(clampDecimals(next));
  }

  function handlePreset(amount: number) {
    onValueChange(String(amount));
  }

  const parsed = parseAmount(value);
  const outOfRange =
    parsed !== null &&
    ((typeof min === "number" && parsed < min) ||
      (typeof max === "number" && parsed > max));

  return (
    <div className={className}>
      <Input
        label={label}
        hint={hint}
        error={error ?? (outOfRange ? "Amount is out of range" : undefined)}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => handleChange(event.target.value)}
        aria-describedby={chips.length > 0 ? presetsId : undefined}
      />
      {chips.length > 0 && (
        <div
          id={presetsId}
          role="group"
          aria-label="Quick amounts"
          className="mt-2 flex flex-wrap gap-2"
        >
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              disabled={disabled}
              aria-label={chip.ariaLabel}
              onClick={() => handlePreset(chip.amount)}
              className="rounded-full border border-neutral-700 px-3 py-1 text-sm text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default AmountInput;
