"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface UseComboboxOptions {
  options: ComboboxOption[];
  /** Controlled selected value. */
  value?: string | null;
  /** Called when the user commits a selection (Enter / click). */
  onChange?: (value: string) => void;
  /**
   * When true the input text is treated as a free-text filter that narrows
   * the option list. When false the input mirrors the selected option label
   * and typing performs type-ahead selection instead.
   */
  filterable?: boolean;
  /** Initial input text when uncontrolled. */
  defaultInputValue?: string;
  /** Called whenever the input text changes (free-text filter mode). */
  onInputChange?: (inputValue: string) => void;
  /** Disable the whole control. */
  disabled?: boolean;
}

export interface UseComboboxResult {
  /** id to spread onto the input element. */
  inputId: string;
  /** id to spread onto the listbox element. */
  listboxId: string;
  /** id of the currently active option (for aria-activedescendant). */
  activeDescendantId: string | undefined;
  /** Current input text. */
  inputValue: string;
  /** Options after applying the free-text filter. */
  filteredOptions: ComboboxOption[];
  /** Whether the listbox is open. */
  isOpen: boolean;
  /** Index of the active option within filteredOptions, or -1. */
  activeIndex: number;
  /** The currently selected option, if any. */
  selectedOption: ComboboxOption | undefined;
  /** Props to spread onto the input element. */
  getInputProps: () => {
    id: string;
    role: "combobox";
    "aria-expanded": boolean;
    "aria-controls": string;
    "aria-activedescendant": string | undefined;
    "aria-autocomplete": "list" | "none";
    autoComplete: "off";
    value: string;
    disabled: boolean;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
    onFocus: () => void;
    onBlur: () => void;
  };
  /** Props to spread onto the listbox element. */
  getListboxProps: () => {
    id: string;
    role: "listbox";
    "aria-label": string;
  };
  /** Props to spread onto each option element. */
  getOptionProps: (index: number) => {
    id: string;
    role: "option";
    "aria-selected": boolean;
    "aria-disabled": boolean;
    onMouseDown: (e: React.MouseEvent) => void;
    onMouseEnter: () => void;
  };
  /** Programmatically open the listbox. */
  open: () => void;
  /** Programmatically close the listbox. */
  close: () => void;
  /** Programmatically select an option by value. */
  select: (value: string) => void;
  /** Programmatically set the input text. */
  setInputValue: (value: string) => void;
}

/**
 * Headless WAI-ARIA combobox hook.
 *
 * Implements the APG combobox pattern: role="combobox", aria-expanded,
 * aria-controls, aria-activedescendant, arrow-key navigation with wrapping,
 * type-ahead filtering, Enter to select and Escape to close without
 * selecting. Works with an empty option list.
 */
