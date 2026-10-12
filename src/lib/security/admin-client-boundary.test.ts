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

  it("一处集中守卫就算等价证据，不需要每条路由各自内联读环境变量", () => {
    const sourceFiles = [
      source(
        "src/lib/repositories/example.ts",
        `export async function handler(request: Request) {
  if (!isMockEnabled) return new Response(null, { status: 404 });
  if (!e2eBearerAuthorized(request.headers.get("authorization"))) return new Response(null, { status: 401 });
  return createAdminClient().from("profiles").select("id");
}
`,
      ),
    ];
    const entry = inventory({
      surface: "e2e-mock-route",
      trust: {
        kind: "mock-bearer",
        evidence: ["isMockEnabled", ["E2E_BEARER_TOKEN", "e2eBearerAuthorized"]],
      },
    });
    expect(codes(sourceFiles, [entry])).toEqual([]);
  });

  it("备选证据也不能白拿：两个写法都不在时仍然报缺失", () => {
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
      trust: {
        kind: "mock-bearer",
        evidence: ["isMockEnabled", ["E2E_BEARER_TOKEN", "e2eBearerAuthorized"]],
      },
    });
    const found = codes(sourceFiles, [entry]);
    expect(found).toEqual(["ADMIN_CLIENT_TRUST_EVIDENCE_MISSING"]);
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
    expect(facts.reduce((total, fact) => total + fact.calls.length, 0)).toBe(92);
  });
});

describe("trust.evidence 为空", () => {
  const guarded = `export async function handler() {
  const user = await requireSessionUser(supabase);
  return createAdminClient().from("profiles").select("id");
}
`;

  it("非 server-internal 的 kind 清空 evidence → 报错", () => {
    // 回归：把一份授权判断的**理由**整段删掉，trust.kind 还留着，
    // 于是记录看起来仍然有效（"session 信任"），而门禁一声不吭。
    const found = codes(
      [source("src/lib/repositories/example.ts", guarded)],
      [inventory({ surface: "data-access", trust: { kind: "session", evidence: [] } })],
    );
    expect(found).toContain("ADMIN_CLIENT_TRUST_EVIDENCE_EMPTY");
  });

  it("证据符号真的不在模块里 → 仍然是 MISSING（不是 EMPTY）", () => {
    const found = codes(
      [source("src/lib/repositories/example.ts", guarded)],
      [inventory({ surface: "data-access", trust: { kind: "session", evidence: ["someSymbolThatIsAbsent"] } })],
    );
    expect(found).toEqual(["ADMIN_CLIENT_TRUST_EVIDENCE_MISSING"]);
  });

  it("server-internal 允许 evidence 为空（它没有外部调用者，没有授权判断这回事）", () => {
    const found = codes(
      [source("src/lib/repositories/example.ts", guarded)],
      [inventory({ surface: "data-access", trust: { kind: "server-internal", evidence: [] } })],
    );
    expect(found).not.toContain("ADMIN_CLIENT_TRUST_EVIDENCE_EMPTY");
  });

  it("真实清单里每条非 server-internal 登记都带 evidence", () => {
    const offenders = ADMIN_CLIENT_INVENTORY.filter(
      (entry) => entry.trust.kind !== "server-internal" && entry.trust.evidence.length === 0,
    ).map((entry) => entry.file);
    expect(offenders).toEqual([]);
  });
});

describe("trust.evidence 不能靠注释通过", () => {
  // 回归：判定原先拿**原始文本**做 `includes`，于是模块里任何位置（含注释、JSDoc、
  // 被注释掉的旧实现）出现过那串字符，这条授权判断就算有据可查。
  // 那是安全门禁里最贵的失效形态——**假绿**：门禁看起来在守，实际上一行注释就能关掉它。
  const code = `export async function handler() {
  return createAdminClient().from("profiles").select("id");
}
`;

  it("证据符号只出现在行注释里 → 报缺失", () => {
    const found = codes(
      [source("src/lib/repositories/example.ts", `// requireAdmin() was here\n${code}`)],
      [inventory({ trust: { kind: "role", evidence: ["requireAdmin"] } })],
    );
    expect(found).toEqual(["ADMIN_CLIENT_TRUST_EVIDENCE_MISSING"]);
  });

  it("证据符号只出现在块注释 / JSDoc 里 → 报缺失", () => {
    const found = codes(
      [source("src/lib/repositories/example.ts", `/** 调用方必须先确认 requireAdmin */\n${code}`)],
      [inventory({ trust: { kind: "role", evidence: ["requireAdmin"] } })],
    );
    expect(found).toEqual(["ADMIN_CLIENT_TRUST_EVIDENCE_MISSING"]);
  });

  it("证据符号只出现在被注释掉的旧实现里 → 报缺失", () => {
    const found = codes(
      [source("src/lib/repositories/example.ts", `  // const admin = await requireAdmin();\n${code}`)],
      [inventory({ trust: { kind: "role", evidence: ["requireAdmin"] } })],
    );
    expect(found).toEqual(["ADMIN_CLIENT_TRUST_EVIDENCE_MISSING"]);
  });

  it("同一个符号在真实代码里出现 → 通过（修 bug 不能修成假红）", () => {
    const found = codes(
      [
        source(
          "src/lib/repositories/example.ts",
          `export async function handler() {
  const admin = await requireAdmin();
  return createAdminClient().from("profiles").select("id") ?? admin;
}
`,
        ),
      ],
      [inventory({ calls: ["handler"], trust: { kind: "role", evidence: ["requireAdmin"] } })],
    );
    expect(found).toEqual([]);
  });

  it("证据符号被改名（旧名只剩在新名字里当子串） → 报缺失", () => {
    // 这是 `includes` 的第二条假绿通道：`verifyAssertionRenamed` 依然满足证据 `verifyAssertion`。
    const found = codes(
      [
        source(
          "src/lib/repositories/example.ts",
          `export async function handler() {
  await requireAdminToo();
  return createAdminClient().from("profiles").select("id");
}
`,
        ),
      ],
      [inventory({ calls: ["handler"], trust: { kind: "role", evidence: ["requireAdmin"] } })],
    );
    expect(found).toEqual(["ADMIN_CLIENT_TRUST_EVIDENCE_MISSING"]);
  });

  it("报错文案明说「注释不算证据」——否则人会先怀疑符号拼错", () => {
    const issue = inspectAdminClientBoundary(
      [source("src/lib/repositories/example.ts", `// requireAdmin\n${code}`)],
      [inventory({ trust: { kind: "role", evidence: ["requireAdmin"] } })],
    )[0];
    expect(issue?.message).toContain("comments do not count as evidence");
  });
});

