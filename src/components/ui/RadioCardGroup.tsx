"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface RadioCardOption {
  /** Stable identifier used for selection and roving tabindex bookkeeping. */
  id: number | string;
  /** Whether this option can be selected. Disabled options are skipped by arrow navigation. */
  disabled?: boolean;
}

export interface RadioCardGroupProps<T extends RadioCardOption> {
  /** Ordered list of options to render. */
  options: T[];
  /** Currently selected option id. */
  value: T["id"];
  /** Fired with the full option object when the selection changes. */
  onChange: (option: T) => void;
  /** Shared radio group name, forwarded to each input for form semantics. */
  name: string;
  /** Accessible label for the radiogroup. */
  label: string;
  /** Layout direction for the option list. Defaults to vertical. */
  orientation?: "vertical" | "horizontal";
  /** Renders the primary label content for an option. */
  renderLabel: (option: T) => ReactNode;
  /** Renders the rich right-hand metadata column for an option. */
  renderOption?: (option: T) => ReactNode;
  /** Extra classes applied to each option card. */
  className?: string;
}

/**
 * Generic, token-styled radiogroup of selectable cards.
 *
 * Implements the WAI-ARIA radiogroup pattern: exactly one tab stop (roving
 * tabindex), arrow keys move and select, Home/End jump to the first/last
 * enabled option, and Space/Enter select the focused option. Disabled options
 * are marked `aria-disabled` and skipped during arrow navigation.
 */
export function RadioCardGroup<T extends RadioCardOption>({
  options,
  value,
  onChange,
  name,
  label,
  orientation = "vertical",
  renderLabel,
  renderOption,
  className,
}: RadioCardGroupProps<T>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const enabledIndexes = options.reduce<number[]>((acc, option, index) => {
    if (!option.disabled) acc.push(index);
    return acc;
  }, []);

  const selectedIndex = options.findIndex((option) => option.id === value);
  const focusIndex = selectedIndex >= 0 ? selectedIndex : enabledIndexes[0] ?? -1;

  function focusOption(index: number) {
    const option = options[index];
    if (!option) return;
    refs.current[String(option.id)]?.focus();
  }

  function moveSelection(direction: 1 | -1 | "first" | "last") {
    if (enabledIndexes.length === 0) return;
    const current = enabledIndexes.indexOf(focusIndex);
    let next: number;
    if (direction === "first") {
      next = enabledIndexes[0];
    } else if (direction === "last") {
      next = enabledIndexes[enabledIndexes.length - 1];
    } else {
      const base = current === -1 ? 0 : current;
      next = enabledIndexes[(base + direction + enabledIndexes.length) % enabledIndexes.length];
    }
    const option = options[next];
    if (!option) return;
    onChange(option);
    focusOption(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        moveSelection(1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        moveSelection(-1);
        break;
      case "Home":
        event.preventDefault();
        moveSelection("first");
        break;
      case "End":
        event.preventDefault();
        moveSelection("last");
        break;
      case " ":
      case "Enter": {
        const option = options[focusIndex];
        if (!option || option.disabled) return;
        event.preventDefault();
        onChange(option);
        break;
      }
      default:
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-orientation={orientation}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex gap-2.5",
        orientation === "vertical" ? "flex-col" : "flex-row flex-wrap",
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.id === value;
        const disabled = Boolean(option.disabled);
        return (
          <button
            key={option.id}
            ref={(node) => {
              refs.current[String(option.id)] = node;
            }}
            type="button"
            role="radio"
            name={name}
            aria-checked={selected}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => {
              if (disabled) return;
              onChange(option);
            }}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-violet focus-visible:ring-offset-2 focus-visible:ring-offset-pm-bg",
              selected
                ? "border-pm-violet bg-pm-violet/10 ring-1 ring-pm-violet"
                : "border-pm-border bg-pm-panel hover:border-pm-violet/40",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <span className="min-w-0 flex-1">{renderLabel(option)}</span>
            {renderOption && <span className="shrink-0">{renderOption(option)}</span>}
          </button>
        );
      })}
    </div>
  );
}
