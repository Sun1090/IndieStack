/**
 * 仪表盘错误边界
 * 捕获仪表盘子页面的渲染错误并提供友好的错误提示和重试按钮
 */
"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, RefreshCw } from "lucide-react";
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("仪表盘渲染错误:", error);
  }, [error]);
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <Card className="mx-auto max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>页面出错了</CardTitle>
          <CardDescription>
            仪表盘页面遇到了一个意外错误，请稍后重试。
            {error.digest && (
              <span className="mt-2 block text-xs text-muted-foreground">
                错误编号：{error.digest}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Button onClick={reset} variant="default">
            <RefreshCw className="mr-2 h-4 w-4" />
            重试
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