describe("trust.evidence 的跨文件形态（file#symbol）", () => {
  // `caller-validated` 的授权**本来就不在被审计的模块里**，所以证据也必须写到调用方去。
  // 沿用仓库既有约定（`src/lib/security/route-auth.ts` 输出 `${file}#${symbol}`）。
  const bridge = `export async function establishPasskeySession(userId: string) {
  const admin = createAdminClient();
  return admin.auth.admin.getUserById(userId);
}
`;
  const caller = `async function verifyAssertion() { return null; }
export async function POST() {
  await verifyAssertion();
  return establishPasskeySession("u-1");
}
`;
  const crossEntry = inventory({
    file: "src/lib/auth/passkey-session.ts",
    surface: "auth-bridge",
    calls: ["establishPasskeySession"],
    authAdmin: ["getUserById"],
    tables: [],
    trust: { kind: "caller-validated", evidence: ["src/api/caller.ts#verifyAssertion"] },
  });

  it("被引用文件的真实代码里有该符号 → 通过", () => {
    expect(
      codes(
        [
          source("src/lib/auth/passkey-session.ts", bridge),
          source("src/api/caller.ts", caller),
        ],
        [crossEntry],
      ),
    ).toEqual([]);
  });

  it("被引用文件里该符号只出现在注释 → 仍然报缺失（跨文件不能成为新的假绿通道）", () => {
    expect(
      codes(
        [
          source("src/lib/auth/passkey-session.ts", bridge),
          source("src/api/caller.ts", `// verifyAssertion happens before the bridge\nfunction POST() {}\n`),
        ],
        [crossEntry],
      ),
    ).toEqual(["ADMIN_CLIENT_TRUST_EVIDENCE_MISSING"]);
  });

  it("被引用文件不在审计源里 → 报 FILE_MISSING，而不是静默跳过", () => {
    // 指向一个不存在（或未被喂进来）的文件，等于这条证据**永远无法被验证**。
    // 静默跳过就是把它降级成装饰性文字。
    expect(
      codes([source("src/lib/auth/passkey-session.ts", bridge)], [crossEntry]),
    ).toEqual(["ADMIN_CLIENT_TRUST_EVIDENCE_FILE_MISSING"]);
  });

  it("备选列表里同文件与跨文件混用，任一命中即通过", () => {
    const entry = inventory({
      file: "src/lib/auth/passkey-session.ts",
      surface: "auth-bridge",
      calls: ["establishPasskeySession"],
      authAdmin: ["getUserById"],
      tables: [],
      trust: {
        kind: "caller-validated",
        evidence: [["src/api/caller.ts#verifyAssertion", "establishPasskeySession"]],
      },
    });
    expect(
      codes([source("src/lib/auth/passkey-session.ts", bridge)], [entry]),
    ).toEqual([]);
  });

  it("真实清单：passkey 桥的证据指向 route 里真实存在的符号", () => {
    // 这条登记原先是 `["调用方必须先确认"]`——一句只存在于 JSDoc 里的中文散文，
    // 配上原始文本子串匹配 ⇒ **这条门禁一直在靠注释通过**。
    const entry = ADMIN_CLIENT_INVENTORY.find(
      (item) => item.file === "src/lib/auth/passkey-session.ts",
    );
    expect(entry?.trust.evidence).toEqual([
      "src/app/api/auth/passkey/auth-verify/route.ts#verifyAssertion",
    ]);
  });
});
