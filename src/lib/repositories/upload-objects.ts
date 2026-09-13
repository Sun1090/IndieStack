/**
 * UploadObjects 数据访问层（service_role）
 *
 * `public.upload_objects` 是 H02 引入的上传元数据表：每次对象写入落一行，
 * 替换旧对象或回滚删除时把旧行标记为 `deleted`。因此
 * `status = 'active'` 的行集合就是「数据库认为应该存在的对象」，可用于孤儿巡检。
 *
 * 访问边界：该表 RLS 打开且**没有任何策略**，anon / authenticated 读不到也写不了
 * （迁移 031 同时收回了表级写权限），所以这里必须用 admin 客户端。
 */
import { createAdminClient } from "@/lib/supabase/admin";

/** 一次成功写入的对象元数据；`objectKey` 是 provider 侧的完整键（含租户目录）。 */
export interface UploadObjectRecord {
  bucket: string;
  objectKey: string;
  /** 执行上传的用户；账号删除时元数据随 `auth.users` 级联删除。 */
  ownerId: string;
  byteSize: number;
  contentType: string;
  /** sha256 十六进制，见 `@/lib/uploads/checksum`。 */
  checksum: string;
}

/**
 * 记录（或刷新）一次上传。同一个 `(bucket, object_key)` 只保留一行，
 * 重复写入把状态复位为 `active` 并刷新字节数 / 哈希。
 */
export async function recordUploadObject(record: UploadObjectRecord): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("upload_objects").upsert(
    {
      bucket: record.bucket,
      object_key: record.objectKey,
      owner_id: record.ownerId,
      byte_size: record.byteSize,
      content_type: record.contentType,
      checksum: record.checksum,
      status: "active",
    },
    { onConflict: "bucket,object_key" },
  );
  if (error) throw new Error(error.message);
}

/**
 * 把对象标记为已删除。行不存在时是 no-op（例如上传时元数据写入失败后回滚）；
 * 保留行而不是物理删除，才能区分「从未记录」与「已清理」。
 */
export async function markUploadObjectDeleted(bucket: string, objectKey: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("upload_objects")
    .update({ status: "deleted" })
    .eq("bucket", bucket)
    .eq("object_key", objectKey);
  if (error) throw new Error(error.message);
}
