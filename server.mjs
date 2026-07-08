import { createServer } from "node:http";
import { createReadStream, existsSync, promises as fs } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const root = new URL(".", import.meta.url).pathname;
const port = Number(process.env.PORT || 5387);
const host = process.env.HOST || "0.0.0.0";
const appId = process.env.FEISHU_APP_ID || process.env.LARK_APP_ID || "";
const appSecret = process.env.FEISHU_APP_SECRET || process.env.LARK_APP_SECRET || "";
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, "");
const redirectUri = `${publicBaseUrl}/api/auth/feishu/callback`;
const sessions = new Map();
const oauthStates = new Map();
const dataDir = join(root, "data");
const distRoot = join(root, "dist");
const dbPath = process.env.DB_PATH || join(dataDir, "app.db");
const databaseDriver = (process.env.DB_DRIVER || "").toLowerCase();
const store = await createStore();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function json(res, status, data, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(data));
}

function readJsonBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function useMysqlStore() {
  if (databaseDriver === "mysql") return true;
  if (databaseDriver === "sqlite") return false;
  return Boolean(
    process.env.MYSQL_URL ||
      (process.env.DATABASE_URL || "").startsWith("mysql") ||
      process.env.MYSQL_HOST
  );
}

async function createStore() {
  return useMysqlStore() ? createMysqlStore() : createSqliteStore();
}

