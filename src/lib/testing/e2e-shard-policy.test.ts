import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function workflowJob(workflow: string, id: string): string {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^  ${escapedId}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\n|$(?![\\s\\S]))`, "m").exec(workflow);
  if (!match) throw new Error(`ci.yml 中找不到 ${id} job`);
  return match[0];
}

function e2eJob(workflow: string): string {
  return workflowJob(workflow, "e2e");
}

describe("E2E shard policy", () => {
  const workflow = read(".github/workflows/ci.yml");
  const config = read("playwright.config.ts");
  const job = e2eJob(workflow);

  it("keeps mutable Mock tests serial unless the isolation experiment opts in", () => {
    expect(config).toContain('const fullyParallel = process.env.PW_FULLY_PARALLEL === "true";');
    expect(config).toContain("fullyParallel,");
    expect(config).toContain("workers: fullyParallel ? undefined : 1");
  });

  it("runs two isolated CI shards with independent servers and artifact names", () => {
    expect(job).toMatch(/strategy:\n\s+fail-fast: false\n\s+matrix:\n\s+shard: \[1, 2\]/);
    expect(job).toContain("pnpm test:e2e --shard=${{ matrix.shard }}/2");
    expect(job).toContain("if: matrix.shard == 1\n        run: pnpm test:visual");
    expect(job).toContain("name: playwright-report-shard-${{ matrix.shard }}");
  });

  it("aggregates matrix shards into the stable branch-protection context", () => {
    expect(job).toContain("name: E2E shard ${{ matrix.shard }}");
    const gate = workflowJob(workflow, "e2e-gate");
    expect(gate).toContain("name: E2E (Playwright)");
    expect(gate).toContain("needs: [e2e]");
    expect(gate).toContain('run: test "$E2E_RESULT" = "success"');
  });
});
