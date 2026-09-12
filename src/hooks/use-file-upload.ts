"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createUploadRequest,
  type UploadFileRequest,
  type UploadRequestHandle,
} from "@/lib/uploads/client";
import type { ActionResult } from "@/lib/types/action-result";

type UploadInput = Omit<UploadFileRequest, "onProgress">;

export function useFileUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const activeRequest = useRef<UploadRequestHandle | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeRequest.current?.cancel();
    };
  }, []);

  const updateProgress = useCallback((next: number) => {
    if (mounted.current) setProgress(next);
  }, []);

  const upload = useCallback(
    async (input: UploadInput): Promise<ActionResult<{ url: string }>> => {
      if (mounted.current) {
        setUploading(true);
        setProgress(0);
      }
      const request = createUploadRequest({ ...input, onProgress: updateProgress });
      activeRequest.current = request;
      const result = await request.promise;
      if (activeRequest.current === request) activeRequest.current = null;
      if (mounted.current) {
        setUploading(false);
        if (result.ok) setProgress(100);
      }
      return result;
    },
    [updateProgress],
  );

  const cancel = useCallback(() => activeRequest.current?.cancel(), []);

  return { uploading, progress, upload, cancel };
}
