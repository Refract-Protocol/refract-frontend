"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

/** A single choice rendered inside the {@link Select} listbox. */
export interface SelectOption<T> {
  /** Value committed via `onChange` when the option is chosen. */
  value: T;
  /** Primary text shown in the trigger and the option row. */
  label: string;
  /** Optional secondary text rendered under the label. */
  description?: string;
  /** Optional leading icon/slot rendered before the label. */
  icon?: ReactNode;
  /** Prevents the option from being selected. */
  disabled?: boolean;
}

/** Props for {@link Select}; mirrors the label/hint/error API of `Input`. */
export interface SelectProps<T> {
  options: SelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  /** Optional helper text shown when there is no error. */
  hint?: string;
  /** Accessible name when no visible `label` is provided. */
  "aria-label"?: string;
  className?: string;
}

/**
 * Accessible custom select (button + listbox popup).
 *
 * Implements the WAI-ARIA combobox/listbox pattern: the trigger exposes
 * `role="combobox"` with `aria-expanded`/`aria-controls`/`aria-activedescendant`,
 * and the popup is a `role="listbox"` of `role="option"` children. Supports
 * Up/Down/Home/End navigation, first-letter typeahead, Enter/Space to select,
 * Escape to close and restore focus, and Tab to close and commit. The popup
 * flips above the trigger when there is no room below and matches its width.
 */
export function Select<T>({
  options,
  value,
  onChange,
  label,
  placeholder = "Select…",
  disabled = false,
  error,
  hint,
  "aria-label": ariaLabel,
  className,
}: SelectProps<T>) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeaheadRef = useRef<{ query: string; timer: number | null }>({
    query: "",
    timer: null,
  });

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;

  const firstEnabled = useCallback(
    (from: number, step: 1 | -1) => {
      if (options.length === 0) return -1;
      let index = from;
      for (let i = 0; i < options.length; i += 1) {
        index = (index + step + options.length) % options.length;
        if (!options[index].disabled) return index;
      }
      return -1;
    },
    [options],
  );

  const openList = useCallback(() => {
    if (disabled || options.length === 0) return;
    const start = selectedIndex >= 0 ? selectedIndex : firstEnabled(-1, 1);
    setActiveIndex(start);
    setOpen(true);
  }, [disabled, options.length, selectedIndex, firstEnabled]);

  const closeList = useCallback((restoreFocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      onChange(option.value);
      closeList();
    },
    [options, onChange, closeList],
  );

  // Close on outside pointer/touch interaction.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !listRef.current?.contains(target)
      ) {
        closeList(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, closeList]);

  // Flip the popup above the trigger when there is no room below.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setPlacement(spaceBelow < 280 && rect.top > spaceBelow ? "top" : "bottom");
  }, [open]);

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  // Reset the active option if the option list changes while open.
  useEffect(() => {
    if (!open) return;
    setActiveIndex((current) => {
      if (current >= 0 && current < options.length && !options[current].disabled) {
        return current;
      }
      return selectedIndex >= 0 ? selectedIndex : firstEnabled(-1, 1);
    });
  }, [open, options, selectedIndex, firstEnabled]);

  const handleTypeahead = useCallback(
    (key: string) => {
      const state = typeaheadRef.current;
      if (state.timer !== null) window.clearTimeout(state.timer);
      state.query += key.toLowerCase();
      state.timer = window.setTimeout(() => {
        state.query = "";
        state.timer = null;
      }, 500);

      const query = state.query;
      const start = activeIndex >= 0 ? activeIndex : -1;
      for (let i = 1; i <= options.length; i += 1) {
        const index = (start + i) % options.length;
        const option = options[index];
        if (!option.disabled && option.label.toLowerCase().startsWith(query)) {
          setActiveIndex(index);
          return;
        }
      }
    },
    [options, activeIndex],
  );

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Enter":
      case " ":
        event.preventDefault();
        if (!open) openList();
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          closeList();
        }
        break;
      case "Tab":
        if (open) closeList(false);
        break;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
          if (!open) openList();
          handleTypeahead(event.key);
        }
    }
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((current) => firstEnabled(current, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((current) => firstEnabled(current, -1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(firstEnabled(-1, 1));
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(firstEnabled(0, -1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        closeList();
        break;
      case "Tab":
        closeList(false);
        break;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          handleTypeahead(event.key);
        }
    }
  };

  const activeId =
    open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label
          id={labelId}
          htmlFor={id}
          className="text-xs font-semibold text-[var(--pm-muted)]"
        >
          {label}
        </label>
      )}

      <div className="relative">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={activeId}
          aria-labelledby={label ? labelId : undefined}
          aria-label={label ? undefined : ariaLabel}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          onClick={() => (open ? closeList() : openList())}
          onKeyDown={handleTriggerKeyDown}
          className={cn(
            "pm-input flex w-full items-center justify-between gap-2 text-left",
            error && "border-[var(--pm-danger)]",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selectedOption?.icon}
            <span
              className={cn(
                "truncate",
                !selectedOption && "text-[var(--pm-muted-2)]",
              )}
            >
              {selectedOption ? selectedOption.label : placeholder}
            </span>
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={cn(
              "h-4 w-4 shrink-0 text-[var(--pm-muted)] transition-transform",
              open && "rotate-180",
            )}
          >
            <path
              fill="currentColor"
              d="M5.5 7.5 10 12l4.5-4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fillOpacity="0"
            />
          </svg>
        </button>

        {open && (
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={label ? labelId : undefined}
            tabIndex={-1}
            onKeyDown={handleListKeyDown}
            className={cn(
              "pm-panel absolute left-0 z-50 max-h-64 w-full overflow-y-auto p-1 shadow-lg",
              placement === "bottom" ? "top-full mt-1" : "bottom-full mb-1",
            )}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <li
                  key={index}
                  id={`${id}-option-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                  onClick={() => commit(index)}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-[var(--pm-r)] px-3 py-2 text-sm",
                    isActive && "bg-[var(--pm-violet-dim)]",
                    isSelected && "text-[var(--pm-violet)]",
                    option.disabled && "cursor-not-allowed opacity-40",
                  )}
                >
                  {option.icon && <span className="mt-0.5">{option.icon}</span>}
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{option.label}</span>
                    {option.description && (
                      <span className="truncate text-xs text-[var(--pm-muted)]">
                        {option.description}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error ? (
        <p id={errorId} className="text-xs text-[var(--pm-danger)]">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-[var(--pm-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
