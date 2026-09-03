/**
 * 联系表单校验（B10：由 actions/contact 内联 schema 抽取，单测见 contact.test.ts）
 */
import { z } from "zod";

export const contactSchema = z.object({
  name: z.string().trim().min(1, "nameRequired").max(100),
  email: z.string().trim().email("emailInvalid").max(200),
  subject: z.string().trim().min(1, "subjectRequired").max(200),
  message: z.string().trim().min(1, "messageRequired").max(5000),
});

export type ContactInput = z.infer<typeof contactSchema>;
