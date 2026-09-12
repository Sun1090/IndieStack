"use client";

import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

interface UploadProgressProps {
  value: number;
  label: string;
  cancelLabel: string;
  onCancel: () => void;
}

export function UploadProgress({ value, label, cancelLabel, onCancel }: UploadProgressProps) {
  return (
    <div className="w-full space-y-1.5">
      <div className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
        <span>{label}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
      <Progress value={value} aria-label={label} />
    </div>
  );
}
