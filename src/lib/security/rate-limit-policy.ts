/**
 * 限流两态台账（v0.12.0 C12）。
 *
 * 判据只有一句：**每个 handler 要么有窗口，要么在台账里写明它为什么可以没有**。
 * 两个状态都不满足就是红；有窗口却还躺着一条台账也是红（豁免过期了）。
 *
 * 「有没有窗口」不写在台账里，也不靠 grep 路由文件的 import 列表——它由调用图现量
 * （`RouteHandlerFact.limiters`，#138 那半边）。台账只负责表达另一半：人做的判断。
 * 于是这条门禁抓的是「没人想过」，不是「没人写成文字」。
 */

import type { RouteHandlerFact } from "./route-auth.ts";

export type RateLimitIssueCode =
  /** 一个 handler 都没解析出来：目录约定或解析器失效，不能报「一切正常」。 */
  | "RATE_LIMIT_NO_HANDLERS"
  /** 全仓库匹配不到任何限流器绑定：更可能意味着判据失效，而不是限频突然清零。 */
  | "RATE_LIMIT_NOTHING_MEASURED"
  /** 没有窗口、也没有台账条目：既没做也没想过。 */
  | "RATE_LIMIT_UNLEDGED"
  /** 台账里有豁免，但调用图现在看得见窗口：豁免过期，删掉它。 */
  | "RATE_LIMIT_STALE"
  /** 台账里的键在代码里已经没有对应的 handler 了。 */
  | "RATE_LIMIT_ORPHAN"
  /** 有条目但理由为空：没有理由的豁免只是一张「先这样吧」的条子。 */
  | "RATE_LIMIT_REASON_MISSING"
  /** 标了「已知缺口」却没写复核期限：这个缺口不会过期，于是没人再看它。 */
  | "RATE_LIMIT_GAP_REVIEW_MISSING"
  /** 缺口的复核期限已过：重新确认它是否还成立，或关掉它。 */
  | "RATE_LIMIT_GAP_REVIEW_OVERDUE";

export interface RateLimitEntry {
  /** 人写的判断：这个端点没有窗口，为什么这样是成立的。 */
  reason: string;
}

export interface RateLimitIssue {
  code: RateLimitIssueCode;
  subject: string;
  message: string;
}

function issue(code: RateLimitIssueCode, subject: string, message: string): RateLimitIssue {
  return { code, subject, message };
}

/**
 * 「写明理由」有两种，长得像但不该混：一种是**判定为不需要**，另一种是**知道有暴露、还没关**。
 * 后者必须以 `RATE_LIMIT_GAP_MARKER` 开头，于是每次 CI 都会把缺口的条数打在读数里——
 * 台账最容易烂掉的方式不是漏登记，而是把「还没做」写成一副已经想清楚的样子。
 * 标了这个头的条目必须说出**怎么关**（一条判据，或在飞的 PR 号），否则不算缺口，算逃避。
 */
export const RATE_LIMIT_GAP_MARKER = "**已知缺口";

/**
 * mock 面 15 条共用的那半句判断。写在一处不是为了省字，而是因为**理由确实相同**：
 * 它们只在 `NEXT_PUBLIC_MOCK_ENABLED=true` 时存在，读写的是进程内的假 store。
 * 每条各自补一句它动的是哪张表、读还是写。
 */
const MOCK_SURFACE =
  "只在 mock 构型下存在（`isMockEnabled` 关掉时直接 404），读写的是进程内的假 store，" +
  "不触达 Supabase、不调任何计费 provider。";

/**
 * mock 面那条**没被美化掉**的残余暴露。它是真话，也是这一列端点共同的边界条件：
 * 开着 mock 的生产部署里，重复打这些端点会让内存涨——暴露的是内存与假数据，不是真实数据。
 * 这一段是 C12 写作时的读数，2026-09-29 起**不再成立**：C13 已经把「生产不许开 mock」
 * 落成 `pnpm check:security` 里的 `inspectProductionMockSettings`，运行时那道闸在
 * `src/lib/mock/config.ts`（`evaluateMockMode` 见 `NODE_ENV=production` 直接返回 false）。
 * 所以下面那句话的结论是「进不来」，而它守的仍然是另一件事——**万一**哪次真进来
 * （平台上的环境变量、绕过一次构建、或哪条配置路径这条门禁还没覆盖），
 * 这一列端点没有窗口这件事要有据可查，而不是靠一句「反正进不来」。
 */
