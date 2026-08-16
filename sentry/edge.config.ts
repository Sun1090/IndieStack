import * as Sentry from "@sentry/nextjs";
import { getSentryDsn, isSentryEnabled } from "./dsn";

Sentry.init({
  dsn: getSentryDsn(),
  environment: process.env.NODE_ENV,
  release: `indiestack@${process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "dev"}`,
  tracesSampleRate: 0,
  enabled: isSentryEnabled(),
});
