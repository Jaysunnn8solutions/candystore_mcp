import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
 * Download with an on-disk cache so re-running one stage doesn't re-pull
 * an 18 MB GTFS zip. The cache directory is gitignored.
 */
export async function fetchCached(
  url: string,
  cacheName: string,
  init?: RequestInit
): Promise<Buffer> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, cacheName);
  if (existsSync(file)) {
    log(`cache hit  ${cacheName}`);
    return readFileSync(file);
  }
  log(`download   ${redact(url)}`);
  // Overpass answers 406 to Node's default "node" user agent, and its usage
  // policy asks clients to identify themselves anyway.
  const headers = new Headers(init?.headers);
  if (!headers.has("User-Agent")) {
    headers.set(
      "User-Agent",
      "atl-mcp-pipeline/0.1 (+https://github.com/Jaysunnn8solutions/atl-mcp)"
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
  log(`saved      ${cacheName} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  return buf;
}

export function log(msg: string): void {
  console.log(`[pipeline] ${msg}`);
}