const MOCK_SURFACE_RESIDUE =
  "留一句实话：假 store 是进程内数组、追加没有上界，所以在开着 mock 的部署里重复 POST 会涨内存——" +
  "「生产构型不许开着 mock」由 C13 的 check:security 规则与 config.ts 的运行时常量各守一道，" +
  "所以这一列端点不加窗口是「进不来」的结论，不是「没人想过」。";


function mockOnly(what: string): RateLimitEntry {
  return { reason: `${MOCK_SURFACE}${what}。${MOCK_SURFACE_RESIDUE}` };
}

/**
 * 共享密钥面（cron 与运维端点）共用的判断骨架。
 * 关键不在于「有 CRON_SECRET 就够了」——密钥泄露时窗口本来也拦不住拿着密钥的人，
 * 而在于**这些端点没有「被驱动着多干活」的放大器**：重复调用只会重复做同一件有界的事。
 */
const CRON_SURFACE =
  "凭 `CRON_SECRET`（Vercel Cron 自动附加 Bearer），调用方是排程而不是用户。";

export const RATE_LIMIT_LEDGER: Readonly<Record<string, RateLimitEntry>> = {
  // ---------------------------------------------------------------- mock 面（15）
  "GET /api/e2e/contact-messages": mockOnly("GET 只读回当前 worker 看到的留言列表"),
  "POST /api/e2e/contact-messages": mockOnly("POST 往留言列表里追加一条假留言"),
  "DELETE /api/e2e/contact-messages": mockOnly("DELETE 清空留言列表"),
  "GET /api/e2e/webhook-events": mockOnly("GET 只读回假 webhook 事件"),
  "DELETE /api/e2e/webhook-events": mockOnly("DELETE 清空假 webhook 事件"),
  "GET /api/e2e/seed-notifications": mockOnly("GET 只读回种子通知"),
  "POST /api/e2e/seed-notifications": mockOnly("POST 种若干条通知进假 store"),
  "DELETE /api/e2e/seed-notifications": mockOnly("DELETE 清空通知表"),
  "GET /api/e2e/push-queue": mockOnly("GET 只读回 Web Push 队列条目"),
  "POST /api/e2e/push-queue": mockOnly("POST 往推送队列里造条目"),
  "DELETE /api/e2e/push-queue": mockOnly("DELETE 清空推送队列"),
  "GET /api/e2e/email-worker-runs": mockOnly("GET 只读回 digest 运行记录"),
  "GET /api/e2e/mock-upload": mockOnly("GET 读回 mock storage 的对象列表"),
  "POST /api/e2e/mock-upload": mockOnly("POST 往 mock storage 里写一个对象"),
  "POST /api/e2e/mock-reset": mockOnly(
    "POST 把整个假 store 重置回初始值——它的「杀伤力」恰好是让测试回到干净状态" +
      "；能重置假数据的人本来也能写假数据，这两件事在同一个开关后面",
  ),
  // ---------------------------------------------------------- 共享密钥面（8）
  "POST /api/cron/digest": {
    reason:
      `${CRON_SURFACE}重复调用不会把「寄出的信」放大到超过队列本身：每一轮只处理` +
      "`created_at` 升序的一批待发条目，队列空了之后再来就是空转。窗口拦不住拿着密钥的人，" +
      "只会把平台调度本身读成 429。异常放大走指标（`email.backlog`、`cron.digest.*`）。",
  },
  "POST /api/cron/push-retry": {
    reason:
      `${CRON_SURFACE}与 digest 同理：每轮处理的是队列里到期的条目，重试计数与行龄上界` +
      "已经把单条的生命周期钉住（超过上界进死信），重复触发只会更快走到那个上界。",
  },
  "GET /api/cron/push-retry": {
    reason:
      "Vercel Cron 用 GET 调同一个 worker（`vercel.json` 的 cron 排程是 GET），" +
      "判据与 `POST /api/cron/push-retry` 完全一致——**同一件事的两个动词形态**，" +
      "所以两边的结论必须一起改：只给 POST 加窗口会把排程那一条读成「有守卫」。",
  },
  "POST /api/cron/retention": {
    reason:
      `${CRON_SURFACE}保留策略按「该删的」工作：每轮删的是超过保留期的行，删完即空，` +
      "重复调用不产生新的删除对象，也不触达任何计费 provider。",
  },
  "GET /api/ops/provider-status": {
    reason:
      "纯本地读 `process.env`，**不碰网络、不碰数据库**，代价只是几十个字符串比较——" +
      "这类端点的正确保护是共享密钥而不是 IP 滑窗：IP 限流在这里既拦不住持有密钥的人，" +
      "也会把拿着密钥做每日 cron 核验的运维脚本挡在门外。" +
      "注意它**确实**是无副作用的读，这与本仓库其他运维面（如 `supabase-restore` 会写上游）不同，" +
      "所以连「上游配额」这个借由都不需要。",
  },
  "GET /api/ops/supabase-restore": {
    reason:
      `${CRON_SURFACE}读一次 Supabase Management API 的项目状态，只有明确返回` +
      "`INACTIVE` 才执行 restore，其余状态只报告不动手。重复调用的代价是**上游自己的配额**：" +
      "Management API 有平台侧限频，我们在前面再套一层 IP 滑窗既拦不住拿着密钥的人，" +
      "也会把真正需要恢复的那一次挡住。这是一条「借用上游配额」的判断，写清楚它借的是谁。",
  },
  "GET /api/e2e/email-inbox": {
    reason:
      "E2E 收件箱：`e2eBearerAuthorized` 先比 Bearer，非 mock 构型直接 404，" +
      "读的是本进程捕获下来的假邮件列表。它连的是 `RESEND_API_URL` 指向本端点这条测试链路，" +
      "不在任何真实出网路径上。",
  },
  "POST /api/e2e/email-inbox": {
    reason:
      "同上（Bearer + 非 mock 404）：POST 是「假 provider 收到了一封信」的落点，" +
      "写进进程内数组。`?failNext=1` 的故障注入是一次性的，不会被重复触发拖成持续 503。" +
      "残余暴露与 mock 面同一条：数组无上界，开 mock 的生产部署会被打满内存。",
  },
  "DELETE /api/e2e/email-inbox": {
    reason: "同上（Bearer + 非 mock 404）：清空的是本进程的假收件箱，测试自己的前置动作。",
  },

  // ------------------------------------------------------------ 签名面（1）
  "POST /api/webhooks/stripe": {
    reason:
      "Stripe 的投递在验签之前拿不到任何副作用：缺 `stripe-signature` 直接 400，" +
      "`constructEvent` 验签失败也停在 400，两条都在读事件表之前。验签用 `STRIPE_WEBHOOK_SECRET`，" +
      "伪造签名过不来，真签名只有 Stripe 发得出。给它加窗口会打疼 Stripe 自己的重试策略" +
      "（至少一次投递、失败退避重发），而幂等占位已经把重复投递的副作用消掉了。",
  },

  // ------------------------------------------------------ public 读端点（5）
  "GET /api/marketing/confirm": {
    reason:
      "GET 只渲染邮件链接落地的那页 HTML（不查库、不消费 token，token 原样回填进表单），" +
      "真正改状态的是同路径的 POST。无窗口的那半是纯计算 + `no-store`；有暴露的那半已经在上面登记。",
  },
  "GET /api/marketing/unsubscribe": {
    reason: "同上：GET 渲染退订确认页，改状态的是 POST。",
  },
  "GET /api/auth/callback": {
    reason:
      "OAuth / 魔法链接回调：进来时没有会话，凭的是一次性 code（用过即废，重复消费已被堵掉），" +
      "跳转目标过 `getSafeRedirect` 白名单。code 不可猜测，暴力猜 code 的成本落在 Supabase 的" +
      "token 端点上，不在这里。按 IP 加窗口会误伤同一 NAT 出口后面的正常用户，而它防的那种人" +
      "手里本来就有别人邮箱里的一封真邮件。",
  },
  "GET /api/health": {
    reason:
      `${RATE_LIMIT_GAP_MARKER}，不是判定为无需窗口。**它是就绪探针**：负载均衡、\`check:production-smoke\` ` +
      "与每日保活 cron 都要打它，按 IP 的滑窗会把监控自己读成 429，所以「加窗口」在这条上不是免费的。" +
      "**2026-10-05 起，高频探针不再走这一条**：`/api/health/live` 已拆出并接管 Docker `HEALTHCHECK`，" +
      "所以这一条退回了它本来的角色——发布后与每日一次的**低频**诊断。" +
      "**放大面**：DB 可达性探测走 `createProbeCache`" +
      "（`src/lib/health/probe-cache.ts`，TTL 5s + single-flight），一簇并发的无凭据调用只打一次 Supabase，" +
      "且**失败也缓存**（故障时正是最需要挡住的时刻）；这是**进程内**缓存，serverless 下每实例各一份，" +
      "所以它挡的是「一个实例被重复打」，不是「整个部署被重复打」——这一点没有被夸大。" +
      "**剩下的那一半**：端点本身仍然无凭据、无窗口，且**公开回**依赖配置与精确 commit。" +
      "前半（放大）已经靠拆分收口；后半（披露）是一次**产品判断**而不是技术债：" +
      "对 starter template 来说，「哪些密钥配了、DB 通不通」是运维面板要的东西，" +
      "而模板用户自己的监控可能正在读这些字段，静默改成需要密钥会打断他们。" +
      "所以这里**如实登记为有意披露**，而不是伪装成没有。**关掉它的判据**（两条，满足其一即可）：" +
      "(a) 拆成「公开精简 + 带 `CRON_SECRET` 的明细」两条端点，且 `/api/health` 精简后仍保留 `status`/`ready`/" +
      "`version`/`commit` 这些已被 `check:production-smoke` 与模板用户监控读走的字段；" +
      "(b) 引入跨实例的共享缓存，让无凭据的高频调用不再各打各的 DB。" +
      "走 (a) 之前**必须先问模板用户**：哪些字段被他们的监控读走——" +
      "静默改成需要密钥会打断他们，所以这一步是产品判断，不是技术债。" +
      "复核期限：2026-11-15。",
  },
  "GET /api/health/live": {
    reason:
      "**加窗口会直接弄坏它唯一的使用者**——这条存在的意义就是被容器编排与负载均衡器每 30 秒打一次，" +
      "滑窗会让 Docker `HEALTHCHECK` 把自己的探针读成 429，然后判定实例不健康并重启它：" +
      "限流在这里不是防护，是故障放大器。" +
      "而且这一条**没有值得保护的放大面**：不打数据库、不读任何配置、不返回部署身份，" +
      "单次调用只有一次函数调用与一个静态返回体（`src/app/api/health/live/route.ts` 的模块图里没有 Supabase 客户端，" +
      "由 `live.test.ts` 做结构性断言）。" +
      "与 `/api/health` 的差别正是这一条被拆出来的原因：把「高频」与「有出站与披露」分开，" +
      "高频的那条就干净了。",
  },
};

