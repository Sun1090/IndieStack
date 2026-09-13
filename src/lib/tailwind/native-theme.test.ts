/**
 * Tailwind v4 原生主题门禁单测（G01）。
 * 覆盖 `pnpm check:tailwind` 依赖的全部规则，避免门禁规则悄悄失效或用注释绕过。
 */
import { describe, it, expect } from "vitest";
import {
  auditTailwindNative,
  findRenamedUtilities,
  findUntokenedKeyframes,
  formatTailwindNativeIssues,
  RENAMED_UTILITIES,
  stripCssComments,
  type TailwindNativeSnapshot,
} from "./native-theme";

const THEME_CSS = `@import "tailwindcss";

@theme inline {
  --color-background: hsl(var(--background));
  --animate-accordion-down: accordion-down 0.2s ease-out;
  --animate-progress-indeterminate: progress-indeterminate 1.5s ease-in-out infinite;

  @keyframes accordion-down {
    from { height: 0; }
    to { height: var(--radix-accordion-content-height); }
  }
  @keyframes progress-indeterminate {
    0% { transform: translateX(-100%); }
  }
}

@utility container {
  margin-inline: auto;
}
`;

function snapshot(overrides: Partial<TailwindNativeSnapshot> = {}): TailwindNativeSnapshot {
  return {
    configFiles: [],
    cssFiles: [{ path: "src/app/globals.css", content: THEME_CSS }],
    sourceFiles: [],
    excludedFiles: [],
    dependencies: ["next", "tailwindcss"],
    ...overrides,
  };
}

const codes = (input: TailwindNativeSnapshot) => auditTailwindNative(input).errors.map((e) => e.code);

describe("auditTailwindNative()", () => {
  it("合规仓库零错误零告警", () => {
    const report = auditTailwindNative(snapshot());
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("存在 tailwind.config.* 即失败（ADR-013 已移除 JS 配置）", () => {
    const report = auditTailwindNative(snapshot({ configFiles: ["tailwind.config.ts"] }));
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ code: "TW_CONFIG_FILE_PRESENT", path: "tailwind.config.ts" });
  });

  it("@config 指令失败，但注释里的 @config 不算", () => {
    const commented = snapshot({
      cssFiles: [{ path: "src/app/globals.css", content: `/* 已移除 @config 桥接 */\n${THEME_CSS}` }],
    });
    expect(codes(commented)).toEqual([]);

    const real = snapshot({
      cssFiles: [{ path: "src/app/globals.css", content: `@config "../../tailwind.config.ts";\n${THEME_CSS}` }],
    });
    expect(codes(real)).toContain("TW_CONFIG_DIRECTIVE");
  });

  it("tailwindcss-animate 依赖回归即失败", () => {
    const report = auditTailwindNative(snapshot({ dependencies: ["tailwindcss", "tailwindcss-animate"] }));
    expect(report.errors[0]).toMatchObject({ code: "TW_ANIMATE_PLUGIN_DEP", path: "package.json" });
  });

  it("缺少 @theme 块失败", () => {
    const report = auditTailwindNative(
      snapshot({ cssFiles: [{ path: "src/app/globals.css", content: "@import \"tailwindcss\";\n" }] }),
    );
    expect(report.errors.map((e) => e.code)).toEqual(["TW_THEME_MISSING"]);
  });

  it("未被 --animate-* 认领的 @keyframes 失败并给出行号", () => {
    const report = auditTailwindNative(
      snapshot({
        cssFiles: [
          {
            path: "src/app/globals.css",
            content: `${THEME_CSS}\n@keyframes navprogress {\n  0% { transform: translateX(-100%); }\n}\n`,
          },
        ],
      }),
    );
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe("TW_KEYFRAME_UNTOKENED");
    expect(report.errors[0].line).toBe(THEME_CSS.split("\n").length + 1);
  });

  it("应用层 animate-[...] 任意值绕过 token 即失败", () => {
    const report = auditTailwindNative(
      snapshot({
        sourceFiles: [
          { path: "src/components/layout/nav.tsx", content: 'const a = "animate-[navprogress_1s_linear_infinite]";\n' },
        ],
      }),
    );
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ code: "TW_ARBITRARY_ANIMATE", line: 1 });
  });

  it("应用层 v3 类名逐条失败", () => {
    const report = auditTailwindNative(
      snapshot({
        sourceFiles: [
          {
            path: "src/app/page.tsx",
            content: [
              'const a = "bg-gradient-to-b from-muted/50";',
              'const b = "outline-none focus:ring-2";',
              'const c = "flex-shrink-0 flex-grow overflow-ellipsis";',
              'const d = "decoration-slice decoration-clone";',
            ].join("\n"),
          },
        ],
      }),
    );
    expect(report.errors.map((e) => e.line)).toEqual([1, 2, 3, 3, 3, 4, 4]);
    expect(report.errors.every((e) => e.code === "TW_RENAMED_UTILITY")).toBe(true);
    expect(report.errors[0].message).toContain("bg-linear-to-*");
    expect(report.errors[1].message).toContain("outline-hidden");
  });

  it("上游 shadcn 基元的 v3 类名只算一条非阻断告警", () => {
    const report = auditTailwindNative(
      snapshot({
        excludedFiles: [
          { path: "src/components/ui/button.tsx", content: 'const a = "focus-visible:outline-none";' },
          { path: "src/components/ui/input.tsx", content: 'const a = "focus-visible:outline-none flex-shrink-0";' },
        ],
      }),
    );
    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0].message).toContain("3 处");
  });
});

