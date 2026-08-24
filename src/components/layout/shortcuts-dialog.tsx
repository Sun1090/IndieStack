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
      if (e.key === "?" && !/input|textarea|select/i.test((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setOpen(true);
      }
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
