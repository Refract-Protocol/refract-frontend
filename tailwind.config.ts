import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/hooks/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        "pm-bg": "rgb(var(--pm-bg-rgb) / <alpha-value>)",
        "pm-panel": "rgb(var(--pm-panel-rgb) / <alpha-value>)",
        "pm-surface": "rgb(var(--pm-surface-rgb) / <alpha-value>)",
        "pm-surface-2": "rgb(var(--pm-surface-2-rgb) / <alpha-value>)",
        "pm-surface-3": "rgb(var(--pm-surface-3-rgb) / <alpha-value>)",
        "pm-border": "rgb(var(--pm-border-rgb) / <alpha-value>)",
        "pm-border-2": "rgb(var(--pm-border-2-rgb) / <alpha-value>)",
        "pm-violet": "rgb(var(--pm-violet-rgb) / <alpha-value>)",
        "pm-violet-2": "rgb(var(--pm-violet-2-rgb) / <alpha-value>)",
        "pm-green": "rgb(var(--pm-green-rgb) / <alpha-value>)",
        "pm-amber": "rgb(var(--pm-amber-rgb) / <alpha-value>)",
        "pm-red": "rgb(var(--pm-red-rgb) / <alpha-value>)",
        "pm-text": "rgb(var(--pm-text-rgb) / <alpha-value>)",
        "pm-muted": "rgb(var(--pm-muted-rgb) / <alpha-value>)",
        "pm-muted-2": "rgb(var(--pm-muted-2-rgb) / <alpha-value>)",
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
