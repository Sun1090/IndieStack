/**
 * 动态翻译键契约门禁实现（D04 补集）。
 *
 * 规则本体在 src/lib/i18n/dynamic-keys.ts（纯函数，由 vitest 覆盖）；这里负责读消息文件、
 * 扫源码、把结果拼成 snapshot 并给出退出码，方便单测传入临时仓库根构造反例。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditDynamicKeys,
  findDynamicTemplates,
  findStaticKeys,
  flattenLeafKeys,
  formatDynamicKeyIssues,
} from "../../src/lib/i18n/dynamic-keys.ts";
import { NOTIFICATION_TYPES } from "../../src/lib/notifications/types.ts";
import { SHORTCUT_ITEMS } from "../../src/lib/shortcuts.ts";
import { STRENGTH_LABEL_KEYS } from "../../src/lib/password-strength.ts";
import {
  PROFILE_LANGUAGES,
  SUBSCRIPTION_TIERS,
  SYSTEM_ROLES,
  TEAM_ROLES,
} from "../../src/lib/constants.ts";

/**
 * 动态翻译键契约登记表（规则本体见 src/lib/i18n/dynamic-keys.ts）。
 *
 * 每条契约的 `values` 都必须来自**代码里的权威常量**，不能抄消息文件——抄了就成了同义反复，
 * 门禁永远不会失败。`reason` 说明这里为什么非得用动态键，防止后人把它改成静态时顺手删掉契约。
 * 与 `locales-check.js` 里的豁免表同一分层：登记表属于 IO 侧事实，判定属于纯函数侧。
 */
const PRICING_FEATURE_KEYS = [
  ...new Set(Object.values(SUBSCRIPTION_TIERS).flatMap((tier) => [...tier.features])),
];

export const DYNAMIC_KEY_CONTRACTS = [  {
    id: "notification-types",
    keyPrefix: "dashboard.notifications.list.types",
    values: NOTIFICATION_TYPES,
    source: "@/lib/notifications/types#NOTIFICATION_TYPES",
    reason: "通知类型由服务端写入，列表按类型取标签；新增类型必须同时补两种语言的键。",
  },
  {
    id: "admin-user-role-labels",
    keyPrefix: "admin.users.roleLabels",
    values: SYSTEM_ROLES,
    source: "@/lib/constants#SYSTEM_ROLES",
    reason: "用户表按 profiles.role 取值渲染，角色集合变化时标签必须跟上。",
  },
  {
    id: "team-roles",
    keyPrefix: "dashboard.team.list.roles",
    values: TEAM_ROLES,
    source: "@/lib/constants#TEAM_ROLES",
    reason: "成员列表按 team_members.role 取标签。",
  },
  {
    id: "profile-roles",
    keyPrefix: "dashboard.profile.view.roles",
    values: SYSTEM_ROLES,
    source: "@/lib/constants#SYSTEM_ROLES",
    reason: "资料页展示系统角色；页面用 t.has() 兜住数据库里的未知值，但已知集合必须有翻译。",
  },
  {
    id: "profile-languages",
    keyPrefix: "dashboard.profile.view.languages",
    values: PROFILE_LANGUAGES,
    source: "@/lib/constants#PROFILE_LANGUAGES",
    reason: "资料页展示语言偏好（与站点 locale 不是一回事），取值来自偏好枚举。",
  },
  {
    id: "pricing-features",
    keyPrefix: "pricing.features",
    values: PRICING_FEATURE_KEYS,
    source: "@/lib/constants#SUBSCRIPTION_TIERS[*].features",
    reason: "定价卡逐条渲染方案功能，键名与方案定义同源。",
  },
  {
    id: "billing-tier-features",
    keyPrefix: "common.tierFeatures",
    values: PRICING_FEATURE_KEYS,
    source: "@/lib/constants#SUBSCRIPTION_TIERS[*].features",
    reason: "账单页逐条渲染当前方案功能，与定价页共用同一份 features 键名但落在 common 命名空间。",
  },
  {
    id: "shortcut-items",
    keyPrefix: "common.shortcuts",
    values: SHORTCUT_ITEMS.map((item) => item.desc),
    source: "@/lib/shortcuts#SHORTCUT_ITEMS",
    reason: "快捷键帮助逐条渲染说明；同前缀下的 desc / title 是静态兄弟键，由静态引用放行。",
  },
  {
    id: "password-strength-labels",
    keyPrefix: "common.strength",
    values: STRENGTH_LABEL_KEYS,
    source: "@/lib/password-strength#STRENGTH_LABEL_KEYS",
    reason: "强度条按等级取标签（0 级不显示，所以不在集合里）。",
  },
];

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MESSAGES_DIR = "messages";
const SOURCE_DIR = "src";
const SOURCE_EXTENSION = /\.(ts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;

function walk(dir, accumulator, predicate) {
  if (!fs.existsSync(dir)) return accumulator;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, accumulator, predicate);
    else if (predicate(full)) accumulator.push(full);
  }
  return accumulator;
}

