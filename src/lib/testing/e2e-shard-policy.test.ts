import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function workflowJob(workflow: string, id: string): string {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `^  ${escapedId}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\n|$(?![\\s\\S]))`,
    "m",
  ).exec(workflow);
  if (!match) throw new Error(`workflow 中找不到 ${id} job`);
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
    // 并行时「几台服务器 = 几个 worker」：默认 store 是进程级的，同一进程里的并发 worker
    // 必然互相看见对方的写入，所以隔离只能落在 worker↔服务器一一对应上。
    expect(config).toContain(
      "const SERVERS = fullyParallel ? Number(process.env.E2E_SERVERS ?? 3) : 1;",
    );
    expect(config).toContain("workers: SERVERS");
    expect(config).toContain("Array.from({ length: SERVERS }");
    // 并行模式下第一个用例本来要为每台服务器付 `next dev` 的按路由冷编译钱，
    // 两轮复跑里红的就是它；预热只在 E2E_SERVERS>1 时生效，不拖慢串行 CI。
    expect(config).toContain('globalSetup: "./e2e/support/warm-up.ts"');
    expect(read("e2e/support/warm-up.ts")).toContain("if (SERVERS < 2) return;");
  });

  it("地址一律走 appUrl()，spec 里不留固定端口和裸相对导航", () => {
    // 写死端口或裸相对路径都会让第二个 worker 打回第一台服务器，隔离只剩形式。
    const dir = path.join(REPO_ROOT, "e2e");
    const offenders: string[] = [];
    for (const entry of fs.readdirSync(dir).sort()) {
      if (!entry.endsWith(".spec.ts")) continue;
      const body = fs.readFileSync(path.join(dir, entry), "utf8");
      if (body.includes("localhost:3100")) offenders.push(`${entry}: 写死了 localhost:3100`);
      if (/page\.goto\((?:"\/|`\/)/.test(body)) {
        offenders.push(`${entry}: page.goto 用了裸相对路径`);
      }
      if (!body.includes("support/base-url") && /page\.goto\(/.test(body)) {
        offenders.push(`${entry}: 有 page.goto 却没引入 appUrl()`);
      }
    }
    expect(offenders).toEqual([]);
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

/**
 * C02 的「可复跑并行基线」。这里锁的不是「并行一定绿」——它可能红，红了要按报告记下
 * 具体是哪一份共享 Mock 状态——锁的是**这次测量确实存在、且测的是全量**。
 */
describe("E2E parallel baseline", () => {
  const workflow = read(".github/workflows/e2e-parallel.yml");
  const parallelJob = workflowJob(workflow, "parallel");

  function artifactNames(): string[] {
    const dir = ".github/workflows";
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir).sort()) {
      if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
      const body = fs.readFileSync(path.join(dir, entry), "utf8");
      for (const match of body.matchAll(
        /uses:\s*actions\/upload-artifact@v\d+[\s\S]*?\n\s+name:\s*([^\n]+)/g,
      )) {
        found.push(match[1].trim());
      }
    }
    return found;
  }

  it("runs every worker against its own dev server", () => {
    expect(parallelJob).toContain('PW_FULLY_PARALLEL: "true"');
    // 服务器数 = worker 数，两者都由 config 读同一个变量，写不一样的值就没有隔离可言
    expect(parallelJob).toContain('E2E_SERVERS: "3"');
    // 全量：不能带 --shard，否则测的是「分片内的并行」，正是要暴露的那件事会被切走
    expect(parallelJob).toContain("run: pnpm test:e2e");
    expect(parallelJob).not.toContain("--shard");
    // 必须关掉重跑：CI 默认 retries=2，重跑会换 workerIndex（也就是换一台服务器），
    // 于是「第二次成功」测的是另一台干净的服务器，共享状态的竞争被抹掉了。
    expect(parallelJob).toContain("pnpm test:e2e --retries=0");
    expect(parallelJob).not.toMatch(/pnpm test:e2e(?![^\n]*--retries=0)/);
  });

  it("is a measurement, not a merge gate", () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:\n {2}schedule:/m);
    expect(workflow).not.toMatch(/^ {2}pull_request:/m);
    expect(workflow).not.toMatch(/^ {2}push:/m);
    // 独立 workflow：既不 needs 别人，也没有别人 needs 它
    expect(parallelJob).not.toContain("needs:");
    expect(fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8")).not.toContain(
      "e2e-parallel",
    );
  });

  it("prints the planned suite so rounds stay comparable", () => {
    expect(parallelJob).toContain("pnpm exec playwright test --list");
  });

  it("keeps the report even when the baseline passes", () => {
    expect(parallelJob).toContain("name: playwright-parallel-baseline");
    expect(parallelJob).toContain("if: always()");
  });

  it("never lets two jobs write the same artifact name", () => {
    // #68 的真实教训：手动 smoke 与定时漂移检查都往 `production-smoke-evidence` 写，
    // 后跑的把先跑的盖掉，于是「证据」悄悄变成了另一件事。
    const names = artifactNames();
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });
});
