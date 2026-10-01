"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

export interface SliderProps {
  min?: number;
  max?: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  label?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToStep(value: number, min: number, step: number): number {
  if (step <= 0) return value;
  const steps = Math.round((value - min) / step);
  return min + steps * step;
}

/**
 * Reusable, ARIA-compliant single-thumb slider built on a native
 * `<input type="range">`. Native input provides keyboard operation
 * (arrows, Home/End, Page Up/Down) and screen reader semantics for free;
 * we layer on a floating value tooltip and the CSS-variable fill trick.
 */
export function Slider({
  min = 0,
  max = 100,
  step = 1,
  value,
  onChange,
  formatValue,
  label,
  id,
  disabled = false,
  className,
}: SliderProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const prefersReducedMotion = usePrefersReducedMotion();
  const [active, setActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const safeValue = clamp(value, min, max);
  const range = max - min;
  const pct = range > 0 ? ((safeValue - min) / range) * 100 : 0;
  const display = formatValue ? formatValue(safeValue) : String(safeValue);

  const commit = useCallback(
    (next: number) => {
      const clamped = clamp(roundToStep(next, min, step), min, max);
      if (clamped !== value) onChange(clamped);
    },
    [min, max, step, value, onChange],
  );

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    commit(Number(event.target.value));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const pageStep = step * 10;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        event.preventDefault();
        commit(safeValue + step);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        event.preventDefault();
        commit(safeValue - step);
        break;
      case "PageUp":
        event.preventDefault();
        commit(safeValue + pageStep);
        break;
      case "PageDown":
        event.preventDefault();
        commit(safeValue - pageStep);
        break;
      case "Home":
        event.preventDefault();
        commit(min);
        break;
      case "End":
        event.preventDefault();
        commit(max);
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    if (!active) return;
    const stop = () => setActive(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [active]);

  const showTooltip = active && !disabled;

  return (
    <div className={["pm-slider-wrap", className].filter(Boolean).join(" ")}>
      <input
        ref={inputRef}
        id={inputId}
        type="range"
        className="pm-slider"
        min={min}
        max={max}
        step={step}
        value={safeValue}
        disabled={disabled}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={safeValue}
        aria-valuetext={display}
        style={{ ["--pct" as string]: `${pct}%` }}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPointerDown={() => setActive(true)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
      />
      <span
        className="pm-slider-tooltip"
        data-visible={showTooltip ? "true" : "false"}
        data-reduced-motion={prefersReducedMotion ? "true" : "false"}
        style={{ left: `${pct}%` }}
        aria-hidden="true"
      >
        {display}
      </span>
    </div>
  );
}
