/**
 * ConfirmDialog 确认对话框组件
 * ======================
 *
 * 封装 shadcn/ui Dialog，提供统一的确认操作交互。
 * 支持异步操作、加载状态、自定义文案和危险操作样式。
 *
 * 使用方式：
 *   const [open, setOpen] = useState(false)
 *   <ConfirmDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="确认删除？"
 *     description="此操作不可撤销，确定要删除这个项目吗？"
 *     onConfirm={async () => { await deleteProject(id) }}
 *   >
 *     <Button variant="destructive">删除项目</Button>
 *   </ConfirmDialog>
 */

"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface ConfirmDialogProps {
  /** 对话框打开状态 */
  open?: boolean;
  /** 打开状态变更回调 */
  onOpenChange?: (open: boolean) => void;
  /** 触发对话框的元素（可选，默认使用 children 作为 trigger） */
  trigger?: React.ReactNode;
  /** 子元素将作为 trigger（如果未提供单独的 trigger prop） */
  children?: React.ReactNode;
  /** 对话框标题 */
  title: string;
  /** 对话框描述 */
  description?: string;
  /** 确认按钮文本（默认：确认） */
  confirmText?: string;
  /** 取消按钮文本（默认：取消） */
  cancelText?: string;
  /** 确认按钮变体（默认：destructive） */
  variant?: "default" | "destructive";
  /** 确认回调（支持异步） */
  onConfirm: () => void | Promise<void>;
  /** 取消回调（可选） */
  onCancel?: () => void;
}

export function ConfirmDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  trigger,
  children,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  variant = "destructive",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // 受控或非受控
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (controlledOnOpenChange ?? (() => {})) : setInternalOpen;

  async function handleConfirm() {
    setIsLoading(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setIsLoading(false);
    }
  }

  function handleCancel() {
    onCancel?.();
    setOpen(false);
  }

  const triggerElement = trigger ?? children;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerElement && <DialogTrigger asChild>{triggerElement}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
            {cancelText}
          </Button>
          <Button variant={variant} onClick={handleConfirm} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
