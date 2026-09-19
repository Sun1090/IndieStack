/**
 * 告警阈值与去重契约测试（v0.6.0 E07）
 *
 * 运维文档（`docs/operations/sentry-alerts.md`）是告警规则的唯一落地说明，
 * 但阈值一旦只写在文档里就会和代码漂移：代码把积压判成 `> 800`、文档还写着
 * `> 500`，值班的人按文档排查就会得出「没超阈值」的错误结论。
 *
 * 这里把「文档写的阈值」和「代码里的常量」钉在一起，并锁定恢复指标的
 * 去重语义（每轮每动作恰好一条样本，按 `action` 分流而不是按数值 0/1）。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EMAIL_BACKLOG_ALERT_THRESHOLD } from "@/lib/repositories/notifications";
import { PUSH_BACKLOG_ALERT_THRESHOLD } from "@/lib/repositories/push-delivery-attempts";
import { OPS_SUPABASE_RESTORE_ACTIONS, OPS_SUPABASE_RESTORE_METRIC } from "./ops-metrics";

const OPERATIONS_DOC = fs.readFileSync(
  path.join(process.cwd(), "docs/operations/sentry-alerts.md"),
  "utf8",
);

/** 指标契约表里的那一行（只登记名称/单位/维度/采集时机）。 */
function metricRow(metric: string): string | null {
  const row = OPERATIONS_DOC.split("\n").find(
    (line) => line.startsWith("|") && line.includes(`\`${metric}\``),
  );
  return row ?? null;
}

/** 「建议指标告警与去重」表里含该指标告警条件的那一行（必须带比较运算符）。 */
function alertRow(metric: string): string | null {
  const row = OPERATIONS_DOC.split("\n").find(
    (line) => line.startsWith("|") && line.includes(metric) && line.includes(">"),
  );
  return row ?? null;
}

describe("积压告警阈值", () => {
  it("邮件与 Push 积压阈值都是 500", () => {
    expect(EMAIL_BACKLOG_ALERT_THRESHOLD).toBe(500);
    expect(PUSH_BACKLOG_ALERT_THRESHOLD).toBe(500);
  });

  it("运维文档登记的阈值与代码常量一致", () => {
    expect(alertRow("email.backlog")).toContain(`email.backlog > ${EMAIL_BACKLOG_ALERT_THRESHOLD}`);
    expect(alertRow("push.backlog")).toContain(`push.backlog > ${PUSH_BACKLOG_ALERT_THRESHOLD}`);
  });

  it("积压告警要求连续轮次或时间窗口，避免瞬时抖动误报", () => {
    expect(alertRow("email.backlog")).toContain("连续 3 轮");
    expect(alertRow("push.backlog")).toContain("连续 3 轮");
  });
});

describe("恢复指标告警", () => {
  it("运维文档登记指标、单位、维度与全部动作取值", () => {
    const row = metricRow(OPS_SUPABASE_RESTORE_METRIC);
    expect(row).not.toBeNull();
    expect(row).toContain("`count`");
    expect(row).toContain("action");
    for (const action of OPS_SUPABASE_RESTORE_ACTIONS) {
      expect(row).toContain(action);
    }
  });

  it("恢复 / 人工介入 / 跳过各有独立告警条件", () => {
    expect(OPERATIONS_DOC).toContain(`${OPS_SUPABASE_RESTORE_METRIC}{action="restore"} > 0`);
    expect(OPERATIONS_DOC).toContain(`${OPS_SUPABASE_RESTORE_METRIC}{action="escalate"} > 0`);
    expect(OPERATIONS_DOC).toContain(`${OPS_SUPABASE_RESTORE_METRIC}{action="skipped"} > 0`);
  });

  it("文档说明每轮每动作恰好一条 value=1 样本，按 action 去重", () => {
    expect(OPERATIONS_DOC).toContain("每轮恰好一条");
    expect(OPERATIONS_DOC).toContain("value=1");
  });
});
