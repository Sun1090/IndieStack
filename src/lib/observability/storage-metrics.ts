/**
 * 存储 / 上传指标契约（v0.6.0 E05）
 *
 * 两个层次分开计量，避免用「provider 调用成功率」冒充「用户可见上传成功率」：
 * - `storage.upload.completed`：单个 provider 的对象写入结束（Supabase / OSS），
 *   反映 provider 自身健康度；失败必然抛出，由调用方决定是否回滚。
 * - `upload.request.completed`：一次上传请求的终态（含 provider 调用之后的元数据
 *   回写与回滚），反映用户实际拿到的是成功、失败还是取消。
 *
 * 指标名与维度集中在此，驱动和领域服务只引用常量，避免同名指标在多处各自手写
 * 字面量后悄悄漂移（E04 的类型集合漂移是同类问题）。
 */
import { startMetricTimer } from "@/lib/metrics";

/** provider 侧对象写入结束。维度：provider、outcome。 */
export const STORAGE_UPLOAD_METRIC = "storage.upload.completed";

/** 用户可见的上传请求终态。维度：operation、outcome。 */
export const UPLOAD_REQUEST_METRIC = "upload.request.completed";

export const STORAGE_PROVIDERS = ["supabase", "oss"] as const;
export type StorageProviderName = (typeof STORAGE_PROVIDERS)[number];

export const STORAGE_UPLOAD_OUTCOMES = ["success", "failure"] as const;
export type StorageUploadOutcome = (typeof STORAGE_UPLOAD_OUTCOMES)[number];

/** `cancelled` 单列：用户主动中断不算存储故障，不应计入失败率分子。 */
export const UPLOAD_OUTCOMES = ["success", "failure", "cancelled"] as const;
export type UploadOutcome = (typeof UPLOAD_OUTCOMES)[number];

export const UPLOAD_OPERATIONS = ["avatar-upload", "project-cover-upload"] as const;
export type UploadOperation = (typeof UPLOAD_OPERATIONS)[number];

const OUTCOME_ATTRIBUTE = "outcome";

/** provider 写入计时器：两种驱动共用同一指标名与 outcome 维度。 */
export function storageUploadTimer(provider: StorageProviderName) {
  const timer = startMetricTimer(STORAGE_UPLOAD_METRIC, { provider });
  return {
    end(outcome: StorageUploadOutcome): void {
      timer.end({ [OUTCOME_ATTRIBUTE]: outcome });
    },
  };
}

/** 上传请求终态计时器：同时给出成功率分子/分母与单次耗时。 */
export function uploadRequestTimer(operation: UploadOperation) {
  const timer = startMetricTimer(UPLOAD_REQUEST_METRIC, { operation });
  return {
    end(outcome: UploadOutcome): void {
      timer.end({ [OUTCOME_ATTRIBUTE]: outcome });
    },
  };
}
