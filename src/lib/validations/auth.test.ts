/**
 * 认证验证规则单元测试
 */
import { describe, it, expect } from "vitest";
import { loginSchema, registerSchema, forgotPasswordSchema } from "./auth";

describe("loginSchema", () => {
  it("should validate valid login data", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "password123",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid email", () => {
    const result = loginSchema.safeParse({
      email: "not-an-email",
      password: "password123",
    });
    expect(result.success).toBe(false);
  });

  it("should reject short password", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "12345",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing fields", () => {
    const result = loginSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("registerSchema", () => {
  it("should validate valid registration", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "password123",
      confirmPassword: "password123",
      fullName: "Test User",
    });
    expect(result.success).toBe(true);
  });

  it("should reject mismatched passwords", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "password123",
      confirmPassword: "different123",
      fullName: "Test User",
    });
    expect(result.success).toBe(false);
  });

  it("should reject short password (min 8)", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "1234567",
      confirmPassword: "1234567",
      fullName: "Test User",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing full name", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "password123",
      confirmPassword: "password123",
      fullName: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("forgotPasswordSchema", () => {
  it("should validate a valid email", () => {
    const result = forgotPasswordSchema.safeParse({
      email: "user@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid email", () => {
    const result = forgotPasswordSchema.safeParse({
      email: "invalid",
    });
    expect(result.success).toBe(false);
  });
});
