/**
 * 云端迁移状态探测的 IO 层（判定在 `src/lib/db/migration-status.ts`，由 Vitest 覆盖）。
 *
 * 用法：
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/check-migration-status.js
 *   node scripts/check-migration-status.js --project-ref … --token … [--json] [--expect-applied 034]
 *
 * 退出码：
 *   0  本仓库登记的迁移**全部**已在云端 applied
 *   1  发现差集（有迁移未 applied，或云端有本地不认识的迁移）
 *   2  用法错误，或**读不到实况**（缺凭据 / 网络失败 / API 换形状）
 *
 * 为什么 2 而不是 1：读不到云端不是「一致」，也不是「未应用」，是「不知道」。
 * 把它压成 0 会让这条检查在没配凭据的环境里长期假绿。
 *
 * 默认只读：只发一个 `GET /v1/projects/{ref}/database/migrations`
 * （operation `v1ListMigrationHistory`，「List applied migration versions」）。
 * 不跑 SQL、不 push——**它替代不了 `supabase db push`**，也不解锁 B04
 * （那条要执行多语句演练 SQL）。
 * 唯一的写通道是 `--fix-version-shape --apply`：把云端以时间戳形状落库的
 * 迁移版本号订正回 manifest 序号（Management API 应用迁移的已知副作用，
 * 2026-10-24 之前靠人手工 UPDATE），默认 dry-run、按迁移文件名匹配、对不上不动。
 *
 * 为什么不用 `supabase migration list --linked`：那条**不要数据库密码**，
 * 但需要一个交互式登录态；在没有 TTY 的机器上它会挂在登录提示上
 * （2026-10-12 本机实测两次，无输出、需手动终止）。而 CI 里已经有
 * `SUPABASE_ACCESS_TOKEN` 与 `SUPABASE_PROJECT_REF`，直接打 API 就能答。
 * 顺带一提：supabase CLI **不是本仓库的依赖**，所以 CI 里本来也跑不了它。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectMigrationStatus,
  parseAppliedMigrations,
  parseManifestEntries,
  parseManifestVersions,
  planVersionShapeFix,
} from "../../src/lib/db/migration-status.ts";
import { resolveProjectRef } from "../../src/lib/supabase-project-ref.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST_PATH = "supabase/migration-manifest.json";
export const DEFAULT_API_BASE = "https://api.supabase.com/v1";
/**
 * 这些 code 的含义都是「此刻不构成证据」，所以归退出码 2（未知），不是 1（漂移）。
 * `MIGRATION_EXPECTED_NOT_IN_REPO` 也在其中：点名的版本号在仓库里根本不存在时，
 * 那条断言无法求值——把它算成「通过」是最坏的失败方式，算成「漂移」则会把
 * 「你写错了版本号」误报成「云端缺迁移」。
 */
const UNKNOWN_CODES = new Set([
  "MIGRATION_LIVE_UNREADABLE",
  "MIGRATION_MANIFEST_UNREADABLE",
  "MIGRATION_LIVE_EMPTY",
  "MIGRATION_EXPECTED_NOT_IN_REPO",
  "MIGRATION_VERSION_SHAPE_MISMATCH",
]);

/** 带值 flag：flag 名 → 选项名与取值方式。 */
const VALUE_FLAGS = {
  "--project-ref": { option: "projectRef", kind: "string" },
  "--token": { option: "token", kind: "string" },
  "--api-base": { option: "apiBase", kind: "string" },
  "--timeout-ms": { option: "timeoutMs", kind: "number" },
  "--expect-applied": { option: "expectApplied", kind: "list" },
};
/** 无值 flag：出现即为真。 */
const BOOLEAN_FLAGS = {
  "--help": "help",
  "-h": "help",
  "--json": "json",
  "--fix-version-shape": "fixVersionShape",
  "--apply": "apply",
};

/**
 * 各取值方式的实现。返回字符串表示这个 flag 用法不对（错误文案）。
 * 拆成表而不是写一串 if：`parseArgs` 的分支复杂度已经贴着 ESLint 上限，
 * 而「再加一种 flag」不该让那个函数继续长胖。
 */
const READERS = {
  string: (options, name, raw) => {
    options[name] = raw ?? "";
    return null;
  },
  number: (options, name, raw) => {
    options[name] = Number(raw);
    return null;
  },
  // 可重复传：`--expect-applied 034 --expect-applied 035`
  list: (options, name, raw, flag) => {
    if (raw === undefined) return `${flag} 需要一个值`;
    options[name].push(raw);
    return null;
  },
};

function assignOption(options, flag, raw) {
  const spec = Object.hasOwn(VALUE_FLAGS, flag) ? VALUE_FLAGS[flag] : null;
  if (spec === null) return `未知参数：${flag}`;
  return READERS[spec.kind](options, spec.option, raw, flag);
}

