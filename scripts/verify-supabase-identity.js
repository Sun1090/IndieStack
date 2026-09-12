#!/usr/bin/env node
/**
 * Runtime Supabase identity matrix for local/staging environments.
 *
 * Usage:
 *   pnpm smoke:supabase-identity
 *   pnpm smoke:supabase-identity -- --url http://127.0.0.1:54321 \
 *     --anon-key "$ANON_KEY" --service-role-key "$SERVICE_ROLE_KEY" --output /tmp/identity.json
 *
 * The script logs in as deterministic seed users, exercises PostgREST RLS with
 * anonymous/authenticated/service-role JWTs, and exercises the real Storage API.
 * It never prints keys and removes the temporary storage objects it creates.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");

const OWNER_A = "10000000-0000-0000-0000-000000000001";
const OWNER_B = "10000000-0000-0000-0000-000000000002";
const MEMBER_A = "10000000-0000-0000-0000-000000000003";
const TEAM_A = "00000000-0000-0000-0000-000000000001";
const TEAM_B = "00000000-0000-0000-0000-000000000002";
const PROJECT_A_PUBLIC = "40000000-0000-0000-0000-000000000001";
const PROJECT_A_PRIVATE = "40000000-0000-0000-0000-000000000002";
const PROJECT_B_PRIVATE = "40000000-0000-0000-0000-000000000003";
const SEED_PASSWORD = "indiestack-local";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1xkAAAAASUVORK5CYII=",
  "base64",
);

const FLAG_TARGETS = new Map([
  ["--url", "url"],
  ["--anon-key", "anonKey"],
  ["--service-role-key", "serviceRoleKey"],
  ["--output", "output"],
  ["--timeout-ms", "timeoutMs"],
]);

/** 读取 `--flag value` 形式的值；下一个 token 缺失或又是一个 flag 时报错 */
function readFlagValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== "--");
  const options = {
    url: undefined,
    anonKey: undefined,
    serviceRoleKey: undefined,
    output: undefined,
    timeoutMs: 10_000,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const separator = arg.indexOf("=");
    const flag = separator === -1 ? arg : arg.slice(0, separator);
    const target = FLAG_TARGETS.get(flag);
    if (!target) throw new Error(arg.startsWith("-") ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`);
    // 同时支持 `--flag=value` 与 `--flag value`
    const raw = separator === -1 ? readFlagValue(args, ++index, flag) : arg.slice(separator + 1);
    options[target] = target === "timeoutMs" ? Number(raw) : raw;
  }

  applyEnvironmentDefaults(options);
  assertOptions(options);
  return options;
}

/** 命令行 > 环境变量 > 本地 `supabase status` 输出 */
function applyEnvironmentDefaults(options) {
  options.url ??= process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  options.anonKey ??= process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  options.serviceRoleKey ??= process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (options.url && options.anonKey && options.serviceRoleKey) return;

  const status = readLocalSupabaseStatus();
  options.url ??= status.API_URL;
  options.anonKey ??= status.ANON_KEY;
  options.serviceRoleKey ??= status.SERVICE_ROLE_KEY;
}

function assertOptions(options) {
  const missing = [
    !options.url && "--url / SUPABASE_URL",
    !options.anonKey && "--anon-key / SUPABASE_ANON_KEY",
    !options.serviceRoleKey && "--service-role-key / SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`Missing Supabase configuration: ${missing.join(", ")}`);
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be positive");
  }
}

function readLocalSupabaseStatus() {
  try {
    const stdout = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const values = {};
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)="(.*)"$/);
      if (match) values[match[1]] = match[2];
    }
    return values;
  } catch {
    return {};
  }
}

function normalizeBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid Supabase URL: ${value}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Supabase URL must use http or https");
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

async function request(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response) {
  return response.json().catch(() => null);
}

function addCheck(checks, name, passed, detail, status = null) {
  checks.push({ name, passed, detail, status });
}

function userIds(rows) {
  return Array.isArray(rows)
    ? rows.map((row) => row.id).filter((id) => typeof id === "string").sort()
    : [];
}

function sameIds(actual, expected) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  return actualSorted.length === expectedSorted.length && actualSorted.every((id, index) => id === expectedSorted[index]);
}

function isStorageDenied(response, body) {
  const nestedStatus = Number(body?.statusCode);
  const message = String(body?.message || body?.error || "");
  return (
    response.status === 401 ||
    response.status === 403 ||
    nestedStatus === 401 ||
    nestedStatus === 403 ||
    /row-level security|access denied|unauthorized/i.test(message)
  );
}

async function login(baseUrl, anonKey, email, options) {
  return request(
    options.fetchImpl,
    `${baseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: SEED_PASSWORD }),
    },
    options.timeoutMs,
  );
}

