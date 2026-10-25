/**
 * 凭据取数的 IO 侧：**把所有能配的来处合并成一张表**，供 ops 探测统一使用。
 *
 * 为什么需要它（2026-10-25 实测）：`node scripts/*` 不加载 `.env.local`，
 * 只有 Next 运行时加载。于是直接读 `process.env` 的探测会报「缺凭据」，
 * 而那台机器明明配着——这类「没去找」写成「查不了」的错已在本仓库出现过四次，
 * 最近一次让 roadmap 挂着「B03 缺云端凭据」这句与实况相反的登记。
 * 逐个脚本打补丁必然漏，所以共享这一个取数口；判定（占位符怎么算）在
 * `src/lib/env-credentials.ts`，有单测。
 *
 * 规矩与 Next 一致：`process.env` 优先，其次 `.env.local` → `.env.development.local`
 * → `.env.development` → `.env`（`mergeEnvSources` 先到先得，名单按具体→笼统排）。
 * 读不到文件不算错误——探测仍会以「未知」退出码 2 收场，**未知不算通过**。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENV_FILE_NAMES,
  mergeEnvSources,
  parseEnvFileText,
} from "../../src/lib/env-credentials.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * 读一份 env 文件；不存在返回空表。探测不是配置校验器，读错也不炸。
 *
 * @param {string} name
 * @param {string} [repoRoot]
 * @returns {Record<string, string>}
 */
export function readEnvFile(name, repoRoot = REPO_ROOT) {
  try {
    return parseEnvFileText(fs.readFileSync(path.join(repoRoot, name), "utf8"));
  } catch {
    return {};
  }
}

/**
 * 合并后的凭据表。默认含 `process.env`；传 `env: null` 可以只要文件
 * （单测里用它构造「机器上只有 .env.local」这个真实形态）。
 *
 * @param {string} [repoRoot]
 * @param {NodeJS.ProcessEnv | null} [env]
 * @returns {Record<string, string>}
 */
export function readEnvSources(repoRoot = REPO_ROOT, env = process.env) {
  const sources = env === null ? [] : [env];
  return mergeEnvSources([...sources, ...ENV_FILE_NAMES.map((name) => readEnvFile(name, repoRoot))]);
}
