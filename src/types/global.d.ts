// Ambient declaration for the Freighter browser extension's injected global.
// The extension sets `window.freighterApi` when installed; we only ever
// feature-detect its presence, never call into it directly (all real calls
// go through the typed @stellar/freighter-api package).
export {};

declare global {
  interface Window {
    freighterApi?: unknown;
  }
}
