"use client";

/**
 * 快捷键帮助对话框（? 键唤起）
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** 这些控件里输入 "?" 是文本，不应该弹出快捷键帮助 */
const TEXT_INPUT_TAGS = /^(input|textarea|select)$/i;

const SHORTCUTS = [
  { keys: ["⌘", "K"], desc: "commandPalette" },
  { keys: ["?"], desc: "shortcutsHelp" },
  { keys: ["Esc"], desc: "closeDialog" },
];

export function ShortcutsDialog() {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "?") return;
      // 带修饰键的组合（⌘? / Ctrl+? / Alt+?）属于其它快捷键，不弹帮助
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // 表单控件、contenteditable 与 role=textbox（命令面板输入框）里输入的是文本
      if (TEXT_INPUT_TAGS.test(target.tagName)) return;
      if (target.isContentEditable || target.closest('[role="textbox"]')) return;
      e.preventDefault();
      setOpen(true);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          ⌘ shortcuts
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("shortcuts.desc")}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {SHORTCUTS.map((s) => (
            <li key={s.desc} className="flex items-center justify-between text-sm">
              <span>{t(`shortcuts.${s.desc}`)}</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">
                {s.keys.join(" + ")}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