async function restSelect(baseUrl, key, token, table, query, options) {
  const response = await request(
    options.fetchImpl,
    `${baseUrl}/rest/v1/${table}?${query}`,
    {
      method: "GET",
      headers: { apikey: key, Authorization: `Bearer ${token}`, Accept: "application/json" },
    },
    options.timeoutMs,
  );
  return { response, body: await readJson(response) };
}

async function storageRequest(baseUrl, key, token, pathname, init, options) {
  const headers = {
    apikey: key,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers || {}),
  };
  const response = await request(
    options.fetchImpl,
    `${baseUrl}/storage/v1/${pathname}`,
    { ...init, headers },
    options.timeoutMs,
  );
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await readJson(response)
    : Buffer.from(await response.arrayBuffer());
  return { response, body };
}

async function deleteStorageObject(baseUrl, key, token, pathname, options) {
  try {
    return await storageRequest(
      baseUrl,
      key,
      token,
      `object/avatars/${pathname}`,
      { method: "DELETE" },
      options,
    );
  } catch (error) {
    return { response: null, body: { message: error instanceof Error ? error.message : String(error) } };
  }
}

function recordLoginCheck(checks, name, expectedId, response, body) {
  const userId = body?.user?.id || "missing";
  const token = body?.access_token;
  const passed = response.status === 200 && userId === expectedId && typeof token === "string";
  addCheck(checks, name, passed, `HTTP ${response.status}, user=${userId}`, response.status);
  return token;
}

async function runAuthChecks(checks, options, baseUrl, requestOptions) {
  const [ownerALogin, ownerBLogin] = await Promise.all([
    login(baseUrl, options.anonKey, "seed-owner-a@example.com", requestOptions),
    login(baseUrl, options.anonKey, "seed-owner-b@example.com", requestOptions),
  ]);
  const ownerAToken = recordLoginCheck(checks, "auth-owner-a-login", OWNER_A, ownerALogin, await readJson(ownerALogin));
  const ownerBToken = recordLoginCheck(checks, "auth-owner-b-login", OWNER_B, ownerBLogin, await readJson(ownerBLogin));

  if (typeof ownerAToken !== "string" || typeof ownerBToken !== "string") {
    throw new Error("Both deterministic seed users must log in before RLS checks can run");
  }
  return { ownerAToken, ownerBToken };
}

async function runRestChecks(checks, options, baseUrl, tokens, requestOptions) {
  const teamFilter = `id=in.(${TEAM_A},${TEAM_B})&select=id`;
  const profileFilter = `id=in.(${OWNER_A},${OWNER_B},${MEMBER_A})&select=id`;
  const projectFilter = `id=in.(${PROJECT_A_PUBLIC},${PROJECT_A_PRIVATE},${PROJECT_B_PRIVATE})&select=id`;

  const anonTeams = await restSelect(baseUrl, options.anonKey, options.anonKey, "teams", teamFilter, requestOptions);
  addCheck(
    checks,
    "anon-team-select-denied-by-rls",
    anonTeams.response.status === 200 && Array.isArray(anonTeams.body) && anonTeams.body.length === 0,
    `HTTP ${anonTeams.response.status}, visible=${userIds(anonTeams.body).join(",") || "none"}`,
    anonTeams.response.status,
  );

  const [ownerATeams, ownerBTeams, ownerAProfiles, ownerAProjects] = await Promise.all([
    restSelect(baseUrl, options.anonKey, tokens.ownerAToken, "teams", teamFilter, requestOptions),
    restSelect(baseUrl, options.anonKey, tokens.ownerBToken, "teams", teamFilter, requestOptions),
    restSelect(baseUrl, options.anonKey, tokens.ownerAToken, "profiles", profileFilter, requestOptions),
    restSelect(baseUrl, options.anonKey, tokens.ownerAToken, "projects", projectFilter, requestOptions),
  ]);

  addCheck(
    checks,
    "owner-a-sees-only-team-a",
    ownerATeams.response.status === 200 && sameIds(userIds(ownerATeams.body), [TEAM_A]),
    `HTTP ${ownerATeams.response.status}, visible=${userIds(ownerATeams.body).join(",") || "none"}`,
    ownerATeams.response.status,
  );
  addCheck(
    checks,
    "owner-b-sees-only-team-b",
    ownerBTeams.response.status === 200 && sameIds(userIds(ownerBTeams.body), [TEAM_B]),
    `HTTP ${ownerBTeams.response.status}, visible=${userIds(ownerBTeams.body).join(",") || "none"}`,
    ownerBTeams.response.status,
  );
  addCheck(
    checks,
    "owner-a-profile-bounded-to-team",
    ownerAProfiles.response.status === 200 && sameIds(userIds(ownerAProfiles.body), [OWNER_A, MEMBER_A]),
    `HTTP ${ownerAProfiles.response.status}, visible=${userIds(ownerAProfiles.body).join(",") || "none"}`,
    ownerAProfiles.response.status,
  );
  addCheck(
    checks,
    "owner-a-cannot-read-private-project-b",
    ownerAProjects.response.status === 200 &&
      sameIds(userIds(ownerAProjects.body), [PROJECT_A_PUBLIC, PROJECT_A_PRIVATE]),
    `HTTP ${ownerAProjects.response.status}, visible=${userIds(ownerAProjects.body).join(",") || "none"}`,
    ownerAProjects.response.status,
  );
}

