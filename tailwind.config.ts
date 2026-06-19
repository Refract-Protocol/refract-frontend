import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "pm-bg": "#07050f",
        "pm-panel": "#0e0b1a",
        "pm-border": "rgba(139,92,246,0.12)",
        "pm-violet": "#8b5cf6",
        "pm-green": "#10b981",
        "pm-amber": "#f59e0b",
        "pm-red": "#ef4444",
      },
      fontFamily: {
        display: ["Syne", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
