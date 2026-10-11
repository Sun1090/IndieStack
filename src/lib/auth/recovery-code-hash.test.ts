/**
 * 恢复码哈希的用例（CWE-916 修复）
 *
 * 全部用 `TEST_KDF`（N=2^10）跑，否则一条用例会真花掉几百毫秒——
 * 参数本身的强度不是这里断言的对象，那条由 `RECOVERY_CODE_KDF` 的一致性用例钉住。
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  deriveRecoveryCodeHash,
  parseStoredRecoveryCodeHash,
  verifyRecoveryCodeHash,
  isLegacyRecoveryCodeHash,
  RECOVERY_CODE_KDF,
  TEST_KDF,
} from "./recovery-code-hash";

const CODE = "ABCD2345";
const CODE_DASHED = "ABCD-2345";
const LEGACY = createHash("sha256").update(CODE).digest("hex");

describe("deriveRecoveryCodeHash()", () => {
  it("产出 scrypt 编码且携带自己的参数与盐", async () => {
    const stored = await deriveRecoveryCodeHash(CODE, TEST_KDF);
    const [algo, n, r, p, salt, derived] = stored.split("$");
    expect(algo).toBe("scrypt");
    expect([n, r, p]).toEqual([String(TEST_KDF.n), String(TEST_KDF.r), String(TEST_KDF.p)]);
    expect(salt).toHaveLength(TEST_KDF.saltBytes * 2);
    expect(derived).toHaveLength(TEST_KDF.keyLength * 2);
  });

  it("同一明文两次生成结果不同（每行独立随机盐）", async () => {
    const a = await deriveRecoveryCodeHash(CODE, TEST_KDF);
    const b = await deriveRecoveryCodeHash(CODE, TEST_KDF);
    expect(a).not.toBe(b);
  });

  it("连字符只是展示分组，不影响派生", async () => {
    const stored = await deriveRecoveryCodeHash(CODE, TEST_KDF);
    await expect(verifyRecoveryCodeHash(CODE_DASHED, stored, TEST_KDF)).resolves.toBe(true);
  });
});

describe("verifyRecoveryCodeHash()", () => {
  it("匹配自己派生的哈希", async () => {
    const stored = await deriveRecoveryCodeHash(CODE, TEST_KDF);
    await expect(verifyRecoveryCodeHash(CODE, stored, TEST_KDF)).resolves.toBe(true);
  });

  it("不匹配别的明文", async () => {
    const stored = await deriveRecoveryCodeHash(CODE, TEST_KDF);
    await expect(verifyRecoveryCodeHash("ZZZZ9999", stored, TEST_KDF)).resolves.toBe(false);
  });

  it("存量裸 SHA-256 行仍然可验证（否则会把已有用户锁在门外）", async () => {
    await expect(verifyRecoveryCodeHash(CODE, LEGACY, TEST_KDF)).resolves.toBe(true);
    await expect(verifyRecoveryCodeHash("ZZZZ9999", LEGACY, TEST_KDF)).resolves.toBe(false);
    expect(isLegacyRecoveryCodeHash(LEGACY)).toBe(true);
  });

  it("校验用的是存储行自己记录的参数，而不是当前默认值", async () => {
    // 默认参数以后调整时，已生成的码必须仍可验证。
    const stored = await deriveRecoveryCodeHash(CODE, RECOVERY_CODE_KDF);
    await expect(verifyRecoveryCodeHash(CODE, stored, TEST_KDF)).resolves.toBe(true);
  });

  it("生产默认参数在 derive 与 verify 两侧都跑得通（maxmem 算错会在这里暴露）", async () => {
    // 其余用例几乎都跑 TEST_KDF，于是「默认参数 + 默认 maxmem」这条生产真正走的路径
    // 只在上面那条里被 derive 过一次。而 verify 内部把 scrypt 的错误折叠成 false，
    // 所以「maxmem 给小了」不会报错，只会让**所有**兑换静默失败。断言 true 才能兜住它。
    const stored = await deriveRecoveryCodeHash(CODE);
    expect(stored.startsWith(`scrypt$${RECOVERY_CODE_KDF.n}$`)).toBe(true);
    await expect(verifyRecoveryCodeHash(CODE, stored)).resolves.toBe(true);
    await expect(verifyRecoveryCodeHash("ZZZZ9999", stored)).resolves.toBe(false);
  }, 30_000);

  it("形状不符的存储值一律判否，绝不回退成裸比较", async () => {
    for (const junk of ["", "   ", "scrypt$", "scrypt$a$b$c$d$e", "x".repeat(64), "a".repeat(63)]) {
      await expect(verifyRecoveryCodeHash(CODE, junk, TEST_KDF)).resolves.toBe(false);
    }
  });

  it("被篡改的 N（非 2 的幂）判否", async () => {
    const stored = await deriveRecoveryCodeHash(CODE, TEST_KDF);
    const parts = stored.split("$");
    parts[1] = String(TEST_KDF.n + 1);
    await expect(verifyRecoveryCodeHash(CODE, parts.join("$"), TEST_KDF)).resolves.toBe(false);
  });

  it("派生失败（参数非法到 scrypt 报错）不会抛出到调用方", async () => {
    // p 大到超出 scrypt 的限制：必须判否，而不是让兑换路径 500。
    const stored = await deriveRecoveryCodeHash(CODE, TEST_KDF);
    const parts = stored.split("$");
    parts[3] = "2147483647";
    await expect(verifyRecoveryCodeHash(CODE, parts.join("$"), TEST_KDF)).resolves.toBe(false);
  });
});

describe("parseStoredRecoveryCodeHash()", () => {
  it("解析新格式与存量格式", async () => {
    const stored = await deriveRecoveryCodeHash(CODE, TEST_KDF);
    expect(parseStoredRecoveryCodeHash(stored)).toMatchObject({
      kind: "scrypt",
      n: TEST_KDF.n,
      r: TEST_KDF.r,
      p: TEST_KDF.p,
    });
    expect(parseStoredRecoveryCodeHash(LEGACY)).toEqual({
      kind: "legacySha256",
      derivedHex: LEGACY,
    });
    expect(isLegacyRecoveryCodeHash(stored)).toBe(false);
  });

  it("读不出形状返回 null", () => {
    for (const junk of ["", "nope", "scrypt$1024$1$1$zz$aa", "scrypt$1024$1$1$aa"]) {
      expect(parseStoredRecoveryCodeHash(junk)).toBeNull();
    }
  });
});

describe("RECOVERY_CODE_KDF", () => {
  it("保持在 OWASP 列出的最低等价档之一", () => {
    // N=2^15, r=8, p=3 —— OWASP Password Storage Cheat Sheet 的 scrypt 推荐组合之一。
    // 这条用例的意义是「以后有人手滑调低参数会被发现」，而不是重复文档。
    expect(RECOVERY_CODE_KDF).toMatchObject({ algorithm: "scrypt", n: 1 << 15, r: 8, p: 3 });
    expect(RECOVERY_CODE_KDF.keyLength).toBe(32);
    expect(RECOVERY_CODE_KDF.saltBytes).toBe(16);
  });
});
