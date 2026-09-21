/**
 * 键盘快捷键清单（数据，从 `src/components/layout/shortcuts-dialog.tsx` 抽出）。
 *
 * 放在 `.ts` 里是为了让 `pnpm check:dynamic-keys` 能直接 import：帮助弹窗用
 * `t(\`shortcuts.${item.desc}\`)` 渲染说明文案，而 `check:i18n` 按设计只扫静态
 * `t("字面量")`——动态模板会被跳过，所以这条链路的权威取值集合必须能被程序读到，
 * 而不是靠人记得去两份文件里各加一行。
 */

export interface ShortcutItem {
  /** 展示用的按键字形。 */
  keys: readonly string[];
  /** `common.shortcuts.*` 的键名。 */
  desc: string;
}

export const SHORTCUT_ITEMS: readonly ShortcutItem[] = [
  { keys: ["⌘", "K"], desc: "commandPalette" },
  { keys: ["?"], desc: "shortcutsHelp" },
  { keys: ["Esc"], desc: "closeDialog" },
] as const;
