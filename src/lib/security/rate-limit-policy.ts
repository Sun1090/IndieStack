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
  | "RATE_LIMIT_REASON_MISSING";

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
 * 「生产不许开 mock」目前没有任何门禁在管（`scripts/check-security-config.js` 里没有 MOCK 字样），
 * 那属于 roadmap 另开的一条，不是这 15 条端点各自该带的窗口。
 */
const MOCK_SURFACE_RESIDUE =
  "留一句实话：假 store 是进程内数组、追加没有上界，所以在开着 mock 的部署里重复 POST 会涨内存——" +
  "那是配置边界问题，不是这一列端点该加的窗口。";

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
  "POST /api/marketing/confirm": {
    reason:
      `${RATE_LIMIT_GAP_MARKER}，不是判定为无需窗口。**怎么关：#136 正在补按 IP 的滑窗，` +
      "那条合并之后本条会被 `RATE_LIMIT_STALE` 报出来，届时删掉这两行**——这正是留着这条判据的目的。" +
      "现状是：凭 URL / 表单里的一次性 token 改订阅状态，token 由服务端随机生成、不可猜测，" +
      "重放同一个 token 只会得到同一状态（幂等）；剩下的暴露是拿着一个未消费 token 的人可以反复打它刷错误回执。",
  },
  "POST /api/marketing/unsubscribe": {
    reason:
      `${RATE_LIMIT_GAP_MARKER}，与 confirm 同一形态、同一个 PR 关：**#136 补按 IP 的滑窗，` +
      "合并后这条转成 `RATE_LIMIT_STALE`，删掉即可**。" +
      "退订链接的 POST，一次性 token、幂等改写状态。",
  },

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
      `${RATE_LIMIT_GAP_MARKER}，不是判定为无需窗口。**它是探针端点**：负载均衡、Docker \`HEALTHCHECK\` ` +
      "与 `check:production-smoke` 都要打它，按 IP 的滑窗会把监控自己读成 429，所以「加窗口」" +
      "在这条上不是免费的。但它每次请求都会用 anon 身份打一次 `profiles limit(1)` 的可达性探测" +
      "（超时 3s），也就是说无凭据的重复调用会把成本按次数转嫁给 Supabase——" +
      "现在没有任何东西拦住这件事。关掉它的判据不是加窗口，而是把 DB 探测结果按秒缓存、" +
      "并把「探针」与「对外可见的健康端点」分开；这属于新的一条工作项，不在这次改动里顺手做。",
  },
  "GET /api/og": {
    reason:
      `${RATE_LIMIT_GAP_MARKER}，不是判定为无需窗口。**参数侧的伤害已经收住**：\`title\` 截到 80 字符、` +
      "`category` 截到 40，控制字符先剥掉（防 Satori 渲染异常）。但每个请求都会真的跑一次" +
      "图片合成，是纯 CPU 放大面，而它挂在 `<meta og:image>` 上、天然要能被陌生人请求到，" +
      "所以「按会话限频」这种现成形态对它不成立。关掉它的判据是先按参数做缓存" +
      "（同一 title/category 只合成一次），缓存之后剩下的才是窗口该管的部分。",
  },
};

/**
 * 限流台账核对。`handlers` 来自与 C11 同一次解析（`collectRouteHandlers`），
 * `ledger` 可注入以便单测覆盖每一种偏差形态。
 */
export function auditRateLimits(
  handlers: readonly RouteHandlerFact[],
  ledger: Readonly<Record<string, RateLimitEntry>> = RATE_LIMIT_LEDGER,
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

  issues.push(...auditRateLimitLedger(ledger));
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

/** 台账自身的一致性（与调用图无关的那一半）：标了缺口却没写关法的，红。 */
export function auditRateLimitLedger(
  ledger: Readonly<Record<string, RateLimitEntry>> = RATE_LIMIT_LEDGER,
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
  }
  return issues;
}
