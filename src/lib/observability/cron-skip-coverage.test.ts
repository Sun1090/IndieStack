/**
 * 「跳过必须可见」静态规则测试（A04）。
 * 覆盖：无条件 continue 不判、两种计数证据、证据不足/用错指标/缺 reason、
 * 跨函数不认、语法错误返回 null 与消息渲染。
 */
import { describe, it, expect } from "vitest";
import { auditCronSkips, formatSkipFindings } from "./cron-skip-coverage";

const FILE = "src/app/api/cron/x/route.ts";

function audit(source: string, skipMetrics = ["cron.digest.skipped"]) {
  return auditCronSkips({ source, fileName: FILE, skipMetrics });
}

describe("auditCronSkips 判定范围", () => {
  it("没有条件 continue 时不报", () => {
    const result = audit(`
      async function run(items: number[]) {
        let sent = 0;
        for (const item of items) {
          sent += item;
        }
        return { sent };
      }
    `);
    expect(result).not.toBeNull();
    expect(result?.total).toBe(0);
    expect(result?.uncounted).toEqual([]);
  });

  it("无条件 continue（非 if 守卫）不计入审计", () => {
    const result = audit(`
      async function run(items: number[]) {
        let sent = 0;
        for (const item of items) {
          continue;
        }
        return { sent };
      }
    `);
    expect(result?.total).toBe(0);
  });

  it("条件 continue 没有任何计数证据时报未上报", () => {
    const result = audit(`
      async function run(items: { email: string | null }[]) {
        let sent = 0;
        for (const item of items) {
          if (!item.email) continue;
          sent += 1;
        }
        return { sent };
      }
    `);
    expect(result?.uncounted).toEqual([{ line: 5, condition: "!item.email" }]);
    expect(result?.reasonMissing).toEqual([]);
  });

  it("同一分支上报登记的 skip 指标即通过", () => {
    const result = audit(`
      async function run(items: { email: string | null }[]) {
        let sent = 0;
        for (const item of items) {
          if (!item.email) {
            recordMetric("cron.digest.skipped", 1, { unit: "count", attributes: { reason: "no_email" } });
            continue;
          }
          sent += 1;
        }
        return { sent };
      }
    `);
    expect(result?.uncounted).toEqual([]);
    expect(result?.reasonMissing).toEqual([]);
  });

  it("上报的指标不在该 worker 的 skipMetrics 里不算证据", () => {
    const result = audit(`
      async function run(items: { email: string | null }[]) {
        let sent = 0;
        for (const item of items) {
          if (!item.email) {
            recordMetric("email.backlog", 1, { unit: "count", attributes: { reason: "no_email" } });
            continue;
          }
          sent += 1;
        }
        return { sent };
      }
    `, ["cron.digest.skipped"]);
    expect(result?.uncounted).toHaveLength(1);
  });

  it("skip 指标没有 reason 维度时报 reasonMissing", () => {
    const result = audit(`
      async function run(items: { email: string | null }[]) {
        let sent = 0;
        for (const item of items) {
          if (!item.email) {
            recordMetric("cron.digest.skipped", 1, { unit: "count" });
            continue;
          }
          sent += 1;
        }
        return { sent };
      }
    `);
    expect(result?.uncounted).toEqual([]);
    expect(result?.reasonMissing).toHaveLength(1);
  });

  it("累加进该轮返回的计数器视为已可见", () => {
    const result = audit(`
      async function run(items: { ok: boolean }[]) {
        let sent = 0;
        let failed = 0;
        for (const item of items) {
          if (!item.ok) {
            failed += 1;
            continue;
          }
          sent += 1;
        }
        return { sent, failed };
      }
    `);
    expect(result?.uncounted).toEqual([]);
  });

  it("累加没有进入返回对象的计数器仍然算静默", () => {
    const result = audit(`
      async function run(items: { ok: boolean }[]) {
        let sent = 0;
        let swallowed = 0;
        for (const item of items) {
          if (!item.ok) {
            swallowed += 1;
            continue;
          }
          sent += 1;
        }
        return { sent };
      }
    `);
    expect(result?.uncounted).toHaveLength(1);
  });

  it("返回对象里显式写 key 的计数器同样算证据", () => {
    const result = audit(`
      async function run(items: { ok: boolean }[]) {
        let sent = 0;
        let failed = 0;
        for (const item of items) {
          if (!item.ok) {
            failed += 1;
            continue;
          }
          sent += 1;
        }
        return { sent: sent, failed: failed };
      }
    `);
    expect(result?.uncounted).toEqual([]);
  });

  it("顶层循环（函数体外）的 continue 不在核对范围内", () => {
    const result = audit(`
      for (const item of []) {
        if (!item) continue;
      }
    `);
    expect(result?.total).toBe(0);
    expect(result?.uncounted).toEqual([]);
  });

  it("嵌套函数里的 continue 由它自己的函数判断", () => {
    const result = audit(`
      async function outer() {
        let failed = 0;
        const inner = (items: { ok: boolean }[]) => {
          for (const item of items) {
            if (!item.ok) continue;
          }
        };
        inner([]);
        return { failed };
      }
    `);
    // inner 没有 return 对象，证据无从谈起：必须报，而不是借 outer 的计数器蒙过去
    expect(result?.uncounted).toHaveLength(1);
  });

  it("解析失败返回 null（按无法核对失败封闭）", () => {
    expect(audit("async function run( { return }")).toBeNull();
  });
});

describe("formatSkipFindings", () => {
  it("带文件与行号渲染两类问题", () => {
    const result = audit(`
      async function run(items: { email: string | null }[]) {
        for (const item of items) {
          if (!item.email) continue;
        }
        return {};
      }
    `);
    expect(formatSkipFindings(result!, FILE)).toEqual([
      `${FILE}:4 条件跳过未上报计数：!item.email`,
    ]);
  });

  it("缺 reason 的那类单独成行", () => {
    const result = audit(`
      async function run(items: { email: string | null }[]) {
        for (const item of items) {
          if (!item.email) {
            recordMetric("cron.digest.skipped", 1, { unit: "count" });
            continue;
          }
        }
        return {};
      }
    `);
    expect(formatSkipFindings(result!, FILE)).toEqual([
      `${FILE}:6 跳过计数缺少 reason 维度：!item.email`,
    ]);
  });
});
