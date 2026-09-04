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

/** 垃圾评分阈值：≥ 此分拒收（保守取值，宁可漏过不可误伤正常咨询） */
export const SPAM_REJECT_SCORE = 50;

/** 常见免费邮箱域（仅用于组合信号加权） */
const FREE_MAIL_DOMAINS = [
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "qq.com",
  "163.com",
  "126.com",
  "sina.com",
  "foxmail.com",
];

export interface SpamScore {
  score: number;
  reasons: string[];
}

/**
 * 启发式垃圾评分（纯函数，E03）。
 * 信号：链接数 / 长重复串 / 全大写率 / 短文带链 / 免费邮箱+多链。
 */
export function scoreSpam(input: { message: string; email: string }): SpamScore {
  const reasons: string[] = [];
  let score = 0;
  const text = input.message;

  const links = text.match(/https?:\/\/|www\./gi)?.length ?? 0;
  if (links > 0) {
    score += Math.min(links, 3) * 15;
    reasons.push(`links:${links}`);
  }

  const longRun = text.match(/(.)\1{9,}/);
  if (longRun) {
    score += 25;
    reasons.push("repeat-run");
  }

  const letters = text.match(/[A-Za-z]/g) ?? [];
  if (letters.length >= 20) {
    const upper = letters.filter((c) => c >= "A" && c <= "Z").length / letters.length;
    if (upper > 0.7) {
      score += 15;
      reasons.push("all-caps");
    }
  }

  if (text.trim().length < 20 && links > 0) {
    score += 20;
    reasons.push("short-with-link");
  }

  const domain = input.email.split("@")[1]?.toLowerCase() ?? "";
  if (FREE_MAIL_DOMAINS.includes(domain) && links >= 2) {
    score += 10;
    reasons.push("free-mail-links");
  }

  return { score, reasons };
}

/** 是否应拒收 */
export function isSpam(input: { message: string; email: string }): boolean {
  return scoreSpam(input).score >= SPAM_REJECT_SCORE;
}
