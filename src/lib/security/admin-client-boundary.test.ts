import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_CLIENT_INVENTORY,
  collectAdminClientFacts,
  inspectAdminClientBoundary,
  type AdminClientInventoryEntry,
  type AdminClientSource,
} from "./admin-client-boundary";

function source(fileName: string, content: string): AdminClientSource {
  return { fileName, content };
}

function inventory(overrides: Partial<AdminClientInventoryEntry> = {}): AdminClientInventoryEntry {
  return {
    file: "src/lib/repositories/example.ts",
    surface: "data-access",
    calls: ["handler"],
    tables: ["profiles"],
    rpc: [],
    storageBuckets: [],
    authAdmin: [],
    trust: { kind: "server-internal", evidence: [] },
    rationale: "test fixture",
    ...overrides,
  };
}

function codes(sourceFiles: AdminClientSource[], entries: AdminClientInventoryEntry[]): string[] {
  return inspectAdminClientBoundary(sourceFiles, entries)
    .map((issue) => issue.code)
    .sort();
}

describe("collectAdminClientFacts", () => {
  it("inventories call owners and Supabase surfaces without counting comments", () => {
    const facts = collectAdminClientFacts([
      source(
        "src/lib/repositories/example.ts",
        `// createAdminClient() in a comment is not a call
const note = "createAdminClient()";
export async function handler() {
  const admin = createAdminClient();
  await admin.from("profiles").select("id");
  await admin.rpc("refresh_profile");
  await admin.storage.from("avatars").upload("a.png", Buffer.from("x"));
  await admin.auth.admin.deleteUser("user-1");
}
`,
      ),
    ]);

    expect(facts).toEqual([
      {
        file: "src/lib/repositories/example.ts",
        calls: ["handler"],
        tables: ["profiles"],
        rpc: ["refresh_profile"],
        storageBuckets: ["avatars"],
        authAdmin: ["deleteUser"],
        clientModule: false,
      },
    ]);
  });

  it("ignores built-in .from() helpers but keeps unknown receivers conservative", () => {
    const facts = collectAdminClientFacts([
      source(
        "src/lib/repositories/example.ts",
        `export async function handler() {
  const admin = createAdminClient();
  await admin.from("profiles").select("id");
  const bytes = Buffer.from("x");
  const ids = Array.from([1, 2, 3]);
  const typed = Uint8Array.from([1, 2]);
  void bytes, ids, typed;
}
`,
      ),
    ]);

    expect(facts[0]?.tables).toEqual(["profiles"]);
  });

  it("records the full owner path for object methods", () => {
    const facts = collectAdminClientFacts([
      source(
        "src/lib/storage/example.ts",
        `export function driver() {
  return {
    async put() {
      const admin = createAdminClient();
      await admin.storage.from("avatars").upload("a.png", Buffer.from("x"));
    },
  };
}
`,
      ),
    ]);
    expect(facts[0]?.calls).toEqual(["driver.put"]);
  });
});