/** 自身前缀的写入/更新/删除与公共读权限 */
async function runStorageWriteChecks(checks, options, baseUrl, ownerAToken, ownerAPath, requestOptions) {
  const objectPath = `object/avatars/${ownerAPath}`;
  const pngPost = { method: "POST", headers: { "Content-Type": "image/png" }, body: PNG };
  const pngPut = { method: "PUT", headers: { "Content-Type": "image/png", "x-upsert": "true" }, body: PNG };

  const anonUpload = await storageRequest(baseUrl, options.anonKey, "", objectPath, pngPost, requestOptions);
  addCheck(checks, "anon-storage-upload-denied", isStorageDenied(anonUpload.response, anonUpload.body), `HTTP ${anonUpload.response.status}`, anonUpload.response.status);

  const ownUpload = await storageRequest(baseUrl, options.anonKey, ownerAToken, objectPath, pngPost, requestOptions);
  addCheck(checks, "owner-a-storage-upload-own-prefix", ownUpload.response.status === 200, `HTTP ${ownUpload.response.status}`, ownUpload.response.status);

  const anonUpdate = await storageRequest(baseUrl, options.anonKey, "", objectPath, pngPut, requestOptions);
  addCheck(checks, "anon-storage-update-denied", isStorageDenied(anonUpdate.response, anonUpdate.body), `HTTP ${anonUpdate.response.status}`, anonUpdate.response.status);

  const anonDelete = await storageRequest(baseUrl, options.anonKey, "", objectPath, { method: "DELETE" }, requestOptions);
  addCheck(checks, "anon-storage-delete-denied", isStorageDenied(anonDelete.response, anonDelete.body), `HTTP ${anonDelete.response.status}`, anonDelete.response.status);

  const ownUpdate = await storageRequest(baseUrl, options.anonKey, ownerAToken, objectPath, pngPut, requestOptions);
  addCheck(checks, "owner-a-storage-update-own-prefix", ownUpdate.response.status === 200, `HTTP ${ownUpdate.response.status}`, ownUpdate.response.status);

  const publicRead = await storageRequest(baseUrl, options.anonKey, "", `object/public/avatars/${ownerAPath}`, { method: "GET" }, requestOptions);
  addCheck(checks, "anon-storage-public-read", publicRead.response.status === 200 && Buffer.isBuffer(publicRead.body), `HTTP ${publicRead.response.status}`, publicRead.response.status);
}

