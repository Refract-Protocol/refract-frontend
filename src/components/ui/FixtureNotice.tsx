import { Alert } from "./Alert";

/**
 * Canonical "showing example data" notice.
 *
 * The Refract API is not always reachable from every environment (local dev,
 * previews, static exports). When that happens the pages fall back to bundled
 * fixture data. This composition renders the single, canonical wording for
 * that state so every page communicates it identically.
 *
 * @param props.className - Optional extra classes forwarded to the underlying `Alert`.
 * @param props.action - Optional action slot (e.g. a "Retry" button).
 */
export function FixtureNotice({
  className,
  action,
}: {
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <Alert tone="warning" title="Showing example data" className={className} action={action}>
      The Refract API isn&apos;t reachable from this environment, so the figures below come from
      bundled example data.
    </Alert>
  );
}
