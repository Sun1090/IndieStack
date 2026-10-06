/**
 * 保留期调度审计的单测。
 *
 * **这个检查最容易出的错是「扫描规则太宽松」**：把没被守卫包住的调度也判成
 * 被守卫包住，于是它永远绿、永远不红——而那正是这条检查要防的那件事本身。
 * 所以这里把「宽松」当成第一类缺陷来测。
 */
import { describe, expect, it } from "vitest";
import {
  auditRetentionCron,
  documentsSkip,
  extractJobs,
  isGuarded,
} from "./retention-cron-audit";

const GUARDED = `
-- 保留期：pg_cron 未安装时跳过（本地环境安全）
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cleanup-old-notifications', '0 4 * * 0', $$select 1$$);
  end if;
end $do$;
`;

const UNGUARDED = `
do $do$
begin
  perform cron.schedule('cleanup-old-api-usage', '0 4 * * 0', $$select 1$$);
end $do$;
`;

describe("isGuarded", () => {
  it("识别出被 pg_cron 守卫包住的调度", () => {
    const sql = GUARDED;
    const index = sql.indexOf("cron.schedule");
    expect(isGuarded(sql.slice(0, index))).toBe(true);
  });

  it("未被守卫的调度判为 false", () => {
    const sql = UNGUARDED;
    const index = sql.indexOf("cron.schedule");
    expect(isGuarded(sql.slice(0, index))).toBe(false);
  });

  it("**只有注释里提到 pg_cron 不算守卫**——否则这张检查会永远绿", () => {
    // 这是最容易写松的一处：`-- 用 pg_cron 调度` 是注释，不是 `if exists (...)`。
    const sql = "-- 用 pg_cron 做每周清理\nperform cron.schedule('x', '0 4 * * 0', $$select 1$$);";
    expect(isGuarded(sql.slice(0, sql.indexOf("cron.schedule")))).toBe(false);
  });

  it("**上一个 do 块的守卫不算守卫**（否则一份文件里有一处守卫就全合规）", () => {
    // 真实迁移（027）就是 do $do$ ... end $do$ 结构。先写一个已闭合的守卫块，
    // 再来一个裸调用——后者必须判为未守卫，否则这条检查在真实迁移上会半失效。
    const sql =
      "do $do$\nbegin\n  if exists (select 1 from pg_extension where extname = 'pg_cron') then\n" +
      "    perform cron.schedule('a', '0 4 * * 0', $$select 1$$);\n  end if;\nend $do$;\n" +
      "do $do$\nbegin\n  perform cron.schedule('b', '0 4 * * 0', $$select 1$$);\nend $do$;";
    const jobs = extractJobs("027.sql", sql);
    expect(jobs.map((j) => `${j.name}:${j.guarded}`)).toEqual(["a:true", "b:false"]);
  });

  it("提到 pg_extension 但没有 if exists 也不算守卫", () => {
    const sql =
      "select 1 from pg_extension where extname = 'pg_cron';\n" +
      "perform cron.schedule('x', '0 4 * * 0', $$select 1$$);";
    expect(isGuarded(sql.slice(0, sql.indexOf("cron.schedule")))).toBe(false);
  });
});

describe("documentsSkip", () => {
  it("写明「未安装时跳过」的迁移判为已说明", () => {
    expect(documentsSkip(GUARDED)).toBe(true);
  });

  it("既没有注释也没有任何实义词的迁移判为未说明", () => {
    expect(documentsSkip("do $$ begin perform 1; end $$;")).toBe(false);
  });

  it("**说明写在第 30 多行也算写了**（第一版按 1200 字符截断，把 032 误报成没写）", () => {
    const filler = Array.from({ length: 33 }, (_, i) => `-- 第 ${i + 1} 行无关内容`).join("\n");
    expect(documentsSkip(filler + "\n-- 未安装 pg_cron 的环境自动跳过")).toBe(true);
    // 超过 HEADER_LINES 之后才出现则不算——说明要写在头部区域
    const deep = Array.from({ length: 80 }, (_, i) => `-- 第 ${i + 1} 行`).join("\n");
    expect(documentsSkip(deep + "\n-- 未安装即跳过")).toBe(false);
  });
});

