/**
 * 留言列表加载骨架（G04：统一走共享 PageLoading）
 */

import { PageLoading } from "@/components/shared/page-loading";

export default function Loading() {
  return <PageLoading variant="list" rows={5} />;
}
