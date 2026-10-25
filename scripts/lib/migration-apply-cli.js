/**
 * 云端迁移应用的 IO 层（判定在 `src/lib/db/migration-apply.ts`，由 Vitest 覆盖）。
 *
 * 用法：
 *   node scripts/apply-migration.js --version 036                          # dry-run，只打印计划
 *   SUPABASE_ACCESS_TOKEN=… node scripts/apply-migration.js --version 036 --apply
 *
 * 退出码：0 计划可行或应用成功 / 1 云端报告差集（复跑探测） / 2 用法错误或校验失败。
 *
 * 为什么不用 `supabase db push`：CLI 在没有交互式登录态的机器上会挂在
 * 交互登录上（2026-10-12 本机实测两次）。本脚本走 Management API 的
 * `POST /v1/projects/{ref}/database/query`，凭据与 `ops:migration-status` /
 * `ops:cloud-sql-probe` 同一套（`SUPABASE_ACCESS_TOKEN`）。
 *
 * 与 `check-migration-status.js --fix-version-shape` 的关系：本脚本从根上
 * 用序号形状落迁移历史，让形状坑不再产生；订正模式只负责清历史遗留。
 *
 * **它是写工具，不是门禁**：不放在任何 CI / 自动流程里，只能人显式
 * 带 `--apply` 触发——执行什么由 manifest 的 SHA-256 锁定，何时执行由人决定。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMigrationApplyPlan } from "../../src/lib/db/migration-apply.ts";
import {
  normalizeMigrationVersion,
  parseAppliedMigrations,
  parseManifestEntries,
} from "../../src/lib/db/migration-status.ts";
import { readEnvSources } from "./env-sources.js";
import { resolveProjectRef } from "../../src/lib/supabase-project-ref.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST_PATH = "supabase/migration-manifest.json";
export const DEFAULT_API_BASE = "https://api.supabase.com/v1";

const VALUE_FLAGS = {
  "--version": { option: "version", kind: "string" },
  "--project-ref": { option: "projectRef", kind: "string" },
  "--token": { option: "token", kind: "string" },
  "--api-base": { option: "apiBase", kind: "string" },
  "--timeout-ms": { option: "timeoutMs", kind: "number" },
};
const BOOLEAN_FLAGS = { "--help": "help", "-h": "help", "--apply": "apply" };

/** 单个 flag 的应用逻辑。拆出来是因为 parseArgs 的分支复杂度贴着 ESLint 上限。 */
function applyFlag(options, flag, raw) {
  const boolean = Object.hasOwn(BOOLEAN_FLAGS, flag) ? BOOLEAN_FLAGS[flag] : null;
  if (boolean !== null) {
    options[boolean] = true;
    return null;
  }
  const spec = Object.hasOwn(VALUE_FLAGS, flag) ? VALUE_FLAGS[flag] : null;
  if (spec === null) return `未知参数：${flag}`;
  if (raw === undefined) return `${flag} 需要一个值`;
  options[spec.option] = spec.kind === "number" ? Number(raw) : raw;
  return null;
}

export function parseArgs(argv, env = process.env) {
  const args = argv.filter((arg) => arg !== "--");
  const options = {
    version: "",
    projectRef: env.SUPABASE_PROJECT_REF || "",
    token: env.SUPABASE_ACCESS_TOKEN || "",
    apiBase: env.SUPABASE_API_BASE || DEFAULT_API_BASE,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "",
    apply: false,
    timeoutMs: 30_000,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const error = applyFlag(options, args[index], args[(index += 1)]);
    if (error !== null) return { error };
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    return { error: "--timeout-ms 需要一个正整数" };
  }
  return { options };
}

