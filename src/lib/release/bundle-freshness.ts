/**
 * 构建产物新鲜度判定（纯函数，无 IO）。
 *
 * 背景：`check:bundle` 与 `check:perf` 只读 `.next/static`，谁调用谁负责构建。
 * 调用方一旦不构建（或构建失败被管道吞掉），它们量到的就是上一次成功的产物，
 * 于是「绿」代表的是一个已经不存在的构建树——2026-09-24 实测过一次：源码里有
 * 硬语法错误，`pnpm check:bundle` 仍然退出 0 并打印「Bundle 体积在基线范围内」。
 *
 * 本模块只做一件事：把「源码比产物新」这个可判定的部分抽出来，让调用方在量之前
 * 先确认自己量的确实是当前源码的产物。
 *
 * 只判「源码比产物新」，不判产物是否完整：半截构建要靠构建退出码透传来拦，
 * 用最新文件的时间戳做基准也判不出来。
 */

/** 一次 `fs.stat` 的结果里本模块关心的两个字段。 */
export interface FileStamp {
  /** 相对仓库根的路径，只用于报告。 */
  path: string;
  /** `fs.Stats.mtimeMs`。 */
  mtimeMs: number;
}

/** 取时间戳最新的一个；空集合返回 null，由调用方决定「无从比较」怎么处理。 */
export function newestStamp(files: readonly FileStamp[]): FileStamp | null {
  let newest: FileStamp | null = null;
  for (const file of files) {
    if (!Number.isFinite(file.mtimeMs)) continue;
    if (newest === null || file.mtimeMs > newest.mtimeMs) newest = file;
  }
  return newest;
}

/**
 * 返回所有晚于 `buildMtimeMs` 的源码路径（即构建时还没看到这些内容，产物已过期）。
 *
 * 时间戳相等不算过期：构建过程本身可能读到与产物同一秒写入的文件。
 */
export function sourcesNewerThan(
  sources: readonly FileStamp[],
  buildMtimeMs: number,
): string[] {
  if (!Number.isFinite(buildMtimeMs)) return [];
  return sources
    .filter((file) => Number.isFinite(file.mtimeMs) && file.mtimeMs > buildMtimeMs)
    .map((file) => file.path)
    .sort();
}
