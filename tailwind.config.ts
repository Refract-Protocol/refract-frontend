import type { Config } from "tailwindcss";

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
        "pm-bg": "#07050f",
        "pm-panel": "#0e0b1a",
        "pm-surface": "#0f0c1a",
        "pm-surface-2": "#17132a",
        "pm-surface-3": "#201b38",
        "pm-border": "rgba(139,92,246,0.12)",
        "pm-border-2": "rgba(139,92,246,0.3)",
        "pm-violet": "#8b5cf6",
        "pm-violet-2": "#7c3aed",
        "pm-green": "#10b981",
        "pm-amber": "#f59e0b",
        "pm-red": "#ef4444",
        "pm-text": "#ede9f8",
        "pm-muted": "#7b6fa8",
        "pm-muted-2": "#4a4070",
      },
      fontFamily: {
        display: ["Syne", "sans-serif"],
        body: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      screens: {
        xs: "420px",
      },
      // NOTE: `fadeUp` and `shimmer` keyframes were removed here to collapse
      // duplicate definitions. `fadeUp` now lives solely in globals.css and
      // `shimmer` was superseded by `pmShimmer` (also in globals.css).
      // See issue #39.
    },
  },
  plugins: [],
};

export default config;