describe("inspectAdminClientBoundary", () => {
  it("accepts a classified call site with allowlisted operations and evidence", () => {
    const sourceFiles = [
      source(
        "src/lib/repositories/example.ts",
        `export async function handler() {
  await requireAdmin();
  const admin = createAdminClient();
  await admin.from("profiles").select("id");
}
`,
      ),
    ];
    const entries = [
      inventory({
        trust: { kind: "role", evidence: ["requireAdmin"] },
      }),
    ];
    expect(inspectAdminClientBoundary(sourceFiles, entries)).toEqual([]);
  });

  it("fails closed when a new module calls createAdminClient", () => {
    const sourceFiles = [
      source(
        "src/lib/repositories/new.ts",
        `export async function handler() {
  return createAdminClient().from("profiles").select("id");
}
`,
      ),
    ];
    expect(codes(sourceFiles, [])).toEqual(["ADMIN_CLIENT_UNCLASSIFIED"]);
  });

  it("fails closed when inventory is stale after a file stops using service_role", () => {
    expect(codes([], [inventory()])).toEqual(["ADMIN_CLIENT_STALE_INVENTORY"]);
  });

  it("flags a new call site in an already classified file", () => {
    const sourceFiles = [
      source(
        "src/lib/repositories/example.ts",
        `export async function handler() { createAdminClient(); }
export async function second() { createAdminClient(); }
`,
      ),
    ];
    expect(codes(sourceFiles, [inventory()])).toEqual(["ADMIN_CLIENT_CALL_SITE_DRIFT"]);
  });

  it.each([
    ["ADMIN_CLIENT_TABLE_NOT_ALLOWED", 'admin.from("secret_table")'],
    ["ADMIN_CLIENT_RPC_NOT_ALLOWED", 'admin.rpc("dangerous_rpc")'],
    ["ADMIN_CLIENT_STORAGE_BUCKET_NOT_ALLOWED", 'admin.storage.from("private")'],
    ["ADMIN_CLIENT_AUTH_ADMIN_NOT_ALLOWED", 'admin.auth.admin.deleteUser("user-1")'],
  ])("flags an undeclared operation with %s", (expected, operation) => {
    const sourceFiles = [
      source(
        "src/lib/repositories/example.ts",
        `export async function handler() {
  const admin = createAdminClient();
  await ${operation};
}
`,
      ),
    ];
    expect(codes(sourceFiles, [inventory()])).toEqual([expected]);
  });

  it("flags a client module that references the admin client", () => {
    const sourceFiles = [
      source(
        "src/lib/repositories/example.ts",
        `"use client";
export function handler() { return createAdminClient(); }
`,
      ),
    ];
    expect(codes(sourceFiles, [inventory()])).toEqual(["ADMIN_CLIENT_CLIENT_MODULE"]);
  });

  it("flags missing authorization evidence", () => {
    const sourceFiles = [
      source(
        "src/lib/repositories/example.ts",
        `export async function handler() { return createAdminClient().from("profiles").select("id"); }
`,
      ),
    ];
    expect(
      codes(sourceFiles, [
        inventory({ trust: { kind: "role", evidence: ["requireAdmin"] } }),
      ]),
    ).toEqual(["ADMIN_CLIENT_TRUST_EVIDENCE_MISSING"]);
  });

  it("requires both mock-mode and bearer-token evidence for E2E routes", () => {
    const sourceFiles = [
      source(
        "src/lib/repositories/example.ts",
        `export async function handler() {
  if (!isMockEnabled) return new Response(null, { status: 404 });
  return createAdminClient().from("profiles").select("id");
}
`,
      ),
    ];
    const entry = inventory({
      surface: "e2e-mock-route",
      trust: { kind: "mock-bearer", evidence: ["isMockEnabled", "E2E_BEARER_TOKEN"] },
    });
    expect(codes(sourceFiles, [entry])).toEqual(["ADMIN_CLIENT_TRUST_EVIDENCE_MISSING"]);
  });

  it("accepts the committed service-role inventory", () => {
    const srcDir = path.join(process.cwd(), "src");
    const sourceFiles = fs
      .readdirSync(srcDir, { withFileTypes: true, recursive: true })
      .flatMap((entry) => {
        if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) return [];
        if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) return [];
        const absolute = path.join(entry.parentPath, entry.name);
        return [
          source(
            path.relative(process.cwd(), absolute).split(path.sep).join("/"),
            fs.readFileSync(absolute, "utf8"),
          ),
        ];
      });

    const facts = collectAdminClientFacts(sourceFiles);
    expect(inspectAdminClientBoundary(sourceFiles)).toEqual([]);
    expect(facts).toHaveLength(ADMIN_CLIENT_INVENTORY.length);
    // 预算式断言：新增 service-role 调用点必须同时更新清单、文档与本数字。
    expect(facts.reduce((total, fact) => total + fact.calls.length, 0)).toBe(84);
  });
});
