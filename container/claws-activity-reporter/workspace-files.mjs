// Live-write allowlist + disk write for PUT /internal/workspace-files.
// Must stay in sync with src/lib/artifacts/workspace-file-allowlist.ts
// Auth is the per-workspace OPENCLAW_GATEWAY_TOKEN (NOT the metering secret).

import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";

export const WORKSPACE_FILE_PREFIX = "shared/";
export const WORKSPACE_FILE_MAX_BYTES = 256 * 1024;
export const WORKSPACE_FILE_TEXT_EXT = [".md", ".txt", ".json"];
export const WORKSPACE_FILES_BODY_MAX_BYTES = WORKSPACE_FILE_MAX_BYTES + 4096;

const EXT_SET = new Set(WORKSPACE_FILE_TEXT_EXT);
const BANNED_SEGMENTS = new Set(["openclaw.json", ".env", "cron"]);

export function isSharedWritePath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) return false;
  if (relativePath.includes("\0")) return false;
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("://")) return false;
  const parts = normalized.split("/");
  if (parts.some((p) => p === ".." || p === "." || p === "" || p.startsWith("."))) {
    return false;
  }
  if (
    parts.some(
      (p) => BANNED_SEGMENTS.has(p.toLowerCase()) || p.toLowerCase().startsWith(".env"),
    )
  ) {
    return false;
  }
  if (!normalized.startsWith(WORKSPACE_FILE_PREFIX)) return false;
  if (normalized === WORKSPACE_FILE_PREFIX.slice(0, -1)) return false;
  const base = parts[parts.length - 1] ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 1) return false;
  return EXT_SET.has(base.slice(dot).toLowerCase());
}

export function tokensEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function gatewayTokenFromRequest(req) {
  const headers = req?.headers ?? {};
  const auth = headers.authorization;
  if (typeof auth === "string") {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const x = headers["x-gateway-token"];
  return typeof x === "string" ? x : "";
}

export function assertGatewayToken(req) {
  const expected = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!expected) {
    return { ok: false, status: 503, error: "token_unconfigured" };
  }
  const provided = gatewayTokenFromRequest(req);
  if (!tokensEqual(provided, expected)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true };
}

export function resolveSharedWritePath(dataDir, logicalPath) {
  if (!isSharedWritePath(logicalPath)) return null;
  const root = path.resolve(dataDir);
  const sharedRoot = path.resolve(root, "shared");
  const full = path.resolve(root, logicalPath.replace(/\//g, path.sep));
  const prefix = sharedRoot.endsWith(path.sep) ? sharedRoot : sharedRoot + path.sep;
  if (full !== sharedRoot && !full.startsWith(prefix)) return null;
  return full;
}

export function writeSharedFile(opts) {
  const dataDir = opts.dataDir;
  const logicalPath = typeof opts.logicalPath === "string" ? opts.logicalPath.replace(/\\/g, "/") : "";
  const content = opts.content;
  const fsImpl = opts.fsImpl ?? fs;
  if (typeof content !== "string") {
    return { ok: false, error: "missing_fields" };
  }
  if (content.includes("\0")) {
    return { ok: false, error: "invalid_content" };
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > WORKSPACE_FILE_MAX_BYTES) {
    return { ok: false, error: "too_large" };
  }
  const full = resolveSharedWritePath(dataDir, logicalPath);
  if (!full) {
    return { ok: false, error: "path_not_allowed" };
  }
  fsImpl.mkdirSync(path.dirname(full), { recursive: true });
  fsImpl.writeFileSync(full, content, "utf8");
  return { ok: true, bytes, path: logicalPath };
}

export async function readJsonBody(req, maxBytes = WORKSPACE_FILES_BODY_MAX_BYTES) {
  if (req?.body != null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === "string") return JSON.parse(req.body);
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString("utf8"));
  }

  const chunks = [];
  let size = 0;
  const push = (chunk) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) {
      const err = new Error("payload_too_large");
      err.code = "payload_too_large";
      throw err;
    }
    chunks.push(buf);
  };

  if (typeof req?.[Symbol.asyncIterator] === "function") {
    for await (const chunk of req) push(chunk);
  } else if (typeof req?.on === "function") {
    await new Promise((resolve, reject) => {
      req.on("data", (c) => {
        try {
          push(c);
        } catch (e) {
          reject(e);
        }
      });
      req.on("end", resolve);
      req.on("error", reject);
    });
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}
