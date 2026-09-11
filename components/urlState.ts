import { parseViewHash, serializeViewHash, type ViewState } from "@/lib/view-state";

export { DEFAULT_VIEW } from "@/lib/view-state";
export type { ViewState } from "@/lib/view-state";

export function readHash(): ViewState {
  if (typeof window === "undefined") return parseViewHash("");
  return parseViewHash(window.location.hash);
}

export function writeHash(v: ViewState): void {
  if (typeof window === "undefined") return;
  const next = serializeViewHash(v);
  const current = window.location.hash.replace(/^#/, "");
  if (next !== current) window.history.replaceState(null, "", next ? `#${next}` : window.location.pathname);
}

export function currentLink(v: ViewState): string {
  const hash = serializeViewHash(v);
  const base = `${window.location.origin}${window.location.pathname}`;
  return hash ? `${base}#${hash}` : base;
}