/**
 * 限流台账核对。`handlers` 来自与 C11 同一次解析（`collectRouteHandlers`），
 * `ledger` 可注入以便单测覆盖每一种偏差形态。
 */
export function auditRateLimits(
  handlers: readonly RouteHandlerFact[],
  ledger: Readonly<Record<string, RateLimitEntry>> = RATE_LIMIT_LEDGER,
  options: { today?: string } = {},
): RateLimitIssue[] {
  if (handlers.length === 0) {
    return [
      issue(
        "RATE_LIMIT_NO_HANDLERS",
        "src/app/api/",
        "一个 API handler 都没解析出来：目录约定或解析器已经失效，不能报「限流台账一致」",
      ),
    ];
  }

  if (!handlers.some((handler) => handler.limiters.length > 0)) {
    return [
      issue(
        "RATE_LIMIT_NOTHING_MEASURED",
        "@/lib/rate-limit",
        `${handlers.length} 个 handler 里一条限流器绑定都没匹配到：判据失效的可能性远大于「全仓库突然没了限频」`,
      ),
    ];
  }

  const issues: RateLimitIssue[] = [];
  const seen = new Set<string>();

  for (const handler of handlers) {
    seen.add(handler.id);
    const entry = ledger[handler.id];
    if (handler.limiters.length > 0) {
      if (entry) {
        issues.push(
          issue(
            "RATE_LIMIT_STALE",
            handler.id,
            `台账给了它豁免，但调用图现在看得见窗口（${handler.limiters.join(", ")}）——` +
              "补限流的 PR 落地后请把这条豁免删掉，否则「谁还没有窗口」这张表就不再是事实",
          ),
        );
      }
      continue;
    }
    if (!entry) {
      issues.push(
        issue(
          "RATE_LIMIT_UNLEDGED",
          handler.id,
          `${handler.file} 的这个 handler 既没有窗口也没有台账条目；` +
            "要么补限流器，要么在 RATE_LIMIT_LEDGER 里写清它为什么可以没有",
        ),
      );
      continue;
    }
    if (entry.reason.trim().length === 0) {
      issues.push(
        issue(
          "RATE_LIMIT_REASON_MISSING",
          handler.id,
          "台账里有这条豁免，但 reason 是空的：没有理由的豁免不算登记",
        ),
      );
    }
  }

  for (const id of Object.keys(ledger).sort()) {
    if (!seen.has(id)) {
      issues.push(
        issue(
          "RATE_LIMIT_ORPHAN",
          id,
          "台账里有这条豁免，代码里已经没有对应的 handler 了——端点改名或删除时把条目一起清掉",
        ),
      );
    }
  }

  // `options.today` 为 undefined 时 auditRateLimitLedger 用真今天——生产门禁要的是真实日期。
  issues.push(...auditRateLimitLedger(ledger, options.today));
  return issues;
}

