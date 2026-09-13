/**
 * Provider diagnostics CLI implementation (I08).
 *
 * The report is credential-free by construction: it only emits provider ids,
 * statuses, and missing variable names. `--json` is intended for deployment
 * automation; the default output is a compact human-readable summary.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diagnoseProviders, formatProviderReport } from "../../src/lib/providers/diagnostics.ts";

function parseArgs(argv) {
  const args = new Set(argv.filter((arg) => arg !== "--"));
  return {
    json: args.has("--json"),
    help: args.has("--help") || args.has("-h"),
  };
}

export function usage() {
  return [
    "Usage: pnpm provider:doctor [--json]",
    "",
    "Reports configured / disabled / partial provider states without printing",
    "credential values. Exit code 1 means a required or partially configured",
    "provider needs attention; exit code 0 includes optional providers that are",
    "intentionally disabled.",
  ].join("\n");
}

export function runProviderDoctor(argv = process.argv.slice(2), env = process.env, io = console) {
  const options = parseArgs(argv);
  if (options.help) {
    io.log(usage());
    return 0;
  }
  const report = diagnoseProviders(env);
  if (options.json) {
    io.log(JSON.stringify(report, null, 2));
  } else {
    io.log(formatProviderReport(report));
  }
  return report.ok ? 0 : 1;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runProviderDoctor();
