import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/**
 * MSW server for the Node/test environment.
 *
 * Intercepts fetch/XHR at the request level so hooks and components run
 * unmodified against controllable mock responses. Import this in test setup
 * files and call `server.listen()` / `server.resetHandlers()` / `server.close()`
 * around the suite.
 *
 * This is additive tooling for development and testing only; it does not
 * affect the production `ApiUnreachableError -> fixture` fallback path.
 */
export const server = setupServer(...handlers);

export { handlers };
