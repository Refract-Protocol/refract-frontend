"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/**
 * Activation behaviour for a {@link Tabs} group.
 *
 * - `automatic`: moving focus with the arrow keys also selects the tab.
 * - `manual`: focus moves with the arrow keys but selection requires
 *   Enter/Space (or a click).
 */
export type TabsActivationMode = "automatic" | "manual";

/** Orientation of the tab list, which determines the arrow keys used. */
export type TabsOrientation = "horizontal" | "vertical";

interface TabsContextValue {
  baseId: string;
  value: string;
  setValue: (value: string) => void;
  activationMode: TabsActivationMode;
  orientation: TabsOrientation;
  registerTab: (value: string, node: HTMLButtonElement | null) => void;
  focusTab: (value: string) => void;
  moveFocus: (from: string, direction: 1 | -1 | "first" | "last") => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`<${component}> must be rendered inside <Tabs>.`);
  }
  return ctx;
}

function tabId(baseId: string, value: string) {
  return `${baseId}-tab-${value}`;
}

function panelId(baseId: string, value: string) {
  return `${baseId}-panel-${value}`;
}

export interface TabsProps {
  /** Currently selected tab value (controlled). */
  value?: string;
  /** Initial selected tab value (uncontrolled). */
  defaultValue?: string;
  /** Called whenever the selected tab changes. */
  onValueChange?: (value: string) => void;
  /** Whether arrow-key focus also selects the tab. Defaults to `automatic`. */
  activationMode?: TabsActivationMode;
  /** Arrow-key orientation. Defaults to `horizontal`. */
  orientation?: TabsOrientation;
  className?: string;
  children: ReactNode;
}

/**
 * Root of the tabs primitive. Owns selection state, id generation and the
 * roving-focus registry shared with {@link TabList}, {@link Tab} and
 * {@link TabPanel}.
 */
export function Tabs({
  value,
  defaultValue,
  onValueChange,
  activationMode = "automatic",
  orientation = "horizontal",
  className = "",
  children,
  ...rest
}: TabsProps & React.HTMLAttributes<HTMLDivElement>) {
  const baseId = useId();
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;
  const tabNodes = useRef<Record<string, HTMLButtonElement | null>>({});
  const order = useRef<string[]>([]);

  const setValue = useCallback(
    (next: string) => {
      if (!isControlled) setInternalValue(next);
      onValueChange?.(next);
    },
    [isControlled, onValueChange],
  );

  const registerTab = useCallback((tabValue: string, node: HTMLButtonElement | null) => {
    if (node) {
      tabNodes.current[tabValue] = node;
      if (!order.current.includes(tabValue)) order.current.push(tabValue);
    } else {
      delete tabNodes.current[tabValue];
      order.current = order.current.filter((v) => v !== tabValue);
    }
  }, []);

  const focusTab = useCallback((tabValue: string) => {
    tabNodes.current[tabValue]?.focus();
  }, []);

  const moveFocus = useCallback(
    (from: string, direction: 1 | -1 | "first" | "last") => {
      const values = order.current;
      if (values.length === 0) return;
      const index = values.indexOf(from);
      let nextIndex: number;
      if (direction === "first") nextIndex = 0;
      else if (direction === "last") nextIndex = values.length - 1;
      else nextIndex = (index + direction + values.length) % values.length;
      const nextValue = values[nextIndex];
      focusTab(nextValue);
      if (activationMode === "automatic") setValue(nextValue);
    },
    [activationMode, focusTab, setValue],
  );

  const ctx = useMemo<TabsContextValue>(
    () => ({
      baseId,
      value: currentValue,
      setValue,
      activationMode,
      orientation,
      registerTab,
      focusTab,
      moveFocus,
    }),
    [baseId, currentValue, setValue, activationMode, orientation, registerTab, focusTab, moveFocus],
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div className={className} {...rest}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export interface TabListProps {
  className?: string;
  children: ReactNode;
}

/**
 * Container for the {@link Tab} buttons. Renders `role="tablist"` and wires
 * the orientation for assistive technology.
 */
export function TabList({ className = "", children, ...rest }: TabListProps & React.HTMLAttributes<HTMLDivElement>) {
  const { orientation } = useTabsContext("TabList");
  return (
    <div
      role="tablist"
      aria-orientation={orientation}
      className={className}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface TabProps {
  /** Unique value identifying this tab and its panel. */
  value: string;
  className?: string;
  children: ReactNode;
}

/**
 * A single tab button. Implements the roving `tabIndex` and the full APG
 * keyboard interaction (Arrow keys, Home, End, Enter/Space in manual mode).
 */
export function Tab({ value, className = "", children, ...rest }: TabProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { baseId, value: selected, setValue, activationMode, orientation, registerTab, moveFocus } =
    useTabsContext("Tab");
  const isSelected = selected === value;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const prevKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    switch (event.key) {
      case prevKey:
        event.preventDefault();
        moveFocus(value, -1);
        break;
      case nextKey:
        event.preventDefault();
        moveFocus(value, 1);
        break;
      case "Home":
        event.preventDefault();
        moveFocus(value, "first");
        break;
      case "End":
        event.preventDefault();
        moveFocus(value, "last");
        break;
      case "Enter":
      case " ":
        if (activationMode === "manual") {
          event.preventDefault();
          setValue(value);
        }
        break;
      default:
        break;
    }
  };

  return (
    <button
      ref={(node) => registerTab(value, node)}
      type="button"
      role="tab"
      id={tabId(baseId, value)}
      aria-selected={isSelected}
      aria-controls={panelId(baseId, value)}
      tabIndex={isSelected ? 0 : -1}
      onClick={() => setValue(value)}
      onKeyDown={handleKeyDown}
      className={className}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface TabPanelsProps {
  className?: string;
  children: ReactNode;
}

/** Wrapper around the {@link TabPanel} elements. */
export function TabPanels({ className = "", children, ...rest }: TabPanelsProps & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={className} {...rest}>
      {children}
    </div>
  );
}

export interface TabPanelProps {
  /** Value of the {@link Tab} this panel belongs to. */
  value: string;
  className?: string;
  children: ReactNode;
}

/**
 * Panel associated with a {@link Tab}. Hidden unless its tab is selected and
 * labelled by the tab via `aria-labelledby`.
 */
export function TabPanel({ value, className = "", children, ...rest }: TabPanelProps & React.HTMLAttributes<HTMLDivElement>) {
  const { baseId, value: selected } = useTabsContext("TabPanel");
  const isSelected = selected === value;
  return (
    <div
      role="tabpanel"
      id={panelId(baseId, value)}
      aria-labelledby={tabId(baseId, value)}
      hidden={!isSelected}
      tabIndex={0}
      className={className}
      {...rest}
    >
      {children}
    </div>
  );
}
