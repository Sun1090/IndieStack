/**
 * Repository security/config gate implementation.
 *
 * Pure policy lives in src/lib/security/security-config.ts and is covered by Vitest.
 * This module only handles repository IO, the dependency audit process, and output.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatSecurityIssues,
  inspectAuditReport,
  inspectClientModules,
  inspectEnvFile,
  inspectSecurityGateFiles,
  inspectTrackedFiles,
  inspectWorkflowPermissions,
} from "../../src/lib/security/security-config.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const ENV_FILE_NAMES = [".env", ".env.local", ".env.development", ".env.production"];
export const SECURITY_GATE_FILES = [
  ".github/workflows/secrets-scan.yml",
  ".github/workflows/security-config.yml",
  ".github/workflows/codeql.yml",
  ".github/dependabot.yml",
];

function toPosixPath(file) {
  return file.split(path.sep).join("/");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function readTrackedFiles(root) {
  const result = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || "git ls-files failed").trim());
  }
  return result.stdout.split("\n").filter(Boolean);
}

function readEnvFiles(root) {
  const files = [];
  for (const name of ENV_FILE_NAMES) {
    const fullPath = path.join(root, name);
    let descriptor;
    try {
      descriptor = fs.openSync(fullPath, "r");
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") continue;
      throw error;
    }

    try {
      files.push({
        path: name,
        mode: fs.fstatSync(descriptor).mode,
        content: fs.readFileSync(descriptor, "utf8"),
      });
    } finally {
      fs.closeSync(descriptor);
    }
  }
  return files;
}

function walkSourceFiles(directory, root, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", "coverage", ".git"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(fullPath, root, files);
    } else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push({
        path: toPosixPath(path.relative(root, fullPath)),
        content: fs.readFileSync(fullPath, "utf8"),
      });
    }
  }
  return files;
}

function readWorkflowFiles(root) {
  const directory = path.join(root, ".github", "workflows");
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      path: `.github/workflows/${entry.name}`,
      content: fs.readFileSync(path.join(directory, entry.name), "utf8"),
    }));
}

function readSecurityGateFiles(root) {
  const files = [];
  for (const relativePath of SECURITY_GATE_FILES) {
    try {
      files.push({
        path: relativePath,
        content: fs.readFileSync(path.join(root, relativePath), "utf8"),
      });
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return files;
}

function runDependencyAudit(root) {
  const result = spawnSync("pnpm", ["audit", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;

  const output = result.stdout.trim();
  if (!output) {
    throw new Error((result.stderr || "pnpm audit returned no JSON").trim());
  }
  return JSON.parse(output);
}

function collectOrReportReadError(options, key, reader, label, issues) {
  if (Object.prototype.hasOwnProperty.call(options, key)) return options[key];
  try {
    return reader();
  } catch (error) {
    issues.push(`${label}: ${errorMessage(error)}`);
    return [];
  }
}

/** Run all security/configuration checks and return a process exit code. */
export function runSecurityConfigCheck(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const issues = [];

  const trackedFiles = collectOrReportReadError(
    options,
    "trackedFiles",
    () => readTrackedFiles(root),
    "cannot read git index",
    issues,
  );
  const envFiles = collectOrReportReadError(
    options,
    "envFiles",
    () => readEnvFiles(root),
    "cannot read environment files",
    issues,
  );
  const sourceFiles = collectOrReportReadError(
    options,
    "sourceFiles",
    () => walkSourceFiles(path.join(root, "src"), root),
    "cannot read source files",
    issues,
  );
  const workflowFiles = collectOrReportReadError(
    options,
    "workflowFiles",
    () => readWorkflowFiles(root),
    "cannot read workflow files",
    issues,
  );
  const gateFiles = collectOrReportReadError(
    options,
    "gateFiles",
    () => readSecurityGateFiles(root),
    "cannot read security scanner files",
    issues,
  );

  issues.push(...inspectTrackedFiles(trackedFiles));
  for (const file of envFiles) issues.push(...inspectEnvFile(file));
  issues.push(...inspectClientModules(sourceFiles));
  issues.push(...inspectWorkflowPermissions(workflowFiles));
  issues.push(...inspectSecurityGateFiles(gateFiles));

  let auditReport;
  if (Object.prototype.hasOwnProperty.call(options, "auditReport")) {
    auditReport = options.auditReport;
  } else {
    try {
      auditReport = runDependencyAudit(root);
    } catch (error) {
      issues.push(`pnpm audit: command failed or returned invalid JSON (${errorMessage(error)})`);
    }
  }

  if (auditReport !== undefined) {
    const auditResult = inspectAuditReport(auditReport);
    if (Array.isArray(auditResult)) issues.push(...auditResult);
  }

  if (issues.length > 0) {
    console.error(`❌ security/config check failed (${issues.length}):`);
    console.error(formatSecurityIssues(issues));
    return 1;
  }

  console.log(
    `✅ security/config checks passed: ${trackedFiles.length} tracked files, ${sourceFiles.length} source files, ${workflowFiles.length} workflows`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runSecurityConfigCheck();
}