export function useCombobox({
  options,
  value = null,
  onChange,
  filterable = true,
  defaultInputValue = "",
  onInputChange,
  disabled = false,
}: UseComboboxOptions): UseComboboxResult {
  const reactId = useId();
  const inputId = `${reactId}-input`;
  const listboxId = `${reactId}-listbox`;
  const optionId = (index: number) => `${reactId}-option-${index}`;

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  const [inputValue, setInputValueState] = useState(
    defaultInputValue || (filterable ? "" : selectedOption?.label ?? ""),
  );
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Keep the input in sync with the controlled value when not filtering.
  useEffect(() => {
    if (!filterable) {
      setInputValueState(selectedOption?.label ?? "");
    }
  }, [filterable, selectedOption]);

  const filteredOptions = useMemo(() => {
    if (!filterable) return options;
    const query = inputValue.trim().toLowerCase();
    if (!query) return options;
    return options.filter((o) => o.label.toLowerCase().includes(query));
  }, [filterable, inputValue, options]);

  const setInputValue = useCallback(
    (next: string) => {
      setInputValueState(next);
      onInputChange?.(next);
    },
    [onInputChange],
  );

  const open = useCallback(() => {
    if (disabled) return;
    setIsOpen(true);
  }, [disabled]);

  const close = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(-1);
  }, []);

  const select = useCallback(
    (nextValue: string) => {
      const option = options.find((o) => o.value === nextValue);
      if (!option || option.disabled) return;
      onChange?.(option.value);
      if (!filterable) setInputValueState(option.label);
      close();
    },
    [close, filterable, onChange, options],
  );

  const moveActive = useCallback(
    (delta: number) => {
      if (filteredOptions.length === 0) return;
      setActiveIndex((prev) => {
        const start = prev < 0 ? (delta > 0 ? -1 : 0) : prev;
        return (start + delta + filteredOptions.length) % filteredOptions.length;
      });
    },
    [filteredOptions.length],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setInputValue(next);
      if (!isOpen) setIsOpen(true);
      if (filterable) {
        setActiveIndex(-1);
      } else {
        // Type-ahead: jump to the first option whose label starts with the
        // typed text, without changing the visible input value.
        const query = next.trim().toLowerCase();
        const match = options.findIndex((o) =>
          o.label.toLowerCase().startsWith(query),
        );
        setActiveIndex(match);
      }
    },
    [filterable, isOpen, options, setInputValue],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (!isOpen) {
            open();
            setActiveIndex(filteredOptions.length > 0 ? 0 : -1);
          } else {
            moveActive(1);
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (!isOpen) {
            open();
            setActiveIndex(
              filteredOptions.length > 0 ? filteredOptions.length - 1 : -1,
            );
          } else {
            moveActive(-1);
          }
          break;
        case "Home":
          if (isOpen && filteredOptions.length > 0) {
            e.preventDefault();
            setActiveIndex(0);
          }
          break;
        case "End":
          if (isOpen && filteredOptions.length > 0) {
            e.preventDefault();
            setActiveIndex(filteredOptions.length - 1);
          }
          break;
        case "Enter": {
          if (!isOpen) break;
          e.preventDefault();
          const option = filteredOptions[activeIndex];
          if (option && !option.disabled) {
            select(option.value);
          }
          break;
        }
        case "Escape":
          if (isOpen) {
            e.preventDefault();
            close();
          }
          break;
        case "Tab":
          close();
          break;
        default:
          break;
      }
    },
    [activeIndex, close, filteredOptions, isOpen, moveActive, open, select],
  );

  const activeDescendantId =
    isOpen && activeIndex >= 0 && activeIndex < filteredOptions.length
      ? optionId(activeIndex)
      : undefined;

  return {
    inputId,
    listboxId,
    activeDescendantId,
    inputValue,
    filteredOptions,
    isOpen,
    activeIndex,
    selectedOption,
    getInputProps: () => ({
      id: inputId,
      role: "combobox",
      "aria-expanded": isOpen,
      "aria-controls": listboxId,
      "aria-activedescendant": activeDescendantId,
      "aria-autocomplete": filterable ? "list" : "none",
      autoComplete: "off",
      value: inputValue,
      disabled,
      onChange: handleInputChange,
      onKeyDown: handleKeyDown,
      onFocus: open,
      onBlur: close,
    }),
    getListboxProps: () => ({
      id: listboxId,
      role: "listbox",
      "aria-label": "Options",
    }),
    getOptionProps: (index: number) => {
      const option = filteredOptions[index];
      return {
        id: optionId(index),
        role: "option",
        "aria-selected": option?.value === value,
        "aria-disabled": Boolean(option?.disabled),
        onMouseDown: (e: React.MouseEvent) => {
          // Prevent the input from blurring before the click registers.
          e.preventDefault();
          if (option && !option.disabled) select(option.value);
        },
        onMouseEnter: () => setActiveIndex(index),
      };
    },
    open,
    close,
    select,
    setInputValue,
  };
}

export interface ComboboxProps extends UseComboboxOptions {
  /** Accessible label for the input. */
  label?: string;
  placeholder?: string;
  className?: string;
  /** Message shown when the filtered option list is empty. */
  emptyMessage?: string;
}

/**
 * Styled default rendering of the combobox using pm-input / pm-panel tokens.
 *
 * Usage:
 * ```tsx
 * <Combobox
 *   label="Coverage type"
 *   options={coverageTypes.map((t) => ({ value: String(t.id), label: t.name }))}
 *   value={String(selectedType)}
 *   onChange={(v) => setSelectedType(Number(v))}
 * />
 * ```
 */
export function Combobox({
  label,
  placeholder,
  className,
  emptyMessage = "No matches",
  ...hookOptions
}: ComboboxProps) {
  const combobox = useCombobox(hookOptions);
  const inputProps = combobox.getInputProps();
  const listboxProps = combobox.getListboxProps();
  const listRef = useRef<HTMLUListElement | null>(null);

  // Keep the active option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!combobox.isOpen || combobox.activeIndex < 0) return;
    const el = listRef.current?.children[combobox.activeIndex] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView?.({ block: "nearest" });
  }, [combobox.activeIndex, combobox.isOpen]);

  return (
    <div className={["relative", className].filter(Boolean).join(" ")}>
      {label && (
        <label
          htmlFor={combobox.inputId}
          className="mb-1.5 block text-[11px] uppercase tracking-wide text-pm-text/40"
        >
          {label}
        </label>
      )}
      <input
        {...inputProps}
        type="text"
        placeholder={placeholder}
        className="pm-input w-full"
      />
      {combobox.isOpen && (
        <ul
          {...listboxProps}
          ref={listRef}
          className="pm-panel absolute z-20 mt-1 max-h-60 w-full overflow-auto py-1"
        >
          {combobox.filteredOptions.length === 0 ? (
            <li className="px-3 py-2 text-sm text-pm-text/40">
              {emptyMessage}
            </li>
          ) : (
            combobox.filteredOptions.map((option, index) => (
              <li
                key={option.value}
                {...combobox.getOptionProps(index)}
                className={[
                  "cursor-pointer px-3 py-2 text-sm",
                  index === combobox.activeIndex
                    ? "bg-pm-accent/10 text-pm-text"
                    : "text-pm-text/80",
                  option.disabled ? "cursor-not-allowed opacity-40" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {option.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export default Combobox;
