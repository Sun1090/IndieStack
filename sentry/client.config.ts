"use client";

import * as Sentry from "@sentry/nextjs";
import { SITE_CONFIG } from "@/lib/constants";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
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
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});
