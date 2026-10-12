/**
 * 把源码里的注释抹成等长空白，**保留换行与字符串字面量**。
 *
 * 为什么单独成一个模块：门禁类的判定普遍要「扫源码文本」，而注释不是代码。
 * 两处已经各自付过学费：
 *   - `src/lib/i18n/translation-usage.ts`：注释里写 `const t = useTranslations("a")`
 *     这种示例是本仓库文档的常态，扫进去就是假红；
 *   - `src/lib/security/admin-client-boundary.ts`：授权证据（trust evidence）原先拿**原始文本**
 *     做子串匹配，于是一句注释就能满足一条安全门禁——那是**假绿**，比假红更贵。
 * 同一个需求在两个领域里各长出来一份实现，就说明它不属于任何一个领域。
 *
 * 保留换行是因为行号常常是调用方的输出之一（抹掉换行会让报错指错行）。
 * 字符串字面量整体保留、并且**优先于**注释匹配：单遍 alternation 里字符串在前，
 * 于是字符串里的 `//` 与块注释起止符不会被误当注释（那些字符出现在引号内时是无辜的）。
 * 模板字面量同样整体当字符串处理（不扫它内部）。
 */
export function stripComments(content: string): string {
  const TOKEN_RE =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g;
  return content.replace(TOKEN_RE, (match, str) => (str ? match : match.replace(/[^\n]/g, " ")));
}