export function parseArgs(argv, env = process.env) {
  const args = argv.filter((arg) => arg !== "--");
  const options = {
    projectRef: env.SUPABASE_PROJECT_REF || "",
    token: env.SUPABASE_ACCESS_TOKEN || "",
    apiBase: env.SUPABASE_API_BASE || DEFAULT_API_BASE,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "",
    json: false,
    fixVersionShape: false,
    apply: false,
    timeoutMs: 15_000,
    expectApplied: [],
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const boolean = Object.hasOwn(BOOLEAN_FLAGS, token) ? BOOLEAN_FLAGS[token] : null;
    if (boolean !== null) {
      options[boolean] = true;
      continue;
    }
    const error = assignOption(options, token, args[(index += 1)]);
    if (error !== null) return { error };
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    return { error: "--timeout-ms 需要一个正整数" };
  }
  return { options };
}

/**
 * 拉取云端已应用的迁移列表。
 *
 * 返回 `{ payload }` 或 `{ error }`——**不返回 `[]` 表示「一条都没应用」**：
 * 那种写法会把「token 不对」显示成「线上迁移全丢了」。
 */
export async function fetchAppliedMigrations(options) {
  const ref = resolveProjectRef(options.projectRef, options.supabaseUrl);
  if (!ref) {
    return {
      error:
        "不知道要查哪个项目：需要 SUPABASE_PROJECT_REF，或一个 `<ref>.supabase.co` 形态的 URL" +
        "（`--project-ref` / `SUPABASE_URL`）",
    };
  }
  if (!options.token) {
    return { error: "缺少 SUPABASE_ACCESS_TOKEN（Management API 令牌，`sbp_` 开头）" };
  }
  let endpoint;
  try {
    endpoint = new URL(
      `${String(options.apiBase).replace(/\/+$/, "")}/projects/${encodeURIComponent(ref)}/database/migrations`,
    );
  } catch {
    return { error: `API 地址无法解析：${options.apiBase}` };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${options.token}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      // 只带状态码与短文本，绝不回显请求头：令牌不能进日志。
      return { error: `HTTP ${response.status} ${response.statusText}` };
    }
    return { payload: await response.json() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 执行一条订正 SQL。写端点 `POST /v1/projects/{ref}/database/query`，
 * 与 `scripts/lib/cloud-sql-probe-check.js` 同一封装口径：
 * 只带状态码与短文本、绝不回显请求头（令牌不能进日志）。
 */
export async function executeFixStatement(options, sql) {
  const ref = resolveProjectRef(options.projectRef, options.supabaseUrl);
  if (!ref) return { ok: false, error: "解析不出 project ref" };
  let endpoint;
  try {
    endpoint = new URL(
      `${String(options.apiBase).replace(/\/+$/, "")}/projects/${encodeURIComponent(ref)}/database/query`,
    );
  } catch {
    return { ok: false, error: `API 地址无法解析：${options.apiBase}` };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: sql }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      return { ok: false, error: `HTTP ${response.status} ${response.statusText} ${detail}` };
    }
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** 订正一条 `schema_migrations.version` 的 SQL。唯一出处，计划打印与执行共用。 */
export function fixStatement(fix) {
  const from = fix.fromRaw.replaceAll("'", "''");
  const to = fix.toVersion.replaceAll("'", "''");
  return `update supabase_migrations.schema_migrations set version = '${to}' where version = '${from}';`;
}

/**
 * 版本号形状订正流程（`--fix-version-shape`）。
 *
 * 背景：用 Management API 应用迁移时 `schema_migrations.version` 落 14 位时间戳
 * 形态，与 manifest 的序号不匹配，判定层把它读成「本地不认识的迁移」——
 * 2026-10-24 之前每次都要人手工 UPDATE。本流程把那次的手工活固化下来：
 * 默认 dry-run 只打印计划；`--apply` 才真正写，写完复跑一次探测给最终结论。
 * 计划由判定层 `planVersionShapeFix` 生成：**按迁移文件名匹配，对不上就不动**。
 */
export async function runVersionShapeFix(options, repoRoot = REPO_ROOT) {
  const manifestFile = path.join(repoRoot, MANIFEST_PATH);
  if (!fs.existsSync(manifestFile)) {
    console.error(`❌ 找不到 ${MANIFEST_PATH}——先跑 pnpm update:migrations-manifest`);
    return 2;
  }
  const entries = parseManifestEntries(fs.readFileSync(manifestFile, "utf8"));
  if (entries === null) {
    console.error("❌ 读不出 manifest 的版本号与文件名——比对基准缺失，不做任何订正");
    return 2;
  }

  const fetched = await fetchAppliedMigrations(options);
  if (fetched.error) {
    console.error(`❌ 读不到云端迁移状态：${fetched.error}`);
    return 2;
  }
  const applied = parseAppliedMigrations(fetched.payload);
  if (applied === null) {
    console.error("❌ 云端响应形状不认识——不基于读不到的实况做订正");
    return 2;
  }

  const plan = planVersionShapeFix(applied, entries);
  for (const entry of plan.unmapped) {
    console.log(`⚠️ 不动 ${entry.raw}${entry.name ? `（name=${entry.name}）` : ""}：对不上仓库任何一条迁移`);
  }
  if (plan.updates.length === 0) {
    console.log(plan.unmapped.length > 0 ? "⚠️ 有对不上的行，但没有可安全订正的——见上方清单" : "✅ 没有需要订正的版本号形状");
    return runMigrationStatusCheck(options, repoRoot);
  }
  for (const fix of plan.updates) {
    console.log(`计划：${fix.fromRaw} → ${fix.toVersion}（${fix.matchedBy}）`);
    console.log(`  ${fixStatement(fix)}`);
  }
  if (!options.apply) {
    console.log(`dry-run：以上 ${plan.updates.length} 条**未写入**。确认无误后加 --apply 执行。`);
    return 0;
  }
  for (const fix of plan.updates) {
    const result = await executeFixStatement(options, fixStatement(fix));
    if (!result.ok) {
      console.error(`❌ 订正失败（${fix.fromRaw}）：${result.error}——后续条目未执行，复跑本命令继续`);
      return 2;
    }
    console.log(`✅ 已订正 ${fix.fromRaw} → ${fix.toVersion}`);
  }
  console.log("复跑探测核对最终状态：");
  return runMigrationStatusCheck(options, repoRoot);
}

/** 人读输出。抽出去是因为 `runMigrationStatusCheck` 的分支复杂度贴着 ESLint 上限。 */
function printReport(report, options) {
  for (const issue of report.issues) {
    console.log(`${UNKNOWN_CODES.has(issue.code) ? "⚠️" : "❌"} [${issue.code}] ${issue.message}`);
  }
  if (report.issues.length > 0) return;
  const scope = options.expectApplied.length > 0 ? `点名的 ${options.expectApplied.length} 条` : "全部";
  console.log(
    `✅ ${scope}迁移均已在云端 applied：本仓库 ${report.stats.declared} 条 / ` +
      `云端 ${report.stats.applied} 条（最高 ${report.stats.highestApplied ?? "未知"}）`,
  );
}

/** 跑一次探测并打印结果，返回进程退出码。 */
export async function runMigrationStatusCheck(options, repoRoot = REPO_ROOT) {
  const manifestFile = path.join(repoRoot, MANIFEST_PATH);
  let manifestVersions = null;
  if (fs.existsSync(manifestFile)) {
    manifestVersions = parseManifestVersions(fs.readFileSync(manifestFile, "utf8"));
  } else {
    console.error(`❌ 找不到 ${MANIFEST_PATH}——先跑 pnpm update:migrations-manifest`);
  }

  const fetched = await fetchAppliedMigrations(options);
  if (fetched.error) console.error(`❌ 读不到云端迁移状态：${fetched.error}`);

  const report = inspectMigrationStatus(
    manifestVersions,
    fetched.error ? null : parseAppliedMigrations(fetched.payload),
    options.expectApplied,
  );

  if (options.json) {
    console.log(JSON.stringify({ ...report, error: fetched.error ?? null }, null, 2));
  } else {
    printReport(report, options);
  }

  // 「未知」优先于「漂移」：断言本身无法求值时，报告里的差集不可信。
  // 缺凭据与读不到 manifest 已经在 report 里以 `*_UNREADABLE` 出现，所以这里只看 code。
  if (report.issues.some((issue) => UNKNOWN_CODES.has(issue.code))) return 2;
  return report.issues.length > 0 ? 1 : 0;
}


const HELP = [
  "用法：node scripts/check-migration-status.js [选项]",
  "",
  "  --project-ref <ref>      Supabase 项目 ref（默认取 SUPABASE_PROJECT_REF，",
  "                           其次从 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL 推断）",
  "  --token <sbp_…>          Management API 令牌（默认取 SUPABASE_ACCESS_TOKEN；不会打印）",
  "  --api-base <url>         Management API 根地址（默认 https://api.supabase.com/v1）",
  "  --expect-applied <ver>   只断言点名的版本号必须已 applied（可重复传）",
  "  --json                   机器可读输出",
  "  --timeout-ms <n>         探测超时（默认 15000）",
  "",
  "  --fix-version-shape      订正模式：云端迁移行以时间戳形状落库（Management API 应用",
  "                           迁移的副作用）时，按迁移文件名把它映射回 manifest 序号。",
  "                           默认 dry-run 只打印计划；加 --apply 才写库，写完复跑探测。",
  "  --apply                  与 --fix-version-shape 连用：真正执行订正",
  "",
  "默认只读：只发一个 GET /v1/projects/{ref}/database/migrations，不跑 SQL、不 push。",
  "--fix-version-shape --apply 会发 POST /database/query 执行 UPDATE——",
  "只动按文件名能对上 manifest 的行，对不上的一律不动。",
  "它不解锁 B04：那条要的是执行多语句演练 SQL，本探测只管「应用了哪些版本」。",
  "退出码：0 一致 / 1 发现差集 / 2 用法错误或读不到实况（未知不算通过）",
].join("\n");

/** 解析参数、跑探测并返回退出码。 */
export async function runCli(argv, repoRoot = REPO_ROOT) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`❌ ${parsed.error}`);
    console.error(HELP);
    return 2;
  }
  if (parsed.options.help) {
    console.log(HELP);
    return 0;
  }
  if (parsed.options.fixVersionShape) return runVersionShapeFix(parsed.options, repoRoot);
  return runMigrationStatusCheck(parsed.options, repoRoot);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
