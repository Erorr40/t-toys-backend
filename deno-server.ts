import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";
import {
  dirname,
  extname,
  fromFileUrl,
  isAbsolute,
  join
} from "https://deno.land/std@0.224.0/path/mod.ts";
import { contentType } from "https://deno.land/std@0.224.0/media_types/mod.ts";
import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

let dotenv: Record<string, string> = {};
try {
  dotenv = await load({ envPath: ".env" });
} catch {
  dotenv = {};
}

function getEnv(name: string, fallback = ""): string {
  return Deno.env.get(name) ?? dotenv[name] ?? fallback;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const corsAllowed = splitCsv(getEnv("CORS_ALLOWED_ORIGINS", ""));
const allowAnyOrigin = corsAllowed.length === 0 || corsAllowed.includes("*");

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers();
  if (allowAnyOrigin) {
    headers.set("Access-Control-Allow-Origin", "*");
  } else if (origin && corsAllowed.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  return headers;
}

function jsonResponse(
  data: unknown,
  status = 200,
  origin: string | null = null,
  extraHeaders: HeadersInit = {}
): Response {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "application/json");
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, String(value));
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function emptyResponse(status: number, origin: string | null, extraHeaders: HeadersInit = {}): Response {
  const headers = corsHeaders(origin);
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, String(value));
  }
  return new Response(null, { status, headers });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await Deno.stat(filePath);
    return info.isFile;
  } catch {
    return false;
  }
}

function toSafeRelativePath(pathname: string): string {
  const trimmed = pathname.replace(/^\/+/, "");
  return trimmed
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

async function resolveFrontendFile(pathname: string, root: string): Promise<string | null> {
  const relPath = toSafeRelativePath(pathname);
  const candidate = join(root, relPath);
  try {
    const info = await Deno.stat(candidate);
    if (info.isFile) return candidate;
    if (info.isDirectory) {
      const indexPath = join(candidate, "index.html");
      if (await fileExists(indexPath)) return indexPath;
    }
  } catch {}

  const indexPath = join(candidate, "index.html");
  if (await fileExists(indexPath)) return indexPath;
  return null;
}

async function serveStaticFile(filePath: string, origin: string | null): Promise<Response | null> {
  try {
    const data = await Deno.readFile(filePath);
    const headers = corsHeaders(origin);
    headers.set("Content-Type", contentType(extname(filePath)) ?? "application/octet-stream");
    return new Response(data, { status: 200, headers });
  } catch {
    return null;
  }
}

const baseDir = dirname(fromFileUrl(import.meta.url));
const dbFileRaw = getEnv("DB_FILE", "data/ttoys.db");
const dbPath = isAbsolute(dbFileRaw) ? dbFileRaw : join(baseDir, dbFileRaw);

const frontendPath = join(baseDir, "..", "frontend");
const frontendIndex = join(frontendPath, "index.html");
const devIndex = join(frontendPath, "dev", "index.html");
const hasFrontend = await fileExists(frontendIndex);
const hasDevIndex = await fileExists(devIndex);

await Deno.mkdir(dirname(dbPath), { recursive: true });
const db = new DB(dbPath);
db.execute(
  "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)"
);
db.execute(
  "CREATE TABLE IF NOT EXISTS app_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id TEXT, page_name TEXT, created_at TEXT)"
);
db.query(
  "INSERT OR IGNORE INTO meta (key, value, updated_at) VALUES (?, ?, ?)",
  ["created_at", new Date().toISOString(), new Date().toISOString()]
);

function handleDbHealth(origin: string | null): Response {
  try {
    db.query("SELECT 1");
    return jsonResponse(
      {
        status: "ok",
        database: dbPath
      },
      200,
      origin
    );
  } catch (error) {
    return jsonResponse(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Database health check failed."
      },
      503,
      origin
    );
  }
}

function parseAppLogsRoute(pathname: string): { appId: string; pageName: string } | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 4) return null;
  if (segments[0] !== "app-logs") return null;
  if (segments[2] !== "log-user-in-app") return null;
  return { appId: segments[1], pageName: segments[3] };
}

const portValue = Number(getEnv("PORT", "5099"));
const port = Number.isFinite(portValue) && portValue > 0 ? portValue : 5099;

const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  const isApiPath =
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/app-logs") ||
    url.pathname.startsWith("/health");

  if (req.method === "OPTIONS") {
    return emptyResponse(204, origin);
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return jsonResponse(
      {
        status: "ok",
        time: new Date().toISOString()
      },
      200,
      origin
    );
  }

  if (req.method === "GET" && url.pathname === "/api/info") {
    return jsonResponse(
      {
        name: "T-Toys API",
        environment: getEnv("NODE_ENV", "development")
      },
      200,
      origin
    );
  }

  if (req.method === "POST") {
    const logRoute = parseAppLogsRoute(url.pathname);
    if (logRoute) {
      try {
        db.query(
          "INSERT INTO app_logs (app_id, page_name, created_at) VALUES (?, ?, ?)",
          [logRoute.appId, logRoute.pageName, new Date().toISOString()]
        );
      } catch {}
      return emptyResponse(204, origin, { "Cache-Control": "no-store" });
    }
  }

  if (
    req.method === "GET" &&
    (url.pathname === "/api/db/health" || url.pathname === "/api/mongo/health")
  ) {
    return handleDbHealth(origin);
  }

  if ((req.method === "GET" || req.method === "HEAD") && hasFrontend && !isApiPath) {
    if (hasDevIndex && (url.pathname === "/dev" || url.pathname.startsWith("/dev/"))) {
      const response = await serveStaticFile(devIndex, origin);
      if (response) return response;
    }

    let staticPath = url.pathname;
    if (staticPath === "/frontend" || staticPath.startsWith("/frontend/")) {
      staticPath = staticPath.slice("/frontend".length) || "/";
    }

    const filePath = await resolveFrontendFile(staticPath, frontendPath);
    if (filePath) {
      const response = await serveStaticFile(filePath, origin);
      if (response) return response;
    }

    if (!extname(staticPath)) {
      const response = await serveStaticFile(frontendIndex, origin);
      if (response) return response;
    }
  }

  if (req.method === "GET" && url.pathname === "/" && !hasFrontend) {
    return jsonResponse(
      {
        name: "T-Toys API",
        status: "ok"
      },
      200,
      origin
    );
  }

  return jsonResponse(
    {
      status: "error",
      message: "Not found"
    },
    404,
    origin
  );
};

serve(handler, { port });
