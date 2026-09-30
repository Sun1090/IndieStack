/**
 * 客户端构建产物的三格性能断言（图表懒加载 / CSS 体积 / sourcemap 泄漏）。
 *
 * 背景：这三条原先内联在 `scripts/check-perf.js` 里，而它们是本仓库**最不该内联**的一段——
 * 三格里有**两格从来没响过**：
 *   - sourcemap 那一格只判了三种泄漏形态里的一种（内联 data URI 会把整份原始源码塞进那个
 *     JS/CSS 文件，不需要额外请求，而它完全看不见）；
 *   - recharts 那一格在 Turbopack 生产产物里**结构性地不可能命中**——生产产物不内嵌模块路径
 *     字符串，所以「拿包名去搜」这个手法在这里永远搜不到，而它顶着「防懒加载回退」的名字
 *     长期打印「未检测到」。
 *
 * 「它们没响过」这件事没有任何机制会发现，于是 #183 加了 `check:gate-rule-tests`
 * （门禁的判定逻辑必须放在有单测的规则模块里），把 `check:perf` 点名为剩下的 3 条内联门禁之一。
 * 本模块就是那次搬动的落点。**搬动的真实收益不是形式统一**：那两格的问题**都是「判据选错了」**，
 * 而「判据选错」这件事只有把判据写成可测的纯函数才谈得上被反复检查——
 * #182 与 #180 的证据当时是**手跑变异**（在真实产物上注入、确认变红、复原），
 * 那些变异现在变成下面这些用例，**每次跑都在**。
 *
 * 三格的设计取舍（各自的理由都写在对应小节里，不重复）：
 *   1. 判的是「它该不在的地方在不在」，不是「找不找得到」；
 *   2. 一个文件都没扫到时报红（「什么都没在看」与「干净」同形）；
 *   3. 标记消失时报红（压缩器改名 ≠ 图表被删）。
 *
 * 本模块只做判定，不碰文件系统：`exists` 由调用方注入，于是「这条引用能不能解析」
 * 这种原本需要真目录才能验的分支，在单测里是一行数组查找。
 */

/** 产物文件。`path` 相对 `.next/static`；`content` 为 null 表示读不出字节（二进制）。 */
export interface PerfArtifactFile {
  path: string;
  bytes: number;
  content: string | null;
}

export interface PerfAuditInput {
  files: readonly PerfArtifactFile[];
  /** 落地页初始加载的文件（同样相对 `.next/static`）。 */
  rootMainFiles: readonly string[];
  /** 判断一个相对引用是否存在（注入以便单测）。 */
  exists: (candidate: string) => boolean;
  /** CSS 总体积上限（kB）。 */
  cssBudgetKb?: number;
}

export type PerfCode =
  | "NO_ARTIFACTS_SCANNED"
  | "CHART_MARKER_MISSING"
  | "LANDING_PAYLOAD_UNKNOWN"
  | "CHART_INLINED_IN_LANDING"
  | "CSS_BUDGET_EXCEEDED"
  | "SOURCEMAP_FILE"
  | "SOURCEMAP_INLINE"
  | "SOURCEMAP_RESOLVABLE_REF";

export interface PerfIssue {
  code: PerfCode;
  file: string;
  message: string;
}

export interface PerfReport {
  errors: PerfIssue[];
  stats: {
    scannedFiles: number;
    cssKb: number;
    /** 命中图表标记的 chunk。 */
    chartChunks: number;
    landingKb: number;
    landingFiles: number;
  };
}

/**
 * 图表标记：图表组件的**导出符号**，不是包名。
 *
 * 包名 `recharts` 在 Turbopack 生产产物里搜不到（不内嵌模块路径字符串），而导出符号扛得过压缩。
 * 实测它只出现在那两个图表 chunk（360.6kB + 15.2kB），741kB 那个 faker 死 chunk 里没有。
 *
 * **这一格与本仓库的耦合**：改名时会红，而红的意思是「请更新 `CHART_MARKER`」，
 * 不是「出事了」——这个取舍在 #182 里显式记过。
 */
export const CHART_MARKER = "AreaChart";

/** CSS 单文件体积上限（kB），沿用历史阈值。 */
export const CSS_BUDGET_KB = 100;

const RULE_MESSAGES: Record<PerfCode, string> = {
  NO_ARTIFACTS_SCANNED: "静态目录里一条文件都没有：这道断言量不到任何东西，先重新 pnpm build",
  CHART_MARKER_MISSING: `产物里一处都找不到图表标记 \`${CHART_MARKER}\`：这一格量不到任何东西。多半是压缩器/工具链改名了（构建产物里原本就没有 \`recharts\` 这个包名字符串），请更新 CHART_MARKER，而不是把它当成「图表已移除」`,
  LANDING_PAYLOAD_UNKNOWN:
    "落地页初始 payload 未知（build-manifest.json 缺失或 rootMainFiles 为空）：懒加载这一格量不到东西，先重新 pnpm build",
  CHART_INLINED_IN_LANDING:
    "图表代码进了落地页初始 payload（懒加载回退）：有人把 next/dynamic 改回静态 import 了",
  CSS_BUDGET_EXCEEDED: "CSS 总体积超过预算",
  SOURCEMAP_FILE: "静态目录存在 sourcemap 文件",
  SOURCEMAP_INLINE: "sourceMappingURL 是 data URI——原始源码内联在这个产物里",
  SOURCEMAP_RESOLVABLE_REF: "sourceMappingURL 指向确实存在的 map（等于可下载）",
};