/** 稳定输出，CLI 与单测共用。 */
export function formatRateLimitIssues(issues: readonly RateLimitIssue[]): string {
  return issues.map((item) => `[${item.code}] ${item.subject}: ${item.message}`).join("\n");
}

/** 通过判定后的那句读数：两个状态各自多少，其中几条是没关的缺口。 */
export function summarizeRateLimits(
  handlers: readonly RouteHandlerFact[],
  ledger: Readonly<Record<string, RateLimitEntry>> = RATE_LIMIT_LEDGER,
): string {
  const limited = handlers.filter((handler) => handler.limiters.length > 0).length;
  const exempted = handlers.length - limited;
  const gaps = Object.values(ledger).filter((entry) =>
    entry.reason.startsWith(RATE_LIMIT_GAP_MARKER),
  ).length;
  return (
    `✅ 限流两态台账一致：${handlers.length} 个 handler = ${limited} 个有窗口` +
    ` + ${exempted} 个写明理由（台账共 ${Object.keys(ledger).length} 条，` +
    `其中 ${gaps} 条标注为已知缺口）`
  );
}

/** 缺口必须说出「怎么关」：一条判据或一个在飞的 PR 号。只说「知道有暴露」不算关法。 */
const GAP_CLOSURE = /#\d+|关掉它的判据|怎么关/;

