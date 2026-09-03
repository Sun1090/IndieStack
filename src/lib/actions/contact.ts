/**
 * 联系表单服务端操作
 * 匿名可提交（限频 + Zod 校验），消息写入 contact_messages 表
 */
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { contactSchema } from "@/lib/validations/contact";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";

export async function submitContactMessage(formData: FormData): Promise<ActionResult> {
  const limits = await rateLimit.check(new Request("http://local/contact"));
  if (!limits.allowed) return fail("rateLimited");

  const parsed = contactSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    subject: formData.get("subject"),
    message: formData.get("message"),
  });

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "invalidInput");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("contact_messages").insert(parsed.data);

  if (error) {
    console.error("[submitContactMessage] 写入失败:", error);
    return fail("databaseError");
  }

  // 管理端提示有新消息（revalidate 对匿名页面无实际作用，保留语义）
  revalidatePath("/dashboard/admin");
  return ok();
}
