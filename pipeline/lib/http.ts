import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CACHE_DIR } from "../config";

/** Strip credential query parameters before a URL reaches a log or error. */
export function redact(url: string): string {
  try {
    const u = new URL(url);
    for (const k of ["key", "api_key", "token"]) {
      if (u.searchParams.has(k)) u.searchParams.set(k, "REDACTED");
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Cache filename: the caller's label with a hash of the request identity
 * before the extension. Without the hash, changing what we ask for (an ACS
 * variable, a heritage segment, an Overpass query or bbox) would rebuild
 * data from a response that predates the change. The url is redacted first
 * so rotating CENSUS_API_KEY is not a request change.
 */
function cacheFileName(url: string, cacheName: string, init?: RequestInit): string {
  const body = typeof init?.body === "string" ? init.body : "";
  const hash = createHash("sha256")
    .update(`${init?.method ?? "GET"}\n${redact(url)}\n${body}`)
    .digest("hex")
    .slice(0, 10);
  const ext = path.extname(cacheName);
  return `${path.basename(cacheName, ext)}-${hash}${ext}`;
}

/**
 * Download with an on-disk cache so re-running one stage doesn't re-pull
 * the boundary shapefiles. The cache directory is gitignored.
 */
export async function fetchCached(
  url: string,
  cacheName: string,
  init?: RequestInit
): Promise<Buffer> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const name = cacheFileName(url, cacheName, init);
  const file = path.join(CACHE_DIR, name);
  // Before the hash went into the name, the same download was cached under the
  // bare label. Nothing reads that copy now, and for the boundary shapefiles it
  // is tens of megabytes, so drop it whichever way this call goes.
  const unhashed = path.join(CACHE_DIR, path.basename(cacheName));
  if (unhashed !== file) rmSync(unhashed, { force: true });
  if (existsSync(file)) {
    log(`cache hit  ${name}`);
    return readFileSync(file);
  }
  log(`download   ${redact(url)}`);
  // Overpass answers 406 to Node's default "node" user agent, and its usage
  // policy asks clients to identify themselves anyway.
  const headers = new Headers(init?.headers);
  if (!headers.has("User-Agent")) {
    headers.set(
      "User-Agent",
      "candystore-mcp-pipeline/0.1 (+https://github.com/Jaysunnn8solutions/candystore_mcp)"
    );
  }
  const res = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`HTTP ${res.status} fetching ${redact(url)}${body ? `: ${body}` : ""}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  log(`saved      ${name} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  return buf;
}

export function log(msg: string): void {
  console.log(`[pipeline] ${msg}`);
}
