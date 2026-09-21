/**
 * 账户删除时的受管对象清理（A10）
 *
 * 头像与项目封面是**公开可读**的对象。删号只删数据库行的话，
 * 这个人上传过的图片会继续留在 bucket 里，而且 `upload_objects.owner_id` 在 031 之前
 * 会随账户级联消失——连「这里有个对象没人认领」的线索都没了。
 * 033 把外键改成 `on delete set null` 并提供 `list_user_objects_for_erasure()`，
 * 于是这里可以做到：删号前把该用户上传、且已经没有任何业务行引用的对象真的删掉。
 *
 * 两条边界是刻意的：
 *   - **被引用的对象一律保留**：他替团队上传的封面在别人页面上还亮着，
 *     删一个人的账户不该把团队页面弄坏；
 *   - **provider 删除失败不阻塞删号**：账户删除是用户的权利，不能因为 OSS 抖动就做不到。
 *     失败的行保持 `active`（删号后 `owner_id` 变 null），因此仍可被
 *     `find_orphan_upload_objects()` / `pnpm audit:storage-orphans` 发现并补删，
 *     不会变成看不见的泄露。
 */
import { logger } from "@/lib/logger";
import { listObjectsForErasure, markUploadObjectDeleted } from "@/lib/repositories/upload-objects";
import { cleanupStorageObject } from "@/lib/storage";

export interface ObjectErasureSummary {
  /** 已从 provider 删除并标记为 deleted 的对象数。 */
  removed: number;
  /** 仍被业务行引用而保留的对象数。 */
  retained: number;
  /** 删除或回写失败的对象键——这些就是需要补删的孤儿。 */
  failed: string[];
}

/** 删号前清理该用户独占的受管对象；调用方负责授权（会话 + 确认短语）。 */
export async function removeUnreferencedUserObjects(userId: string): Promise<ObjectErasureSummary> {
  const objects = await listObjectsForErasure(userId);
  const summary: ObjectErasureSummary = { removed: 0, retained: 0, failed: [] };

  for (const object of objects) {
    if (object.referenced) {
      summary.retained += 1;
      continue;
    }

    const removed = await cleanupStorageObject(object.objectKey, {
      operation: "account-erasure",
      resourceId: userId,
    });
    if (!removed) {
      summary.failed.push(object.objectKey);
      continue;
    }

    try {
      await markUploadObjectDeleted(object.bucket, object.objectKey);
      summary.removed += 1;
    } catch (error) {
      // 对象已删除但元数据没标记：仍会出现在孤儿清单里，属于可发现的偏差
      summary.failed.push(object.objectKey);
      logger.error(
        "account erasure metadata mark failed",
        { operation: "account-erasure", resourceId: userId, key: object.objectKey },
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  return summary;
}