async function createSqliteStore() {
  const { DatabaseSync } = await import("node:sqlite");
  await fs.mkdir(dataDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  const getStoreStatement = db.prepare("SELECT value, updated_at FROM app_store WHERE key = ?");
  const listStoreStatement = db.prepare("SELECT key, value, updated_at FROM app_store ORDER BY key");
  const setStoreStatement = db.prepare(`
    INSERT INTO app_store (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  return {
    name: `sqlite:${dbPath}`,
    async list() {
      return listStoreStatement.all();
    },
    async get(key) {
      return getStoreStatement.get(key);
    },
    async set(entries, updatedAt) {
      entries.forEach(([key, value]) => {
        if (!key) return;
        setStoreStatement.run(String(key), JSON.stringify(value ?? null), updatedAt);
      });
    },
  };
}

async function createMysqlStore() {
  let mysqlModule;
  try {
    mysqlModule = await import("mysql2/promise");
  } catch (error) {
    throw new Error("MySQL mode requires dependency mysql2. Run: npm install --omit=dev", {
      cause: error,
    });
  }

  const mysql = mysqlModule.default || mysqlModule;
  const mysqlUrl = process.env.MYSQL_URL || ((process.env.DATABASE_URL || "").startsWith("mysql") ? process.env.DATABASE_URL : "");
  const pool = mysqlUrl
    ? mysql.createPool(mysqlUrl)
    : mysql.createPool({
        host: process.env.MYSQL_HOST || "127.0.0.1",
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER || "asset_portal",
        password: process.env.MYSQL_PASSWORD || "",
        database: process.env.MYSQL_DATABASE || "asset_portal",
        charset: "utf8mb4",
        waitForConnections: true,
        connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
      });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_store (
      \`key\` VARCHAR(191) NOT NULL PRIMARY KEY,
      \`value\` LONGTEXT NOT NULL,
      updated_at VARCHAR(64) NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  return {
    name: mysqlUrl ? "mysql:url" : `mysql:${process.env.MYSQL_HOST || "127.0.0.1"}:${process.env.MYSQL_PORT || 3306}/${process.env.MYSQL_DATABASE || "asset_portal"}`,
    async list() {
      const [rows] = await pool.query("SELECT `key`, `value`, updated_at FROM app_store ORDER BY `key`");
      return rows;
    },
    async get(key) {
      const [rows] = await pool.execute("SELECT `value`, updated_at FROM app_store WHERE `key` = ? LIMIT 1", [key]);
      return rows[0] || null;
    },
    async set(entries, updatedAt) {
      const validEntries = entries.filter(([key]) => key);
      if (!validEntries.length) return;
      const placeholders = validEntries.map(() => "(?, ?, ?)").join(", ");
      const values = validEntries.flatMap(([key, value]) => [String(key), JSON.stringify(value ?? null), updatedAt]);
      await pool.execute(
        `
          INSERT INTO app_store (\`key\`, \`value\`, updated_at)
          VALUES ${placeholders}
          ON DUPLICATE KEY UPDATE
            \`value\` = VALUES(\`value\`),
            updated_at = VALUES(updated_at)
        `,
        values
      );
    },
  };
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, { location, ...headers });
  res.end();
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function sessionCookie(id, maxAge = 60 * 60 * 24 * 7) {
  const secure = publicBaseUrl.startsWith("https://") ? "; Secure" : "";
  return `asset_session=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearSessionCookie() {
  return "asset_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

function feishuAuthorizeUrl(state) {
  const url = new URL("https://accounts.feishu.cn/open-apis/authen/v1/authorize");
  url.searchParams.set("app_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function postFeishuJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.code !== 0) {
    throw new Error(data.msg || `Feishu API failed: ${response.status}`);
  }
  return data.data;
}

async function getFeishuJson(url, accessToken) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json();
  if (!response.ok || data.code !== 0) {
    throw new Error(data.msg || `Feishu API failed: ${response.status}`);
  }
  return data.data;
}

function normalizeFeishuUser(raw) {
  const email = raw.email || raw.enterprise_email || "";
  const name = raw.name || raw.en_name || raw.nick_name || "飞书用户";
  const externalSubject = raw.union_id || raw.open_id || raw.user_id || email;
  const roleCode = email.includes("admin") ? "admin" : "employee";
  return {
    name,
    account: email ? email.split("@")[0] : externalSubject,
    email,
    phone: raw.mobile || "",
    department: "飞书组织",
    roleCode,
    roleName: roleCode === "admin" ? "普通管理员" : "普通员工",
    scope: roleCode === "admin" ? "资产台账、员工信息、审批处理和盘点执行" : "本人资产、个人申请和审批状态",
    externalSubject: `feishu:${externalSubject}`,
  };
}

async function handleFeishuLogin(req, res) {
  if (!appId || !appSecret) {
    json(res, 500, {
      error: "FEISHU_APP_ID and FEISHU_APP_SECRET are required",
      redirectUri,
    });
    return;
  }
  const state = randomBytes(16).toString("hex");
  oauthStates.set(state, Date.now());
  json(res, 200, { authorizationUrl: feishuAuthorizeUrl(state), redirectUri });
}

async function handleFeishuCallback(req, res, url) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !oauthStates.has(state)) {
    redirect(res, "/?auth=feishu_failed");
    return;
  }
  oauthStates.delete(state);

  try {
    const tokenData = await postFeishuJson("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
      grant_type: "authorization_code",
      client_id: appId,
      client_secret: appSecret,
      code,
      redirect_uri: redirectUri,
    });
    const accessToken = tokenData.access_token || tokenData.user_access_token;
    const userData = await getFeishuJson("https://open.feishu.cn/open-apis/authen/v1/user_info", accessToken);
    const sessionId = randomUUID();
    sessions.set(sessionId, {
      user: normalizeFeishuUser(userData),
      createdAt: Date.now(),
    });
    redirect(res, "/", { "set-cookie": sessionCookie(sessionId) });
  } catch (error) {
    console.error("[feishu-oauth]", error);
    redirect(res, "/?auth=feishu_failed");
  }
}

function handleMe(req, res) {
  const sessionId = parseCookies(req).asset_session;
  const session = sessions.get(sessionId);
  if (!session) {
    json(res, 200, { authenticated: false });
    return;
  }
  json(res, 200, { authenticated: true, user: session.user });
}

function handleLogout(req, res) {
  const sessionId = parseCookies(req).asset_session;
  if (sessionId) sessions.delete(sessionId);
  json(res, 200, { ok: true }, { "set-cookie": clearSessionCookie() });
}

function parseStoreValue(row) {
  if (!row) return null;
  try {
    return { value: JSON.parse(row.value), updatedAt: row.updated_at };
  } catch {
    return { value: null, updatedAt: row.updated_at };
  }
}

async function handleStoreList(req, res) {
  const values = {};
  const updatedAt = {};
  for (const row of await store.list()) {
    const parsed = parseStoreValue(row);
    values[row.key] = parsed?.value;
    updatedAt[row.key] = parsed?.updatedAt || "";
  }
  json(res, 200, { values, updatedAt });
}

async function handleStoreGet(req, res, url) {
  const key = url.searchParams.get("key") || "";
  if (!key) {
    json(res, 400, { error: "key is required" });
    return;
  }
  const row = await store.get(key);
  const parsed = parseStoreValue(row);
  json(res, 200, { key, found: Boolean(row), value: parsed?.value ?? null, updatedAt: parsed?.updatedAt || "" });
}

async function handleStoreSet(req, res) {
  const body = await readJsonBody(req);
  const items = body.items && typeof body.items === "object" ? body.items : null;
  const entries = items ? Object.entries(items) : [[body.key, body.value]];
  const now = new Date().toISOString();
  await store.set(entries, now);
  json(res, 200, { ok: true, updatedAt: now });
}

async function serveStatic(req, res, url) {
  const staticRoot = existsSync(join(distRoot, "index.html")) ? distRoot : root;
  const rawPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(staticRoot, safePath);
  const fallbackPath = join(staticRoot, "index.html");
  const canFallbackToSpa = req.method === "GET" && !url.pathname.startsWith("/api/") && !extname(url.pathname);

  if (!filePath.startsWith(staticRoot) || !existsSync(filePath)) {
    if (canFallbackToSpa && existsSync(fallbackPath)) {
      filePath = fallbackPath;
    } else {
      json(res, 404, { error: "Not found" });
      return;
    }
  }
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    if (canFallbackToSpa && existsSync(fallbackPath)) {
      filePath = fallbackPath;
    } else {
      json(res, 404, { error: "Not found" });
      return;
    }
  }
  const finalStat = await fs.stat(filePath);
  if (!finalStat.isFile()) {
    json(res, 404, { error: "Not found" });
    return;
  }
  res.writeHead(200, {
    "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "cache-control": "no-store, max-age=0",
  });
  createReadStream(filePath).pipe(res);
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", publicBaseUrl);
  try {
    if (url.pathname === "/api/auth/feishu/login") return handleFeishuLogin(req, res);
    if (url.pathname === "/api/auth/feishu/callback") return handleFeishuCallback(req, res, url);
    if (url.pathname === "/api/auth/me") return handleMe(req, res);
    if (url.pathname === "/api/auth/logout") return handleLogout(req, res);
    if (url.pathname === "/api/store" && req.method === "GET") return handleStoreList(req, res);
    if (url.pathname === "/api/store/item" && req.method === "GET") return handleStoreGet(req, res, url);
    if (url.pathname === "/api/store" && req.method === "POST") return handleStoreSet(req, res);
    return serveStatic(req, res, url);
  } catch (error) {
    console.error("[server]", error);
    json(res, 500, { error: "Internal Server Error" });
  }
}).listen(port, host, () => {
  console.log(`Asset portal listening on http://${host}:${port}`);
  console.log(`Store: ${store.name}`);
  console.log(`Feishu redirect URI: ${redirectUri}`);
});