function containsMarker(file: PerfArtifactFile, marker: string): boolean {
  return file.content !== null && file.content.includes(marker);
}

function sumKb(files: readonly PerfArtifactFile[]): number {
  return Math.round(files.reduce((total, file) => total + file.bytes, 0) / 102.4) / 10;
}

/** 把相对引用按引用者所在目录解析成产物相对路径。 */
export function resolveRef(fromPath: string, ref: string): string {
  const fromDir = fromPath.split("/").slice(0, -1);
  const out: string[] = [...fromDir];
  for (const part of ref.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/**
 * 三格判定。
 *
 * 1. **分母**：一条文件都没扫到 → 报红。
 * 2. **图表懒加载**：标记必须被命中（否则这一格量不到东西），且**不得**出现在落地页初始
 *    payload 里——判的是「它该不在的地方在不在」，不是「找不找得到」。
 * 3. **CSS 体积**。
 * 4. **sourcemap 三形态**：独立 `.map` 文件 / 内联 data URI / 指向确实存在的 map。
 *    **指向不存在路径的引用刻意不算**——那是第三方库留下的死引用，既不泄漏也不可调试，
 *    按它报红就是一条没人会修的假红。
 */
export function auditPerf(input: PerfAuditInput): PerfReport {
  const errors: PerfIssue[] = [];
  const budget = input.cssBudgetKb ?? CSS_BUDGET_KB;
  const byPath = new Map(input.files.map((file) => [file.path, file]));
  const css = input.files.filter((file) => file.path.endsWith(".css"));
  const cssKb = sumKb(css);
  const landing = input.rootMainFiles
    .map((rel) => byPath.get(rel))
    .filter((file): file is PerfArtifactFile => file !== undefined);
  const landingKb = sumKb(landing);

  if (input.files.length === 0) {
    errors.push({
      code: "NO_ARTIFACTS_SCANNED",
      file: ".next/static",
      message: RULE_MESSAGES.NO_ARTIFACTS_SCANNED,
    });
  }

  const chartChunks = input.files.filter((file) => containsMarker(file, CHART_MARKER));
  if (chartChunks.length === 0) {
    errors.push({
      code: "CHART_MARKER_MISSING",
      file: ".next/static",
      message: RULE_MESSAGES.CHART_MARKER_MISSING,
    });
  } else if (input.rootMainFiles.length === 0) {
    errors.push({
      code: "LANDING_PAYLOAD_UNKNOWN",
      file: ".next/build-manifest.json",
      message: RULE_MESSAGES.LANDING_PAYLOAD_UNKNOWN,
    });
  } else {
    for (const file of landing) {
      if (!containsMarker(file, CHART_MARKER)) continue;
      errors.push({
        code: "CHART_INLINED_IN_LANDING",
        file: file.path,
        message: RULE_MESSAGES.CHART_INLINED_IN_LANDING,
      });
    }
  }

  if (cssKb > budget) {
    errors.push({
      code: "CSS_BUDGET_EXCEEDED",
      file: `${css.length} 个 CSS 文件`,
      message: `${RULE_MESSAGES.CSS_BUDGET_EXCEEDED}（${cssKb}kB > ${budget}kB）`,
    });
  }

  for (const file of input.files) {
    if (file.path.endsWith(".map")) {
      errors.push({ code: "SOURCEMAP_FILE", file: file.path, message: RULE_MESSAGES.SOURCEMAP_FILE });
    }
    if (file.content === null) continue; // 二进制：读不出字节就当作没有标记
    for (const match of file.content.matchAll(/sourceMappingURL=(\S+)/g)) {
      const ref = match[1];
      if (ref.startsWith("data:")) {
        errors.push({
          code: "SOURCEMAP_INLINE",
          file: file.path,
          message: RULE_MESSAGES.SOURCEMAP_INLINE,
        });
        continue;
      }
      const target = resolveRef(file.path, ref);
      if (!input.exists(target)) continue; // 死引用：既不泄漏也不可调试
      errors.push({
        code: "SOURCEMAP_RESOLVABLE_REF",
        file: file.path,
        message: `${RULE_MESSAGES.SOURCEMAP_RESOLVABLE_REF}：${ref}`,
      });
    }
  }

  return {
    errors,
    stats: {
      scannedFiles: input.files.length,
      cssKb,
      chartChunks: chartChunks.length,
      landingKb,
      landingFiles: landing.length,
    },
  };
}

/** 把问题列表格式化成多行文本（供 CLI 与单测断言）。 */
export function formatPerfIssues(issues: readonly PerfIssue[]): string {
  return issues
    .map((issue) => `❌ [${issue.code}] ${issue.file}：${issue.message}`)
    .join("\n");
}

/** 成功时的自述行——把分母一起报出来，让「扫了多少」与「结论」同屏。 */
export function formatPerfSummary(report: PerfReport): string {
  const { scannedFiles, cssKb, chartChunks, landingKb, landingFiles } = report.stats;
  return [
    `✅ 图表仍在懒加载 chunk 里：${chartChunks} 个 chunk（落地页初始 payload ${landingKb}kB / ${landingFiles} 个文件，其中不含图表）`,
    `✅ CSS 总体积 ${cssKb}kB`,
    `✅ 无 sourcemap 泄漏（扫了 ${scannedFiles} 个产物文件）`,
  ].join("\n");
}
