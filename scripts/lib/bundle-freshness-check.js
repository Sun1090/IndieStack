/**
 * Bundle 门禁的 IO 层。
 *
 * 判定规则在 `src/lib/release/bundle-freshness.ts`（纯函数、由 vitest 覆盖）；这里负责
 * 读目录、算体积、比对基线，并把「产物是不是当前源码构建出来的」这一步接进来。
 *
 * 为什么新鲜度必须和体积在同一个门禁里判：本门禁只读 `.next/static`，构建由调用方负责。
 * 调用方一旦漏了构建、或构建失败被管道吞掉，它量到的就是上一次成功的产物——
 * 数字看着正常，结论却是假的。2026-09-24 实测过一次：源码里有硬语法错误，
 * `pnpm check:bundle` 仍然退出 0 并打印「Bundle 体积在基线范围内」。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newestStamp, sourcesNewerThan } from "../../src/lib/release/bundle-freshness.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const STATIC_DIR = ".next/static";
export const BASELINE_FILE = ".bundle-baseline";
/** 允许超出基线的比例。 */
export const TOLERANCE = 1.05;
/** 会改变客户端产物的输入目录与根文件；`.bundle-baseline` 由本脚本自己写，不算输入。 */
export const SOURCE_DIRS = ["src", "messages", "public"];
export const SOURCE_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "next.config.ts",
  "tsconfig.json",
  "postcss.config.js",
];

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function walkFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function stampFiles(repoRoot, absolutePaths) {
  const stamps = [];
  for (const full of absolutePaths) {
    let stats;
    try {
      stats = fs.statSync(full);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    stamps.push({ path: toRepoPath(repoRoot, full), mtimeMs: stats.mtimeMs });
  }
  return stamps;
}

/** `.next/static` 里最新文件的时间戳，作为「这次构建发生在何时」。 */
function artifactMtime(repoRoot) {
  const artifact = stampFiles(repoRoot, walkFiles(path.join(repoRoot, STATIC_DIR), []));
  const newest = newestStamp(artifact);
  return newest ? newest.mtimeMs : null;
}

/** 收集判定所需事实：源码时间戳 + 产物时间戳 + 由纯函数给出的过期清单。 */
export function buildFreshnessSnapshot(repoRoot = REPO_ROOT) {
  const candidates = [];
  for (const dir of SOURCE_DIRS) candidates.push(...walkFiles(path.join(repoRoot, dir), []));
  for (const file of SOURCE_FILES) {
    const full = path.join(repoRoot, file);
    if (fs.existsSync(full)) candidates.push(full);
  }
  const sources = stampFiles(repoRoot, candidates);
  const buildMtimeMs = artifactMtime(repoRoot);
  return {
    sources,
    buildMtimeMs,
    stale: buildMtimeMs === null ? [] : sourcesNewerThan(sources, buildMtimeMs),
  };
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

/**
 * 跑一次 bundle 门禁。返回进程退出码。
 *
 * @param repoRoot 仓库根
 * @param options.writeBaseline 基线缺失时是否落盘（首跑建基线）
 */
export function runBundleCheck(repoRoot = REPO_ROOT, { writeBaseline = true } = {}) {
  const staticDir = path.join(repoRoot, STATIC_DIR);
  if (!fs.existsSync(staticDir)) {
    console.error(`❌ 未找到 ${STATIC_DIR}，请先执行 pnpm build`);
    return 1;
  }

  const snapshot = buildFreshnessSnapshot(repoRoot);
  if (snapshot.buildMtimeMs === null) {
    console.error(`❌ ${STATIC_DIR} 下没有任何文件，构建产物不完整；请重新执行 pnpm build`);
    return 1;
  }
  const stale = snapshot.stale;
  if (stale.length > 0) {
    console.error(
      `❌ 构建产物比源码旧：${stale.length} 个输入文件晚于最近一次构建，` +
        `.next/static 量的是上一次构建的体积。请先 pnpm build，再跑本门禁。`,
    );
    for (const file of stale.slice(0, 10)) console.error(`   ${file}`);
    if (stale.length > 10) console.error(`   …其余 ${stale.length - 10} 个`);
    return 1;
  }

  const currentKb = Math.round((dirSize(staticDir) / 1024) * 10) / 10;
  let baseline = null;
  try {
    baseline = Number(fs.readFileSync(path.join(repoRoot, BASELINE_FILE), "utf8").trim());
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (!baseline || Number.isNaN(baseline)) {
    if (!writeBaseline) {
      console.error(`❌ 缺少 ${BASELINE_FILE}，无法比对基线`);
      return 1;
    }
    fs.writeFileSync(path.join(repoRoot, BASELINE_FILE), String(currentKb), { flag: "wx" });
    console.log(`✅ 已建立 bundle 基线: ${currentKb} kB（客户端静态资源总量）`);
    return 0;
  }

  console.log(`Bundle: 当前 ${currentKb} kB / 基线 ${baseline} kB`);
  if (currentKb > baseline * TOLERANCE) {
    console.error(
      `❌ 客户端资源超过基线 ${Math.round((TOLERANCE - 1) * 100)}%。` +
        `如为有意变更（新功能/升级），请同步更新 ${BASELINE_FILE} 文件。`,
    );
    return 1;
  }
  console.log("✅ Bundle 体积在基线范围内");
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runBundleCheck(process.argv[2] ?? REPO_ROOT);
