# ADR-013: Tailwind v4 原生主题迁移（移除 @config 桥接）

- 状态：accepted
- 日期：2026-09-05
- 关联：v0.4.0 roadmap E01 遗留项（v3→v4 迁移批次）；`docs/adr/adr-005-tailwind-v4.md`

## 背景

v0.3.0 升级 Tailwind 4 时保留了 `@config "../../tailwind.config.ts"` 桥接
（content/darkMode/colors/container/tailwindcss-animate 插件），v0.5.0 E01
要求验证 v4 原生机制可行。

## 决策

1. **主题层全量转 v4 原生**（主题是全局机制，无法按页试点，以"机制可行"为试点目标）：
   - `@theme inline` 映射全部 shadcn 颜色/圆角/accordion keyframes；
     `inline` 修饰使构建期内联引用，运行时仅切换 `:root/.dark` 原始变量（明暗切换不变）。
   - `@custom-variant dark (&:is(.dark *))` 替代 `darkMode: "class"`。
   - `@utility container` 替代 config 的 container（center + padding 2rem + 2xl 1400px）。
2. **动画插件替换**：`tailwindcss-animate`（v3 插件）→ `tw-animate-css`（CSS-only 导入），
   shadcn 组件的 `animate-in/fade-in` 等工具类保持兼容；移除旧插件依赖。
3. **删除 `tailwind.config.ts` 与 `@config`**：content 由 v4 自动源检测覆盖
   （`src/` 下全部源码）；JS 配置不再参与构建。

## 理由

- 消除 JS/CSS 双配置漂移面；v4 原生主题是上游主推路径，`@config` 桥为过渡态。
- `tw-animate-css` 为纯 CSS，避免插件 API 在 v4 下的维护风险。

## 后果

- `tailwind.config.ts` 移除后如需恢复（如按需加插件），走 `@plugin`/`@utility` 的 v4 原生方式。
- 新主题 token 一律在 `@theme inline` 定义，不再新增 JS config。
- E2E 冒烟与生产构建作为回归门禁（CSS 编译失败即构建失败）。
