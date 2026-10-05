/**
 * B03 / B04 / B05 演练的前置条件判定（纯规则，IO 在 `scripts/lib/drill-preflight.js`）。
 *
 * **为什么要有这一层**：这三条演练从 2026-08 起就一直标着「未完成：外部权限」。
 * 每次重看都要重新回忆一遍「到底缺哪个凭据、缺了怎么拿」——这是把记忆当依赖。
 * 把「缺什么、怎么补、补齐后第一条命令是什么」写成可执行的判定，
 * 成本是这一份文件，收益是**拿到凭据那天不需要临场思考**。
 *
 * **为什么只做前置判定，不把演练本身也写了**：执行 B03 要真删账号、
 * B04 要在云端跑擦除 SQL——这些代码在**没有任何凭据的情况下无法被测试**。
 * 一段永远没跑过的删除脚本比没有更糟：它看起来是「就绪」的，
 * 于是某天在生产上第一次运行，而它的第一次运行就是不可逆操作。
 * 这里的取舍是明确的：**先把能验证的部分做完**（判定逻辑本身有单测），
 * 执行器等有隔离账号时**与第一次实跑一起写**，并当场被验证。
 *
 * **这个模块绝不说「演练通过」**：它只输出 `ready`（前置齐了）与 `blocked`（缺什么）。
 * 「通过」只能由执行器在真的跑完之后产出。
 */

/** 三条演练的标识。与 roadmap `docs/roadmap-0.12.0.md` 的 B03/B04/B05 一一对应。 */
export type DrillId = "B03" | "B04" | "B05";

/** 单条前置条件。 */
export interface DrillRequirement {
  /** 环境变量名；`"file:~/.supabase/access-token"` 表示「文件存在即可」。 */
  readonly source: string;
  /** 人类可读的说明：这条是干什么用的。 */
  readonly purpose: string;
  /** 拿到它的办法。没有办法的才叫真阻塞。 */
  readonly remedy: string;
}

/** 一条演练的前置条件清单。 */
export interface DrillSpec {
  readonly id: DrillId;
  readonly title: string;
  /** 为什么它现在做不了——一句话，说清是「缺权限」而不是「没做」。 */
  readonly blockedReason: string;
  readonly requirements: readonly DrillRequirement[];
  /** 前置齐了之后要跑的第一条命令。**刻意写具体**：这一步历史上靠临场回忆。 */
  readonly firstCommand: string;
  /** 实跑成功后要把结论写回哪个文件。 */
  readonly evidenceTarget: string;
}

/**
 * 三条演练的前置条件。
 *
 * 变量名取自代码里的真实读取点，不是猜的：
 *  - `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`：`src/lib/supabase/server.ts`
 *    与 admin 客户端边界（`erase_user_data` 需要 service_role，客户端 anon key 调不动）。
 *  - `RESEND_API_KEY`：`src/lib/email-send.ts`。
 *  - VAPID 一对：`src/lib/env.ts` 校验两者必须同有同无。
 */
export const DRILL_SPECS: readonly DrillSpec[] = [
  {
    id: "B03",
    title: "隔离账号的账户删除全链路",
    blockedReason:
      "需要一个**可牺牲**的隔离账号：真实 `auth.admin.deleteUser` 是不可逆的，" +
      "拿真实用户跑等于删数据。所以缺的不是代码，是「一个敢删的账号」。",
    requirements: [
      {
        source: "NEXT_PUBLIC_SUPABASE_URL",
        purpose: "指向要演练的那个云端项目",
        remedy: "Supabase 项目的 Settings → API",
      },
      {
        source: "SUPABASE_SERVICE_ROLE_KEY",
        purpose: "擦除 RPC（`erase_user_data`）只对 service_role 开放，客户端 anon key 调不动",
        remedy: "同页的 service_role key；**不要**提交进仓库或贴进任何日志",
      },
      {
        source: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        purpose: "以该账号身份登录，走真实会话",
        remedy: "同页的 anon / publishable key",
      },
      {
        source: "DRILL_ISOLATED_ACCOUNT_EMAIL",
        purpose:
          "**必须**是一个可牺牲的账号。这里是显式变量而不是「随便填一个」：" +
          "填错就会删掉真人账号，而这一步没有回滚",
        remedy: "自己新建一个专用账号（不要用任何真实用户的邮箱）",
      },
    ],
    firstCommand:
      "pnpm drills:preflight --drill B03   # 先确认四项齐了，再看下面的执行器状态",
    evidenceTarget: "docs/db/retention.md 的「仍未取得的生产证据」一节",
  },
  {
    id: "B04",
    title: "云端 Supabase 的保留期与擦除同型演练",
    blockedReason:
      "两份演练 SQL（`docs/operations/drills/*.sql`）已经在本地跑过；" +
      "云端跑需要**项目级管理权限**，本地那份链接（`supabase link`）指向的凭据不可用。",
    requirements: [
      {
        source: "file:~/.supabase/access-token",
        purpose: "Supabase CLI 的登录态。没有它任何 `--linked` 命令都会卡在登录提示上",
        remedy: "supabase login，或 export SUPABASE_ACCESS_TOKEN=<personal access token>",
      },
      {
        source: "NEXT_PUBLIC_SUPABASE_URL",
        purpose: "确认 CLI 连的是**哪个**项目——演练 SQL 是不可逆的，连错项目等于在错库上擦",
        remedy: "Supabase 项目的 Settings → API",
      },
    ],
    firstCommand:
      "supabase migration list --linked   # 确认连的是目标项目且迁移已全部应用，再谈演练",
    evidenceTarget: "docs/operations/production-smoke-v0.11.0.md 的云端行",
  },
  {
    id: "B05",
    title: "provider 与 incident 演练（Resend / Web Push / Supabase 恢复）",
    blockedReason:
      "每一条都要**打真实的 provider**：发真信、真推一个失效的 VAPID、真触发一次恢复。" +
      "缺的是可牺牲的测试凭据，不是脚本。",
    requirements: [
      {
        source: "RESEND_API_KEY",
        purpose: "演练「缺失 / 限流」两种降级，必须打到真 endpoint 才验得到真实响应形状",
        remedy: "Resend 控制台的测试 API key",
      },
      {
        source: "VAPID_PRIVATE_KEY + NEXT_PUBLIC_VAPID_PUBLIC_KEY",
        purpose:
          "演练 VAPID 失效。两个变量必须**同时**存在——`src/lib/env.ts` 会在只有一个时拒绝启动",
        remedy: "`pnpm web-push generate-vapid-keys` 产出一对，写进环境变量",
      },
      {
        source: "SUPABASE_ACCESS_TOKEN",
        purpose: "恢复链路演练要在项目上真的做一次停机/恢复",
        remedy: "同 B04",
      },
    ],
    firstCommand: "pnpm drills:preflight --drill B05",
    // 这里原本写的是「各 provider runbook 的「执行记录」小节」——**那个小节当时不存在**：
    // `docs/operations/` 下压根没有 provider 专属 runbook。写一个不存在的落点，
    // 等于让实跑结论在两年后丢进虚空。
    // 2026-10-05 把根因补上了：新建 `docs/operations/provider-incident-drills.md`，
    // 落点随之指向它；`preflight.test.ts` 里的「证据落点必须 existsSync」会盯着这件事。
    evidenceTarget: "docs/operations/provider-incident-drills.md 的「执行记录」小节",
  },
];