/**
 * 缺口必须带复核期限，且期限过了就红。
 *
 * **为什么是日期而不是又一个「必须写理由」**：`GAP_CLOSURE` 已经要求缺口说出怎么关，
 * 而这条要求**不会过期**——一条写着「关掉它的判据是 X」的缺口可以在这里躺三年，
 * 每次 CI 仍然只报「1 条已知缺口」，没人被要求再看它一眼。
 * 而 `#197` 那条依赖审计的例外台账立起来的纪律正是这一句：
 * **一个临时的处置方式必须被标明是临时的，并在条件变化时自己变红。**
 * 「已知缺口」是本仓库里最后一类还没接上这个纪律的处置。
 *
 * 形态与那条台账一致：正文里写「复核期限：2026-11-15」，由 `GAP_REVIEW_DATE` 读出来；
 * 缺日期或日期格式不对都红（**写不出来就红，而不是跳过**）。
 */
const GAP_REVIEW_DATE = /复核期限：(\d{4}-\d{2}-\d{2})/;

/** 台账自身的一致性（与调用图无关的那一半）：标了缺口却没写关法的，红。 */
export function auditRateLimitLedger(
  ledger: Readonly<Record<string, RateLimitEntry>> = RATE_LIMIT_LEDGER,
  today: string = new Date().toISOString().slice(0, 10),
): RateLimitIssue[] {
  const issues: RateLimitIssue[] = [];
  for (const [id, entry] of Object.keys(ledger).sort().map((key) => [key, ledger[key]] as const)) {
    if (!entry.reason.startsWith(RATE_LIMIT_GAP_MARKER)) continue;
    if (!GAP_CLOSURE.test(entry.reason)) {
      issues.push(
        issue(
          "RATE_LIMIT_REASON_MISSING",
          id,
          "标成了「已知缺口」却没写怎么关（一条判据或在飞的 PR 号）：缺口没有关法就会永远留在这里",
        ),
      );
    }
    const reviewDate = GAP_REVIEW_DATE.exec(entry.reason)?.[1];
    if (reviewDate === undefined) {
      issues.push(
        issue(
          "RATE_LIMIT_GAP_REVIEW_MISSING",
          id,
          "标成了「已知缺口」却没有复核期限（正文里写「复核期限：YYYY-MM-DD」）：" +
            "一个不会过期的缺口就是一句没人再看的话",
        ),
      );
      continue;
    }
    if (reviewDate < today) {
      issues.push(
        issue(
          "RATE_LIMIT_GAP_REVIEW_OVERDUE",
          id,
          `复核期限 ${reviewDate} 已过：重新确认这个缺口是否还成立、判据是否还正确，` +
            "然后更新期限（并把查证过程写回理由）或关掉缺口",
        ),
      );
    }
  }
  return issues;
}