/** 读 messages/<locale>/*.json，扁平成 `<命名空间>.<路径>` 叶子键集合。 */
export function buildLeafKeysByLocale(repoRoot = REPO_ROOT) {
  const root = path.join(repoRoot, MESSAGES_DIR);
  const result = {};
  if (!fs.existsSync(root)) return result;
  for (const locale of fs.readdirSync(root)) {
    const dir = path.join(root, locale);
    if (!fs.statSync(dir).isDirectory()) continue;
    const leaves = new Set();
    for (const file of walk(dir, [], (f) => f.endsWith(".json"))) {
      const namespace = path.basename(file, ".json");
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (error) {
        throw new Error(`${namespace}.json 解析失败：${error.message}`);
      }
      for (const key of flattenLeafKeys(parsed, namespace)) leaves.add(key);
    }
    result[locale] = leaves;
  }
  return result;
}

/** 读受扫源码（含 `src/app`，因为动态调用几乎都在页面里）。 */
export function buildSourceFiles(repoRoot = REPO_ROOT) {
  const absolute = walk(
    path.join(repoRoot, SOURCE_DIR),
    [],
    (f) => SOURCE_EXTENSION.test(f) && !TEST_FILE.test(f),
  );
  return absolute.map((full) => ({
    path: path.relative(repoRoot, full).split(path.sep).join("/"),
    content: fs.readFileSync(full, "utf8"),
  }));
}

/** 执行门禁。 */
export function runDynamicKeysCheck(repoRoot = REPO_ROOT, options = {}) {
  const leafKeysByLocale = buildLeafKeysByLocale(repoRoot);
  const sourceFiles = buildSourceFiles(repoRoot);
  const report = auditDynamicKeys({
    contracts: options.contracts ?? DYNAMIC_KEY_CONTRACTS,
    leafKeysByLocale,
    templates: findDynamicTemplates(sourceFiles),
    staticKeys: findStaticKeys(sourceFiles),
  });

  if (options.json !== true) {
    for (const issue of report.issues) console.error(formatDynamicKeyIssues([issue]));
    if (report.issues.length) {
      console.error(`❌ 动态翻译键契约失败：${report.issues.length} 个问题`);
    } else {
      const { contracts, locales, values, templates } = report.stats;
      console.log(
        `✅ 动态翻译键契约通过：${contracts} 个契约 × ${locales} 个 locale、` +
          `${values} 个取值全覆盖；源码中 ${templates} 处动态键模板均已登记`,
      );
    }
  }
  return report;
}

const invokedDirectly =
  process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const asJson = process.argv.includes("--json");
  const report = runDynamicKeysCheck(REPO_ROOT, { json: asJson });
  if (asJson) console.log(JSON.stringify(report, null, 2));
  process.exit(report.issues.length ? 1 : 0);
}
