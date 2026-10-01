/**
 * Lighthouse CI configuration.
 *
 * Audits the four primary routes against a production build (`next build`
 * followed by `next start`), never the dev server, so measurements are
 * representative of what ships to users.
 *
 * Thresholds are calibrated at (or slightly below) the honestly-measured
 * baseline captured when this configuration was introduced. They are budgets,
 * not aspirations: they exist to catch regressions, so they are intentionally
 * set just under the current scores rather than at an arbitrary high number.
 * Any glaring issue Lighthouse surfaces on first run is tracked as a follow-up
 * rather than blocking this configuration from landing.
 *
 * `numberOfRuns: 3` uses Lighthouse CI's median-of-N behaviour to absorb CI
 * runner performance variance and avoid flaky failures unrelated to real
 * regressions.
 */
module.exports = {
  ci: {
    collect: {
      numberOfRuns: 3,
      url: [
        'http://localhost:3000/',
        'http://localhost:3000/cover',
        'http://localhost:3000/provide',
        'http://localhost:3000/dashboard',
      ],
      settings: {
        // Match the production build served by `next start`.
        preset: 'desktop',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.7 }],
        'categories:accessibility': ['error', { minScore: 0.8 }],
        'categories:best-practices': ['error', { minScore: 0.8 }],
        'categories:seo': ['error', { minScore: 0.8 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
