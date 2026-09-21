/**
 * `src/lib/ui/a11y-rules.ts` 纯规则单测（D10）。
 *
 * 这一组测试的首要目的不是覆盖率，而是**证明门禁会失败**：上一版 `check:a11y` 的图标按钮规则
 * 结构上不可能命中（外层要求 children 无 2+ 字母串、内层又要求组件名存在），
 * 于是连续多轮打印「✅ 无未标注的图标按钮」，而仓库里躺着 3 个真实违规。
 * 因此下面每条反例都直接取自真实 JSX 写法。
 */
import { describe, expect, it } from "vitest";
import {
  ACCESSIBLE_NAME_ATTR,
  SR_ONLY_CLASS,
  auditA11y,
  formatA11yIssues,
  hasAccessibleName,
  isIconOnly,
  stripIcons,
  unwrapContainers,
  type A11yAuditFile,
  type A11yRuleCode,
} from "./a11y-rules";

function file(path: string, content: string): A11yAuditFile {
  return { path, content };
}

function codesOf(content: string, fileName = "src/app/x/page.tsx"): A11yRuleCode[] {
  return auditA11y([file(fileName, content)]).errors.map((issue) => issue.code);
}

describe("纯图标按钮判定", () => {
  it("只含自闭合图标组件 → 纯图标按钮", () => {
    expect(isIconOnly("\n  <MoreHorizontal className=\"h-4 w-4\" />\n")).toBe(true);
  });

  it("图标 + 翻译插值 → 有可见文本，不算纯图标按钮", () => {
    // 真实反例：api-keys-page 的「新建密钥」按钮。把它算成违规只会逼人加豁免。
    expect(isIconOnly('<Plus className="me-2 h-4 w-4" /> {t("apiKeys.create")}')).toBe(false);
  });

  it("图标 + 字面文本 → 不算纯图标按钮", () => {
    expect(isIconOnly('<LogOut className="me-2 h-4 w-4" /> 全部登出')).toBe(false);
  });

  it("asChild 下图标被 Link 包裹 → 剥掉透传容器后仍判为纯图标按钮", () => {
    expect(isIconOnly('\n<Link href={ROUTES.dashboardTeam}>\n  <ArrowLeft className="h-5 w-5" />\n</Link>\n')).toBe(
      true,
    );
  });

  it("成对书写的内联 svg（带 path）整体算一个图标", () => {
    const children = '\n<svg className="h-4 w-4" viewBox="0 0 24 24">\n  <path d="M12 2 L2 22" />\n</svg>\n';
    expect(isIconOnly(children)).toBe(true);
    expect(stripIcons(children).icons).toBe(1);
  });

  it("没有任何图标 → 不算纯图标按钮", () => {
    expect(isIconOnly("提交")).toBe(false);
    expect(isIconOnly("   ")).toBe(false);
  });

  it("透传容器里只剩空白 → 判空；容器内含文本 → 不判空", () => {
    expect(unwrapContainers("<span> </span>").trim()).toBe("");
    expect(isIconOnly('<span className="sr-only">刷新</span><RefreshCw className="h-4 w-4" />')).toBe(false);
  });
});

describe("可访问名称判定", () => {
  it("aria-label / aria-labelledby / title 都算已标注", () => {
    expect(hasAccessibleName('aria-label={tc("back")}', "<ArrowLeft />")).toBe(true);
    expect(hasAccessibleName('aria-labelledby="team-menu"', "")).toBe(true);
    expect(hasAccessibleName("title=\"更多\"", "<More />")).toBe(true);
  });

  it("sr-only 文本算可访问名称", () => {
    expect(hasAccessibleName('className="sr-only"', '<span className="sr-only">菜单</span>')).toBe(true);
    expect(SR_ONLY_CLASS.test("visually-hidden")).toBe(false);
  });

  it("后代上的 aria-label 同样有效（asChild 时标注常写在 Link 上）", () => {
    expect(hasAccessibleName("variant=\"ghost\"", '<Link aria-label="返回"> <ArrowLeft /> </Link>')).toBe(true);
    expect(ACCESSIBLE_NAME_ATTR.test("aria-describedby=\"x\"")).toBe(false);
  });
});

describe("审计：必须能失败", () => {
  it("无标注的图标按钮 → ICON_BUTTON_UNLABELED", () => {
    expect(
      codesOf(
        "<Button variant=\"ghost\" size=\"icon\" className=\"h-8 w-8\">\n  <MoreHorizontal className=\"h-4 w-4\" />\n</Button>",
      ),
    ).toEqual(["ICON_BUTTON_UNLABELED"]);
  });

  it("补上 aria-label 后 → 通过（真实修复写法）", () => {
    expect(
      codesOf(
        "<Button variant=\"ghost\" size=\"icon\" aria-label={t(\"users.changeRole\")}>\n  <MoreHorizontal className=\"h-4 w-4\" />\n</Button>",
      ),
    ).toEqual([]);
  });

  it("asChild + Link 包裹的返回按钮同样被审计到", () => {
    expect(
      codesOf(
        "<Button variant=\"ghost\" size=\"icon\" asChild>\n  <Link href={ROUTES.dashboardTeam}>\n    <ArrowLeft className=\"h-5 w-5\" />\n  </Link>\n</Button>",
      ),
    ).toEqual(["ICON_BUTTON_UNLABELED"]);
  });

  it("原生 <button> 与开标签含多层花括号时不被截断", () => {
    expect(codesOf("<button className={cn(\"h-8 w-8\", sizeMap[k])}>\n  <XIcon className=\"h-4\" />\n</button>")).toEqual([
      "ICON_BUTTON_UNLABELED",
    ]);
  });

  it("属性里出现 > 与三元表达式不会误判为有文本", () => {
    expect(
      codesOf(
        "<Button className={cn(\"data-[state=open]:bg-accent\", className)} variant={k === \"free\" ? \"outline\" : \"default\"}>\n  <ChevronDown className=\"h-4 w-4\" />\n</Button>",
      ),
    ).toEqual(["ICON_BUTTON_UNLABELED"]);
  });

  it("<img> 缺 alt → IMG_MISSING_ALT；显式 alt=\"\" 视为装饰图通过", () => {
    expect(codesOf('<div><img src="/a.png" /></div>')).toEqual(["IMG_MISSING_ALT"]);
    expect(codesOf('<div><img src="/a.png" alt="" /></div>')).toEqual([]);
    expect(codesOf('<div><img src="/a.png" alt={t("hero.image")} /></div>')).toEqual([]);
  });

  it("报告带行号，便于直接定位", () => {
    const report = auditA11y([
      file("src/app/x.tsx", "const a = 1;\n<Button>\n  <MoreHorizontal />\n</Button>\n"),
    ]);
    expect(report.errors[0].line).toBe(2);
    expect(formatA11yIssues(report.errors)).toContain("src/app/x.tsx:2");
  });

  it("没有输入文件时失败封闭，而不是打印通过", () => {
    const report = auditA11y([]);
    expect(report.errors.map((i) => i.code)).toEqual(["A11Y_NO_FILES"]);
  });

  it("计数器非零才算真的扫过（空转保护）", () => {
    const report = auditA11y([
      file(
        "src/app/y.tsx",
        '<Button aria-label="x"><MoreHorizontal /></Button><Button><Plus /> {t("c")}</Button>',
      ),
    ]);
    expect(report.stats).toEqual({ scannedFiles: 1, buttons: 2, iconOnlyButtons: 1, images: 0 });
    expect(report.errors).toEqual([]);
  });
});
