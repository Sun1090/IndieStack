/**
 * Next.js Instrumentation for Sentry.
 * Automatically loaded by Next.js to initialize error tracking.
 *
 * See: https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry/server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry/edge.config");
  }
}