describe("extractJobs", () => {
  it("抽出任务名并带上出处与两个判定", () => {
    const jobs = extractJobs("014_retention_cleanup.sql", GUARDED);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe("cleanup-old-notifications");
    expect(jobs[0].file).toBe("014_retention_cleanup.sql");
    expect(jobs[0].guarded).toBe(true);
    expect(jobs[0].documented).toBe(true);
  });

  it("一份迁移里多个任务要全部抽出（生产实测有 6 个）", () => {
    const sql = `${GUARDED}\n${GUARDED.replace("cleanup-old-notifications", "cleanup-old-webhook-events")}`;
    expect(extractJobs("x.sql", sql).map((j) => j.name)).toEqual([
      "cleanup-old-notifications",
      "cleanup-old-webhook-events",
    ]);
  });

  it("没有调度时返回空数组（不编造）", () => {
    expect(extractJobs("empty.sql", "-- 什么都没有")).toEqual([]);
  });

  it("**注释掉的 cron.schedule 不算调度**——否则一条建议片段会被报成未守卫的真调度", () => {
    // 这不是假想：`010_webhook_events.sql` 里就有一段
    // `-- select cron.schedule('cleanup-webhook-events', ...)`，
    // 那是给 Supabase Dashboard 的建议片段。第一版扫描没剥注释，报了假警。
    const sql =
      "-- 数据保留：90 天前的记录由定时任务清理（可在 Dashboard 配置 pg_cron）\n" +
      "-- select cron.schedule('cleanup-webhook-events', '0 3 * * *', $$delete from t$$);\n";
    expect(extractJobs("010.sql", sql)).toEqual([]);
  });

  it("剥注释时**保留字符位置**（后续下标不能错位）", () => {
    const sql = "-- 注释里有 cron.schedule('fake', ...) 这样的字样\nperform cron.schedule('real', '0 4 * * 0', $$select 1$$);";
    const jobs = extractJobs("x.sql", sql);
    expect(jobs.map((j) => j.name)).toEqual(["real"]);
  });
});

describe("auditRetentionCron", () => {
  it("全部合规时通过", () => {
    const report = auditRetentionCron(extractJobs("014.sql", GUARDED));
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it("未守卫的调度 → 红，且错误文案点名任务与文件", () => {
    const report = auditRetentionCron(extractJobs("014.sql", UNGUARDED));
    expect(report.ok).toBe(false);
    expect(report.errors[0].code).toBe("RETENTION_JOB_UNGUARDED");
    expect(report.errors[0].message).toContain("cleanup-old-api-usage");
    expect(report.errors[0].message).toContain("014.sql");
  });

  it("被守卫但没写说明 → 红（下一个读代码的人会猜错）", () => {
    // 直接写一份「有守卫、但文件头没有任何实义词说明」的完整迁移，别用字符串拼接去改
    const bare = `do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cleanup-old-x', '0 4 * * 0', $$select 1$$);
  end if;
end $do$;
`;
    const jobs = extractJobs("999.sql", bare);
    expect(jobs[0].guarded).toBe(true);
    const report = auditRetentionCron(jobs);
    expect(report.ok).toBe(false);
    expect(report.errors[0].code).toBe("RETENTION_JOB_UNDOCUMENTED");
  });

  it("**一条调度都扫不到时也要红**——扫不到东西的检查等于没有检查", () => {
    const report = auditRetentionCron([]);
    expect(report.ok).toBe(false);
    expect(report.errors[0].code).toBe("NO_RETENTION_JOBS");
  });

  it("两种问题同时存在时两条都报（不只报第一个）", () => {
    const sql = `${GUARDED}\n${UNGUARDED}`;
    const report = auditRetentionCron(extractJobs("mix.sql", sql));
    const codes = report.errors.map((e) => e.code);
    expect(codes).toContain("RETENTION_JOB_UNGUARDED");
    expect(report.ok).toBe(false);
  });
});