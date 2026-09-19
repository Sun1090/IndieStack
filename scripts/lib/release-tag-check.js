/**
 * Tag / GitHub Release 自动化门禁实现（J07）。
 *
 * 规则本体在 src/lib/release/release-tag-policy.ts（纯函数，由 vitest 覆盖）；这里负责读取
 * package.json、CHANGELOG.md、release workflow，校验当前标签并在显式要求时写出 Release Notes。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditReleasePolicy,
  formatReleaseTagIssues,
  RELEASE_TAG_CONTRACT,
} from "../../src/lib/release/release-tag-policy.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readText(relativePath, repoRoot) {
  const absolute = path.join(repoRoot, relativePath);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : "";
}

/** 读取发布门禁所需的仓库快照；缺文件时交给纯函数产生可定位的规则码。 */
export function buildReleaseTagSnapshot(repoRoot = REPO_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  return {
    packageVersion: typeof pkg.version === "string" ? pkg.version : "",
    changelog: readText(RELEASE_TAG_CONTRACT.changelogPath, repoRoot),
    workflow: readText(RELEASE_TAG_CONTRACT.workflowPath, repoRoot),
  };
}

/** 解析 CLI 参数；`--tag` 省略时默认使用 package.json 对应标签。 */
export function parseReleaseTagArgs(argv) {
  const options = { tag: undefined, notesOutput: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    const equals = argument.startsWith("--tag=")
      ? ["--tag", argument.slice("--tag=".length)]
      : argument.startsWith("--notes-output=")
        ? ["--notes-output", argument.slice("--notes-output=".length)]
        : null;
    const [option, inlineValue] = equals ?? [argument, undefined];
    if (option !== "--tag" && option !== "--notes-output") {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${option} requires a non-empty value`);
    }
    if (inlineValue === undefined) index += 1;
    if (option === "--tag") options.tag = value;
    else options.notesOutput = value;
  }
  return options;
}

function resolveNotesOutput(repoRoot, notesOutput) {
  const outputPath = path.resolve(repoRoot, notesOutput);
  const relativeOutputPath = path.relative(repoRoot, outputPath);
  if (
    path.isAbsolute(notesOutput) ||
    relativeOutputPath === "" ||
    relativeOutputPath.startsWith(`..${path.sep}`) ||
    relativeOutputPath === ".."
  ) {
    return null;
  }
  return outputPath;
}

function usage() {
  return [
    "Usage: pnpm check:release-tag [--tag vX.Y.Z] [--notes-output FILE]",
    "",
    "Without --tag, the expected tag is derived from package.json (v<version>).",
    "With --notes-output, the checked CHANGELOG section is written as Release Notes.",
  ].join("\n");
}

/** 返回进程退出码：0 表示发布标签与工作流契约有效，1 表示漂移，2 表示参数/IO 错误。 */
export function runReleaseTagCheck(argv = [], repoRoot = REPO_ROOT) {
  let options;
  try {
    options = parseReleaseTagArgs(argv);
  } catch (error) {
    console.error(`❌ 参数错误：${error.message}`);
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  let snapshot;
  try {
    snapshot = buildReleaseTagSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取发布标签快照：${error.message}`);
    return 2;
  }

  const tagName = options.tag ?? `${RELEASE_TAG_CONTRACT.tagPrefix}${snapshot.packageVersion}`;
  const report = auditReleasePolicy(
    {
      tagName,
      packageVersion: snapshot.packageVersion,
      changelog: snapshot.changelog,
    },
    { workflow: snapshot.workflow },
  );
  if (report.issues.length > 0) {
    console.error(`❌ 发布标签校验失败（${report.issues.length} 项）`);
    console.error(formatReleaseTagIssues(report.issues));
    return 1;
  }

  if (options.notesOutput) {
    const outputPath = resolveNotesOutput(repoRoot, options.notesOutput);
    if (!outputPath) {
      console.error("❌ Release Notes 输出必须是仓库内的相对文件路径");
      return 2;
    }
    try {
      fs.writeFileSync(outputPath, report.notes?.body ?? "", { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      console.error(`❌ 无法写入 Release Notes：${error.message}`);
      return 2;
    }
    console.log(`✅ 发布标签校验通过：${tagName}（Release Notes -> ${options.notesOutput}）`);
  } else {
    console.log(`✅ 发布标签校验通过：${tagName}（${report.checks} 条契约断言）`);
  }
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runReleaseTagCheck(process.argv.slice(2));
