/**
 * psql 元命令探测器——它存在的理由是**替文档量那个数**，所以它必须量得对。
 *
 * 三条承重用例：
 *  1. 对**仓库正本**给出 6 条并点名 `\gset`——「5 条」那个错的墓碑；
 *  2. 行尾形态单独钉住（漏掉它的那次就是这么漏的）；
 *  3. 字符串字面量与注释里的反斜杠**不算**元命令（否则探测器会自己造出假数）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describePsqlMetaCommands,
  findPsqlMetaCommands,
  unknownBackslashes,
} from "./psql-meta";

const ERASURE = resolve(process.cwd(), "docs/operations/drills/account-erasure.sql");
const RETENTION = resolve(process.cwd(), "docs/operations/drills/retention-cleanup.sql");

describe("findPsqlMetaCommands", () => {
  it("仓库正本：6 条，其中唯一那条 structural 是 \\gset", () => {
    const commands = findPsqlMetaCommands(readFileSync(ERASURE, "utf8"));
    expect(commands).toHaveLength(6);
    expect(commands.map((command) => command.command)).toEqual([
      "set",
      "gset",
      "echo",
      "echo",
      "echo",
      "echo",
    ]);
    const structural = commands.filter((command) => command.category === "structural");
    expect(structural.map((command) => command.command)).toEqual(["gset"]);
  });

  it("**行尾**形态的元命令必须被认出来（「5 条」那次就是只探测行首）", () => {
    const commands = findPsqlMetaCommands("select id from t \\gset p_");
    expect(commands).toHaveLength(1);
    expect(commands[0].command).toBe("gset");
    expect(commands[0].category).toBe("structural");
  });

  it("`\\set ON_ERROR_STOP` 是错误处理；`\\set x 5` 是造变量——按名字分类会混掉", () => {
    const stop = findPsqlMetaCommands("\\set ON_ERROR_STOP on");
    const variable = findPsqlMetaCommands("\\set target 5");
    expect(stop[0].category).toBe("error-handling");
    expect(variable[0].category).toBe("structural");
  });

  it("字符串字面量与注释里的元命令名**不算**数", () => {
    // 这两条必须是**能承重**的形状：第一版写成 `-- docker exec -i psql \\`，
    // 而 `\\` 后面不是字母，正则本来就匹配不上 ⇒ 那条用例**恒过**，
    // 变异「不剥注释」当场存活。真形状是注释里**直接写出一个已知命令名**。
    expect(findPsqlMetaCommands("select '\\echo hi' as note")).toHaveLength(0);
    expect(findPsqlMetaCommands("-- 跑法：先 \\set ON_ERROR_STOP 再 \\gset")).toHaveLength(0);
    // 对照：同一行去掉注释前缀就必须认出来（证明上面那个 0 来自剥注释，不来自匹配失败）
    expect(findPsqlMetaCommands("\\set ON_ERROR_STOP on")).toHaveLength(1);
  });

  it("保留期那份正本是 0 条（对照：不是所有演练都需要转换）", () => {
    expect(findPsqlMetaCommands(readFileSync(RETENTION, "utf8"))).toHaveLength(0);
  });

  it("认不全的反斜杠用法要报出来，不能静默当成 SQL", () => {
    const unknown = unknownBackslashes("select 1 \\notacommand x");
    expect(unknown).toHaveLength(1);
    expect(unknown[0].line).toBe(1);
    // 已知命令不该混进 unknown
    expect(unknownBackslashes("\\echo hi")).toHaveLength(0);
  });

  it("一句话结论自带分类计数，供文档直接引用", () => {
    const summary = describePsqlMetaCommands(findPsqlMetaCommands(readFileSync(ERASURE, "utf8")));
    expect(summary).toBe("6 条（cosmetic 4 / error-handling 1 / structural 1）");
  });
});
