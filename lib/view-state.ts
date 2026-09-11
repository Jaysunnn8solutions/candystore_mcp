/**
 * The map's view state and its URL-hash encoding, shared by the browser
 * and the MCP server so a pasted link means the same thing to both.
 */

import { flattenParams, DEFAULT_PARAMS, type ScenarioOverrides } from "./model/params";
import type { ScenarioParams, Store, StoreType } from "./model/types";

export type Mode = "demand" | "specialty" | "share" | "uncaptured" | "primary";

export interface ViewState {
  mode: Mode;
  segment: string;
  params: ScenarioParams;
  scenario: Store[];
  closed: string[];
  capacityScale: ScenarioOverrides["capacityScale"];
  selected: string | null;
  showCompetitors: boolean;
}

export const DEFAULT_VIEW: ViewState = {
  mode: "demand",
  segment: "latam",
  params: DEFAULT_PARAMS,
  scenario: [],
  closed: [],
  capacityScale: [],
  selected: null,
  showCompetitors: true,
};

const MODES = new Set<Mode>(["demand", "specialty", "share", "uncaptured", "primary"]);
const PARAM_KEYS = [
  "baseSpend", "incomeElasticity", "childBoost", "criticalMass", "specialtyAffinity",
  "beta", "alpha", "maxKm", "outsideOption",
] as const;

export function parseViewHash(hash: string): ViewState {
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  const flat = flattenParams(DEFAULT_PARAMS);
  const p = (h.get("p") ?? "").split(",").map(Number);
  if (p.length === PARAM_KEYS.length && p.every((x) => Number.isFinite(x))) {
    PARAM_KEYS.forEach((k, i) => ((flat as Record<string, number>)[k] = p[i]));
  }
  const params: ScenarioParams = {
    demand: {
      baseSpend: flat.baseSpend,
      incomeElasticity: flat.incomeElasticity,
      childBoost: flat.childBoost,
      criticalMass: flat.criticalMass,
      specialtyAffinity: flat.specialtyAffinity,
    },
    gravity: { beta: flat.beta, alpha: flat.alpha, maxKm: flat.maxKm, outsideOption: flat.outsideOption },
  };

  const scenario: Store[] = [];
  (h.get("scn") ?? "")
    .split("|")
    .filter(Boolean)
    .forEach((item, i) => {
      // type@lat,lon@size@seg1+seg2
      const m = /^(general|specialty)@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:@(\d+(?:\.\d+)?))?(?:@([a-z+]*))?$/.exec(item);
      if (!m) return;
      scenario.push({
        id: `new-${i}`,
        name: `Proposed ${m[1]} store`,
        type: m[1] as StoreType,
        lat: Number(m[2]),
        lon: Number(m[3]),
        size: m[4] ? Number(m[4]) : 1,
        segments: m[5] ? m[5].split("+").filter(Boolean) : [],
        proposed: true,
      });
    });
  const capacityScale = (h.get("cap") ?? "")
    .split("|")
    .filter(Boolean)
    .map((item) => {
      const m = /^([\w-]+):([\w:*-]+)=(\d+(?:\.\d+)?)$/.exec(item);
      return m ? { dc: m[1], category: m[2], factor: Number(m[3]) } : null;
    })
    .filter((x): x is { dc: string; category: string; factor: number } => x != null);

  const modeRaw = h.get("mode") as Mode | null;
  return {
    mode: modeRaw && MODES.has(modeRaw) ? modeRaw : DEFAULT_VIEW.mode,
    segment: h.get("seg") ?? DEFAULT_VIEW.segment,
    params,
    scenario: scenario.slice(0, 100),
    closed: (h.get("closed") ?? "").split(",").filter(Boolean),
    capacityScale,
    selected: /^13\d{9}$/.test(h.get("sel") ?? "") ? h.get("sel") : null,
    showCompetitors: h.get("comp") !== "0",
  };
}

export function serializeViewHash(v: ViewState): string {
  const h = new URLSearchParams();
  if (v.mode !== DEFAULT_VIEW.mode) h.set("mode", v.mode);
  if (v.segment !== DEFAULT_VIEW.segment) h.set("seg", v.segment);
  const flat = flattenParams(v.params);
  const dflt = flattenParams(DEFAULT_PARAMS);
  if (PARAM_KEYS.some((k) => flat[k] !== dflt[k])) h.set("p", PARAM_KEYS.map((k) => flat[k]).join(","));
  if (v.scenario.length) {
    h.set(
      "scn",
      v.scenario
        .map((s) => `${s.type}@${s.lat.toFixed(5)},${s.lon.toFixed(5)}@${s.size}@${s.segments.join("+")}`)
        .join("|")
    );
  }
  if (v.closed.length) h.set("closed", v.closed.join(","));
  if (v.capacityScale.length) h.set("cap", v.capacityScale.map((c) => `${c.dc}:${c.category}=${c.factor}`).join("|"));
  if (v.selected) h.set("sel", v.selected);
  if (!v.showCompetitors) h.set("comp", "0");
  return h.toString().replace(/%40/g, "@").replace(/%2C/g, ",").replace(/%7C/g, "|").replace(/%3A/g, ":").replace(/%2B/g, "+").replace(/%3D/g, "=").replace(/%2A/g, "*");
}

/** The view as the exact arguments every tool accepts. */
export function viewToToolArgs(v: ViewState): Record<string, unknown> {
  const args: Record<string, unknown> = { ...flattenParams(v.params) };
  if (v.scenario.length) {
    args.add = v.scenario.map((s) => ({ type: s.type, lon: s.lon, lat: s.lat, size: s.size, segments: s.segments, name: s.name }));
  }
  if (v.closed.length) args.remove = v.closed;
  if (v.capacityScale.length) args.capacityScale = v.capacityScale;
  return args;
}

export function hashFromInput(input: string): string {
  const s = input.trim();
  const i = s.indexOf("#");
  if (i >= 0) return s.slice(i + 1);
  return s.startsWith("http") ? "" : s;
}

export function viewToClipboardText(v: ViewState, link: string): string {
  const lines = [`Use these candystore-mcp settings for every tool call: ${JSON.stringify(viewToToolArgs(v))}`];
  if (v.selected) lines.push(`Selected tract: ${v.selected}`);
  lines.push(`Layer: ${v.mode}${v.mode === "specialty" ? ` (${v.segment})` : ""}`);
  lines.push(`Map link: ${link}`);
  return lines.join("\n");
}
