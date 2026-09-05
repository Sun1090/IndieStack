/**
 * Next.js Instrumentation for Sentry + Appark APM.
 * Automatically loaded by Next.js to initialize error tracking / APM.
 *
 * See: https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry/server.config");
    // Appark APM（v0.5.0 C01）：未配置时为旁路 no-op，见 src/lib/appark.ts（ADR-011）
    const { initAppark } = await import("@/lib/appark");
    initAppark();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry/edge.config");
  }
}
