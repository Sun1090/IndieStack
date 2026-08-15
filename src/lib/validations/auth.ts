/**
 * 认证表单验证规则
 * 使用 Zod 定义登录、注册、密码重置等表单的校验规则
 */
import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("invalidEmail"),
  password: z.string().min(6, "passwordMin6"),
});

export const registerSchema = z
  .object({
    email: z.string().email("invalidEmail"),
    password: z.string().min(8, "passwordMin8"),
    confirmPassword: z.string(),
    fullName: z.string().min(1, "fullNameRequired").max(100),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "passwordsDoNotMatch",
    path: ["confirmPassword"],
  });

export const forgotPasswordSchema = z.object({
  email: z.string().email("invalidEmail"),
});

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "passwordMin8"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "passwordsDoNotMatch",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
