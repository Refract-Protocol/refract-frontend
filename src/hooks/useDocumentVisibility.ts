import { useEffect, useState } from "react";

/**
 * Single JS-side source of truth for `document.visibilityState`.
 * Mirrors the pattern in `usePrefersReducedMotion`: subscribe once, keep
 * React state in sync, and clean up on unmount. Returns `true` when the
 * document is visible.
 */
export function useDocumentVisibility(): boolean {
  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleChange = () => {
      setVisible(document.visibilityState !== "hidden");
    };

    document.addEventListener("visibilitychange", handleChange);
    return () => document.removeEventListener("visibilitychange", handleChange);
  }, []);

  return visible;
}
