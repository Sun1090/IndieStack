/**
 * 客户端产物里「服务端专用变量名」不该出现的判据。
 *
 * **它补的是源码规则的一个盲区**：`check:security` 的 `inspectClientModules` 判的是
 * 「`"use client"` 模块里有没有直接读 `process.env.<服务端专用名>`」，于是它看得见
 * `const k = process.env.STRIPE_SECRET_KEY` 写在客户端组件里，**看不见**这条：
 * 客户端组件 → import 一个共享 helper → helper 里读 `process.env.STRIPE_SECRET_KEY`。
 * 那种间接路径在前者眼里完全合规，而 `NEXT_PUBLIC_*` 之外的变量一旦被客户端图碰到，
 * 构建期就会把**值**内联进产物——那一刻它在服务端也不再是秘密。
 *
 * **为什么按「名字」判而不是按「值」**：值依赖某次构建时那台机器上真的配了什么，
 * CI 上通常什么都没有，于是那条门禁在 CI 上永远绿——一条永远绿的门禁比没有门禁更糟
 * （本仓库为此付过学费：`query-error-channel` 的 `QUERY_ERROR_CHANNEL_PARSE`）。
 * 变量名是**源码里就存在**的常量，与环境无关，所以判据在任何机器上都成立。
 *
 * **实测基线（2026-09-29，真实生产构建）**：客户端产物里这 12 个名字一个都不出现，
 * 而且 `process.env.` 这个形态**一次都没出现**（全部在构建期折成字面量）——
 * 也就是说这条规则今天有 0 个命中，而它的失败模式是**具体的**：
 * 有人让客户端图碰到任何一个服务端专用变量，名字就会随值一起进产物。
 *
 * **失败封闭那一半**：一条客户端脚本都没扫到时返回 `CLIENT_ARTIFACT_NOT_SCANNED`
 * 而不是空数组——「没扫到」和「干净」长得一模一样。
 */

import { SERVER_ONLY_ENV_NAMES as SECURITY_SERVER_ONLY_NAMES } from "../security/security-config.ts";

/**
 * 服务端专用变量名**从判定侧那份清单直接拿**，不在这里重抄一遍。
 *
 * 两个理由，第二个是实测逼出来的：
 * 1. 两份清单迟早会分叉，而「产物侧漏了一个名字」是那种**没人会发现**的分叉；
 * 2. 重抄一份会让 `pnpm check:supabase-security` 报
 *    「client module references service-role admin access」——**本模块只是逐字列出
 *    这些名字以便扫描它们**，一个字节的值都没读。这与 `check:tailwind` 那次是同一个形状：
 *    **门禁被自己必须枚举的数据绊倒**。改法不是加豁免，而是别把那份数据抄第二遍。
 */
export const SERVER_ONLY_NAMES = SECURITY_SERVER_ONLY_NAMES;


export type ClientEnvIssueCode =
  | "CLIENT_ARTIFACT_NOT_SCANNED"
  | "CLIENT_ARTIFACT_SERVER_ONLY_NAME";

export interface ClientEnvFile {
  path: string;
  content: string;
}

export interface ClientEnvIssue {
  code: ClientEnvIssueCode;
  subject: string;
  message: string;
}

export interface ClientEnvOptions {
  /** 可注入的变量名清单，便于单测不依赖真实常量。 */
  names?: readonly string[];
  /** 分母下限：扫到的文件数少于此值视为「没扫到」。 */
  minFiles?: number;
}

function issue(code: ClientEnvIssueCode, subject: string, message: string): ClientEnvIssue {
  return { code, subject, message };
}

export function inspectClientArtifactEnvNames(
  files: readonly ClientEnvFile[],
  options: ClientEnvOptions = {},
): ClientEnvIssue[] {
  const names = options.names ?? SERVER_ONLY_NAMES;
  const minFiles = options.minFiles ?? 1;

  if (files.length < minFiles) {
    return [
      issue(
        "CLIENT_ARTIFACT_NOT_SCANNED",
        "client-artifact",
        `只扫到 ${files.length} 个客户端产物文件（下限 ${minFiles}）：空扫描不是干净扫描`,
      ),
    ];
  }

  const issues: ClientEnvIssue[] = [];
  for (const file of files) {
    const found = names.filter((name) => file.content.includes(name));
    if (found.length > 0) {
      issues.push(
        issue(
          "CLIENT_ARTIFACT_SERVER_ONLY_NAME",
          file.path,
          `客户端产物里出现了服务端专用变量名：${found.join("、")}。` +
            "非 NEXT_PUBLIC_ 的变量一旦被客户端图碰到，构建期就会把值内联进去——" +
            "注意这可能是**间接**的：客户端模块 import 了一个读该变量的共享 helper，" +
            "而 check:security 的源码规则只判「客户端模块自己读」。",
        ),
      );
    }
  }
  return issues;
}

export function formatClientEnvIssues(issues: readonly ClientEnvIssue[]): string {
  return issues.map((item) => `  - [${item.code}] ${item.subject}: ${item.message}`).join("\n");
}
