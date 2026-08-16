"use client";

import * as Sentry from "@sentry/nextjs";
import { SITE_CONFIG } from "@/lib/constants";
import { getSentryDsn, isSentryEnabled } from "./dsn";

Sentry.init({
  dsn: getSentryDsn(),
  environment: process.env.NODE_ENV,
  release: `indiestack@${process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "dev"}`,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  enabled: isSentryEnabled(),
});
