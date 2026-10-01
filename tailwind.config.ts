import type { Config } from "tailwindcss";

/**
 * Tailwind theme configuration.
 *
 * Design tokens are sourced from the CSS custom properties declared in
 * `src/app/globals.css` (the single authoritative token source). Colour and
 * radius tokens reference those `--pm-*` variables via `var()` so Tailwind
 * utilities and hand-written CSS can never drift apart.
 *
 * Note: opacity modifiers (e.g. `border-pm-border/60`) are not supported for
 * `var()`-based colours; use the dedicated `-2` variants or plain CSS instead.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "pm-bg": "var(--pm-bg)",
        "pm-panel": "var(--pm-panel)",
        "pm-surface": "var(--pm-surface)",
        "pm-surface-2": "var(--pm-surface-2)",
        "pm-surface-3": "var(--pm-surface-3)",
        "pm-border": "var(--pm-border)",
        "pm-border-2": "var(--pm-border-2)",
        "pm-violet": "var(--pm-violet)",
        "pm-violet-2": "var(--pm-violet-2)",
        "pm-green": "var(--pm-green)",
        "pm-amber": "var(--pm-amber)",
        "pm-red": "var(--pm-red)",
        "pm-text": "var(--pm-text)",
        "pm-muted": "var(--pm-muted)",
        "pm-muted-2": "var(--pm-muted-2)",
      },
      borderRadius: {
        "pm": "var(--pm-r)",
        "pm-lg": "var(--pm-r-lg)",
        "pm-xl": "var(--pm-r-xl)",
      },
      fontFamily: {
        display: ["Syne", "sans-serif"],
        body: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      screens: {
        xs: "420px",
      },
      keyframes: {
        fadeUp: {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-468px 0" },
          "100%": { backgroundPosition: "468px 0" },
        },
      },
      animation: {
        "fade-up": "fadeUp 0.4s ease forwards",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
