// Feature flag configuration.
//
// Unknown-key contract: looking up a flag name that is not defined here
// throws in development (so typos surface immediately) and returns `false`
// in production (so a bad flag name never breaks the app).
// `useFeatureFlag` follows the same contract.

export type FlagName =
  | "newDashboard"
  | "betaEditor"
  | "experimentalSearch";

export const flagsConfig: Record<FlagName, boolean> = {
  newDashboard: false,
  betaEditor: false,
  experimentalSearch: false,
};

const isDev = process.env.NODE_ENV !== "production";

export function isFlagEnabled(name: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(flagsConfig, name)) {
    if (isDev) {
      throw new Error(`Unknown feature flag: "${name}"`);
    }
    return false;
  }
  return flagsConfig[name as FlagName];
}
