import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/**
 * Browser-side MSW worker used for local development.
 *
 * This is intentionally only imported from a development-only, explicitly
 * opt-in code path (see `src/mocks/index.ts` / the `dev:msw` npm script).
 * It must never be registered in a production build so that real network
 * requests are never intercepted outside of local development.
 */
export const worker = setupWorker(...handlers);