/** 一条前置条件的判定结果。 */
export interface RequirementVerdict {
  readonly source: string;
  readonly satisfied: boolean;
  readonly purpose: string;
  readonly remedy: string;
}

/** 一条演练的判定结果。 */
export interface DrillVerdict {
  readonly id: DrillId;
  readonly title: string;
  readonly blockedReason: string;
  readonly requirements: readonly RequirementVerdict[];
  readonly firstCommand: string;
  readonly evidenceTarget: string;
  /** 全部前置齐了为 true。**注意它只说「可以跑了」，不说「跑过了」。** */
  readonly ready: boolean;
}

/** 判定输入：一个变量名 → 是否有值。文件型前置用 `file:` 前缀由调用方先解析成布尔。 */
export type EnvProbe = Readonly<Record<string, boolean>>;

/**
 * 判定一条演练的前置是否齐。
 *
 * `env` 里出现 `A + B` 这种复合 source 时，**任何一项缺失就算不满足**——
 * VAPID 那一对正是这种情况（`src/lib/env.ts` 要求同有同无）。
 */
export function evaluateDrill(spec: DrillSpec, env: EnvProbe): DrillVerdict {
  const requirements = spec.requirements.map((requirement) => {
    const parts = requirement.source.split(" + ");
    const satisfied = parts.every((part) => env[part.trim()] === true);
    return {
      source: requirement.source,
      satisfied,
      purpose: requirement.purpose,
      remedy: requirement.remedy,
    };
  });
  return {
    id: spec.id,
    title: spec.title,
    blockedReason: spec.blockedReason,
    requirements,
    firstCommand: spec.firstCommand,
    evidenceTarget: spec.evidenceTarget,
    ready: requirements.every((requirement) => requirement.satisfied),
  };
}

/** 判定全部三条。给不出 drill id 时返回全部——默认给全部比默认给空更安全。 */
export function evaluateAllDrills(env: EnvProbe, only?: DrillId): DrillVerdict[] {
  return DRILL_SPECS.filter((spec) => !only || spec.id === only).map((spec) =>
    evaluateDrill(spec, env),
  );
}

/**
 * 全局结论。
 *
 * **刻意不提供「演练已完成」的判据**：完成与否是执行器的产出，
 * 而执行器还没写（理由见文件头）。一个能读出「已完成」的判定函数，
 * 在没有执行器的情况下只会永远返回 false 或者被人改成永远返回 true。
 */
export function summarize(verdicts: readonly DrillVerdict[]): {
  readonly ready: readonly DrillId[];
  readonly blocked: readonly DrillId[];
  readonly headline: string;
} {
  const ready = verdicts.filter((verdict) => verdict.ready).map((verdict) => verdict.id);
  const blocked = verdicts.filter((verdict) => !verdict.ready).map((verdict) => verdict.id);
  const headline =
    ready.length === 0
      ? `${blocked.length} 条演练缺外部权限，本命令只报「还缺什么」，不代表任何演练已通过`
      : `${ready.length}/${verdicts.length} 条演练前置齐了（${ready.join(", ")}）——` +
        `这只说明「可以跑」，执行器与实跑证据仍未产出`;
  return { ready, blocked, headline };
}