describe("findUntokenedKeyframes()", () => {
  it("token 名字必须整词匹配，前缀相同不算认领", () => {
    const css = `@theme {
      --animate-spin: spin 1s linear infinite;
      @keyframes spin-slow { to { rotate: 360deg; } }
    }`;
    expect(findUntokenedKeyframes(css).map((k) => k.name)).toEqual(["spin-slow"]);
  });

  it("同一 token 可以认领多个 keyframes 名以外的引用", () => {
    const css = `@theme {
      --animate-a: pulse 1s infinite;
      @keyframes pulse { 50% { opacity: .5; } }
    }`;
    expect(findUntokenedKeyframes(css)).toEqual([]);
  });
});

describe("findRenamedUtilities()", () => {
  it("边界：带变体前缀命中，前缀/后缀粘连不命中", () => {
    expect(findRenamedUtilities('"hover:outline-none"').map((h) => h.name)).toEqual(["outline-none"]);
    expect(findRenamedUtilities('"myoutline-none outline-noneish outline-none-2"')).toEqual([]);
  });

  it("flex-shrink-0 只命中一次（不会被 flex-shrink 规则二次命中）", () => {
    expect(findRenamedUtilities('"flex-shrink-0"').map((h) => h.replacement)).toEqual(["shrink-0"]);
  });

  it("每条规则都带 replacement 与 note，便于错误信息直接给出改法", () => {
    for (const rule of RENAMED_UTILITIES) {
      expect(rule.replacement.length).toBeGreaterThan(0);
      expect(rule.note.length).toBeGreaterThan(0);
    }
  });
});

describe("stripCssComments()", () => {
  it("注释替换为空白且保留行号", () => {
    const css = "a{}\n/* @config\n@keyframes ghost */\nb{}";
    const stripped = stripCssComments(css);
    expect(stripped).not.toContain("@config");
    expect(stripped).not.toContain("ghost");
    expect(stripped.split("\n")).toHaveLength(css.split("\n").length);
  });
});

describe("formatTailwindNativeIssues()", () => {
  it("每条问题带 code/path/line", () => {
    const text = formatTailwindNativeIssues("error", [
      { code: "TW_THEME_MISSING", path: "src/app/globals.css", line: 1, message: "缺主题" },
    ]);
    expect(text).toBe("❌ [TW_THEME_MISSING] src/app/globals.css:1 缺主题");
  });
});