/** 跨租户与 service_role 边界 */
async function runStorageIsolationChecks(checks, options, baseUrl, tokens, paths, requestOptions) {
  const { ownerAToken, ownerBToken } = tokens;
  const { ownerAPath, ownerBPath } = paths;
  const pngPost = { method: "POST", headers: { "Content-Type": "image/png" }, body: PNG };

  const crossUpload = await storageRequest(baseUrl, options.anonKey, ownerAToken, `object/avatars/${ownerBPath}`, pngPost, requestOptions);
  addCheck(checks, "owner-a-storage-upload-other-prefix-denied", isStorageDenied(crossUpload.response, crossUpload.body), `HTTP ${crossUpload.response.status}`, crossUpload.response.status);

  const ownerBUpload = await storageRequest(baseUrl, options.anonKey, ownerBToken, `object/avatars/${ownerBPath}`, pngPost, requestOptions);
  addCheck(checks, "owner-b-storage-upload-own-prefix", ownerBUpload.response.status === 200, `HTTP ${ownerBUpload.response.status}`, ownerBUpload.response.status);

  const crossDelete = await storageRequest(baseUrl, options.anonKey, ownerAToken, `object/avatars/${ownerBPath}`, { method: "DELETE" }, requestOptions);
  addCheck(checks, "owner-a-storage-delete-other-prefix-denied", isStorageDenied(crossDelete.response, crossDelete.body), `HTTP ${crossDelete.response.status}`, crossDelete.response.status);

  const serviceDelete = await storageRequest(baseUrl, options.serviceRoleKey, options.serviceRoleKey, `object/avatars/${ownerBPath}`, { method: "DELETE" }, requestOptions);
  addCheck(checks, "service-role-storage-delete-other-prefix", serviceDelete.response.status === 200, `HTTP ${serviceDelete.response.status}`, serviceDelete.response.status);

  const upsertPost = { method: "POST", headers: { "Content-Type": "image/png", "x-upsert": "true" }, body: PNG };
  const serviceUpload = await storageRequest(baseUrl, options.serviceRoleKey, options.serviceRoleKey, `object/avatars/${ownerAPath}`, upsertPost, requestOptions);
  addCheck(checks, "service-role-storage-write-other-prefix", serviceUpload.response.status === 200, `HTTP ${serviceUpload.response.status}`, serviceUpload.response.status);

  const serviceRead = await storageRequest(baseUrl, options.serviceRoleKey, options.serviceRoleKey, `object/avatars/${ownerAPath}`, { method: "GET" }, requestOptions);
  addCheck(checks, "service-role-storage-read", serviceRead.response.status === 200 && Buffer.isBuffer(serviceRead.body), `HTTP ${serviceRead.response.status}`, serviceRead.response.status);

  const ownDelete = await storageRequest(baseUrl, options.anonKey, ownerAToken, `object/avatars/${ownerAPath}`, { method: "DELETE" }, requestOptions);
  addCheck(checks, "owner-a-storage-delete-own-prefix", ownDelete.response.status === 200, `HTTP ${ownDelete.response.status}`, ownDelete.response.status);
}

/** 跑完整矩阵；任何异常都记录为失败项，并始终清理临时对象 */
async function runIdentityMatrix(checks, options, baseUrl, requestOptions) {
  const ownerAPath = `${OWNER_A}/identity-matrix-a-${Date.now()}.png`;
  const ownerBPath = `${OWNER_B}/identity-matrix-b-${Date.now()}.png`;

  try {
    const tokens = await runAuthChecks(checks, options, baseUrl, requestOptions);
    await runRestChecks(checks, options, baseUrl, tokens, requestOptions);
    await runStorageWriteChecks(checks, options, baseUrl, tokens.ownerAToken, ownerAPath, requestOptions);
    await runStorageIsolationChecks(checks, options, baseUrl, tokens, { ownerAPath, ownerBPath }, requestOptions);
  } catch (error) {
    addCheck(checks, "identity-matrix-execution", false, error instanceof Error ? error.message : String(error), null);
  } finally {
    await Promise.all([
      deleteStorageObject(baseUrl, options.serviceRoleKey, options.serviceRoleKey, ownerAPath, requestOptions),
      deleteStorageObject(baseUrl, options.serviceRoleKey, options.serviceRoleKey, ownerBPath, requestOptions),
    ]);
  }
}

function buildEvidence(baseUrl, checks) {
  const passed = checks.filter((check) => check.passed).length;
  const failed = checks.length - passed;
  return {
    suite: "supabase-identity-matrix",
    timestamp: new Date().toISOString(),
    target: baseUrl,
    total: checks.length,
    passed,
    failed,
    ok: failed === 0 && checks.length > 0,
    checks,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(options.url);
  const checks = [];
  const requestOptions = { ...options, fetchImpl: options.fetchImpl || fetch };

  await runIdentityMatrix(checks, options, baseUrl, requestOptions);

  const evidence = buildEvidence(baseUrl, checks);
  console.log(JSON.stringify(evidence, null, 2));
  if (options.output) {
    fs.writeFileSync(options.output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }

  return evidence.ok ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`❌ Identity matrix failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}

module.exports = {
  OWNER_A,
  OWNER_B,
  TEAM_A,
  TEAM_B,
  normalizeBaseUrl,
  parseArgs,
  sameIds,
  userIds,
};
