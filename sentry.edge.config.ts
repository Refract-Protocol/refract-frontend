import * as Sentry from "@sentry/nextjs";
import { beforeSend } from "./src/lib/monitoring/scrub";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV;

// No-op unless a DSN is configured and this is not local development.
Sentry.init({
  dsn,
  environment,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
  enabled: Boolean(dsn) && environment !== "development",
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend,
});
