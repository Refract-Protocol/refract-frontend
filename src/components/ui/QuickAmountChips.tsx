import { cn } from "@/lib/cn";

export interface QuickAmountChip {
  label: string;
  /** Pre-computed value handed to `onSelect` — callers own the fixed vs. percentage-of-balance math. */
  value: string;
  disabled?: boolean;
}

interface QuickAmountChipsProps {
  chips: QuickAmountChip[];
  onSelect: (value: string) => void;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Row of preset-amount buttons shown under an amount input. Purely
 * presentational: renders the given entries and reports the selected value.
 */
export function QuickAmountChips({ chips, onSelect, size = "md", className }: QuickAmountChipsProps) {
  return (
    <div className={cn("mt-2 flex gap-1.5", className)}>
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          disabled={chip.disabled}
          onClick={() => onSelect(chip.value)}
          className={cn(
            "flex-1 rounded border border-pm-violet/15 text-pm-violet disabled:opacity-30",
            size === "md" ? "bg-pm-violet/[0.08] py-1.5 text-[11px]" : "bg-pm-violet/[0.06] py-1 text-[10px]"
          )}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
