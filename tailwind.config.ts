import type { Config } from 'tailwindcss';

/**
 * Design tokens for the pm-* palette.
 *
 * These hex values are the single source of truth for the design-token system.
 * Raw hex/rgb()/rgba() literals are intentionally allowed here (and only here);
 * component code under src/ must reference these tokens via pm-* classes or the
 * shared color-token object in src/lib/colorTokens.ts.
 */
export const pmColors = {
  'pm-green': '#10b981',
  'pm-violet': '#8b5cf6',
  'pm-amber': '#f59e0b',
  'pm-red': '#ef4444',
  'pm-cyan': '#06b6d4',
} as const;

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ...pmColors,
      },
    },
  },
  plugins: [],
};

export default config;