/** Management API 请求。只带状态码与短文本，绝不回显请求头：令牌不能进日志。 */
export async function postQuery(options, sql) {
  const ref = resolveProjectRef(options.projectRef, options.supabaseUrl);
  if (!ref) return { ok: false, error: "解析不出 project ref（--project-ref / SUPABASE_PROJECT_REF）" };
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

/** 复用探测的 GET（同凭据同端点家族），用于执行前查重与执行后复核。 */
async function fetchAppliedMigrations(options) {
  const ref = resolveProjectRef(options.projectRef, options.supabaseUrl);
  if (!ref) return { error: "解析不出 project ref" };
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
    if (!response.ok) return { error: `HTTP ${response.status} ${response.statusText}` };
    return { payload: await response.json() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** 读 manifest 与目标迁移文件。文件缺失返回 fileText=null，由判定层拒。 */
function loadInputs(repoRoot, version) {
  const manifestFile = path.join(repoRoot, MANIFEST_PATH);
  if (!fs.existsSync(manifestFile)) return { error: `❌ 找不到 ${MANIFEST_PATH}——先跑 pnpm update:migrations-manifest` };
  const entries = parseManifestEntries(fs.readFileSync(manifestFile, "utf8"));
  if (entries === null) return { error: "❌ 读不出 manifest——比对基准缺失，不做任何应用" };
  const entry = entries.find(
    (candidate) => normalizeMigrationVersion(candidate.version) === normalizeMigrationVersion(version),
  );
  let fileText = null;
  if (entry && typeof entry.fileName === "string") {
    const migrationFile = path.join(repoRoot, "supabase/migrations", entry.fileName);
    if (fs.existsSync(migrationFile)) fileText = fs.readFileSync(migrationFile, "utf8");
  }
  return { entries, fileText };
}

/** 拉云端已应用列表并解析。读不到返回 { error }（未知不算通过）。 */
async function fetchCloudApplied(options) {
  const fetched = await fetchAppliedMigrations(options);
  if (fetched.error) return { error: `❌ 读不到云端迁移状态：${fetched.error}` };
  const applied = parseAppliedMigrations(fetched.payload);
  if (applied === null) return { error: "❌ 云端响应形状不认识——读不到实况不能应用（未知不算通过）" };
  return { applied };
}

/** 打印计划（dry-run 与 apply 共用同一份文字）。 */
function printPlan(plan) {
  console.log(`目标：${plan.fileName}（版本 ${plan.version}，SHA-256 ${plan.sha256.slice(0, 12)}… 与 manifest 一致）`);
  console.log(`步骤 1：执行迁移体（${plan.applySql.split(";").length - 1} 个分号边界，只作参考——执行的是整个文件）`);
  console.log("步骤 2：按序号形状落迁移历史：");
  console.log(`  ${plan.historyInsertSql.slice(0, 160)}…`);
}

/** 执行计划的两条 SQL 并复核。返回退出码。 */
async function executePlan(options, plan) {
  const appliedResult = await postQuery(options, plan.applySql);
  if (!appliedResult.ok) {
    console.error(`❌ 迁移体执行失败：${appliedResult.error}`);
    console.error("   迁移体可能只执行了一部分（该端点失败即中止在出错语句）——先查实况再决定重试方式");
    return 2;
  }
  console.log("✅ 迁移体已执行");

  const historyResult = await postQuery(options, plan.historyInsertSql);
  if (!historyResult.ok) {
    console.error(`❌ 迁移历史写入失败：${historyResult.error}`);
    console.error("   **迁移体已经生效但 schema_migrations 缺行**——探测会把它报成 MIGRATION_NOT_APPLIED。");
    console.error("   补救：手工执行下面的 INSERT（或修复后复跑 --apply，第 1 步会因重复而报错、第 2 步仍需手工）：");
    console.log(plan.historyInsertSql);
    return 2;
  }
  console.log(`✅ 迁移历史已按序号形状落库（version=${plan.version}, name=${plan.fileName.replace(/\.sql$/i, "")}）`);

  const verify = await fetchAppliedMigrations(options);
  const verifyApplied = verify.error ? null : parseAppliedMigrations(verify.payload);
  if (
    verifyApplied !== null &&
    verifyApplied.some((row) => row.version !== null && row.version === normalizeMigrationVersion(plan.version))
  ) {
    console.log(`✅ 复核通过：云端迁移历史里已有 ${plan.version}`);
    console.log("最终一致性以 pnpm ops:migration-status 为准。");
    return 0;
  }
  console.error("⚠️ 复核未确认（读不到实况或历史行还没可见）——跑 pnpm ops:migration-status 人工核对");
  return 2;
}

export async function runMigrationApply(options, repoRoot = REPO_ROOT) {
  if (!options.version) {
    console.error("❌ 需要 --version <序号>（如 --version 036）");
    return 2;
  }
  const inputs = loadInputs(repoRoot, options.version);
  if (inputs.error) {
    console.error(inputs.error);
    return 2;
  }
  const cloud = await fetchCloudApplied(options);
  if (cloud.error) {
    console.error(cloud.error);
    return 2;
  }

  const result = buildMigrationApplyPlan({
    version: options.version,
    manifestEntries: inputs.entries,
    fileText: inputs.fileText,
    applied: cloud.applied,
    normalize: normalizeMigrationVersion,
  });
  if ("block" in result) {
    console.error(`❌ [${result.block.code}] ${result.block.message}`);
    return 2;
  }
  const { plan } = result;
  printPlan(plan);
  if (!options.apply) {
    console.log("dry-run：未发出任何写请求。确认无误后加 --apply 执行。");
    return 0;
  }
  if (!options.token) {
    console.error("❌ 缺少 SUPABASE_ACCESS_TOKEN——--apply 需要凭据");
    return 2;
  }
  return executePlan(options, plan);
}

const HELP = [
  "用法：node scripts/apply-migration.js --version <序号> [选项]",
  "",
  "  --version <ver>          要应用的迁移版本号（manifest 序号，如 036；必填）",
  "  --project-ref <ref>      Supabase 项目 ref（默认取 SUPABASE_PROJECT_REF）",
  "  --token <sbp_…>          Management API 令牌（默认取 SUPABASE_ACCESS_TOKEN；不会打印）",
  "  --api-base <url>         Management API 根地址（默认 https://api.supabase.com/v1）",
  "  --timeout-ms <n>         请求超时（默认 30000）",
  "  --apply                  真正执行；缺省 dry-run 只打印计划",
  "",
  "流程：SHA-256 与 manifest 核对 → 已 applied 拒绝重放 → 执行迁移体 →",
  "按序号形状落迁移历史（version=序号、name=文件名，从根上避免时间戳形状坑）→ GET 复核。",
  "它是写工具，不是门禁：不在任何 CI / 自动流程里，只能人显式带 --apply 触发。",
  "退出码：0 成功 / 1 云端差集（复跑探测所得） / 2 用法错误或校验失败",
].join("\n");

export async function runCli(argv, repoRoot = REPO_ROOT) {
  // 同 ops:migration-status：取数在调用层合并 env 文件，parseArgs 保持纯解析。
  const parsed = parseArgs(argv, readEnvSources(repoRoot));
  if (parsed.error) {
    console.error(`❌ ${parsed.error}`);
    console.error(HELP);
    return 2;
  }
  if (parsed.options.help) {
    console.log(HELP);
    return 0;
  }
  return runMigrationApply(parsed.options, repoRoot);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
