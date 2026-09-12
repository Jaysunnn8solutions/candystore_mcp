/**
 * The map's view state and its URL-hash encoding, shared by the browser
 * and the MCP server so a pasted link means the same thing to both.
 */

import { flattenParams, overridesSchema, paramsSchema, storeSchema, toParams, DEFAULT_PARAMS, type ScenarioOverrides } from "./model/params";
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
/**
 * The heritage segment ids the pipeline emits. Listed here rather than read
 * from the data manifest because this module is part of the browser bundle,
 * and reaching the manifest means lib/data/load.ts, which reads the data
 * files off disk. They change only when the pipeline's segment list does.
 */
const SEGMENT_IDS = new Set(["latam", "caribbean", "eastasia", "southasia", "mideast", "africa", "easteurope"]);
const PARAM_KEYS = [
  "baseSpend", "incomeElasticity", "childBoost", "criticalMass", "specialtyAffinity",
  "beta", "alpha", "maxKm", "outsideOption",
] as const;

// type@lat,lon@size@seg1+seg2@name, except that URLSearchParams applies
// form-urlencoded decoding, which turns the separating "+" into a space.
// Accept either so links written with a literal "+" — everything the map has
// ever copied — keep their segments.
const STORE_ITEM =
  /^(general|specialty)@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:@(\d+(?:\.\d+)?))?(?:@([a-z+ ]*))?(?:@([^@|]*))?$/;

/** What a store is called when the link carries no name for it. */
function defaultStoreName(type: StoreType): string {
  return `Proposed ${type} store`;
}

/**
 * "@" and "|" separate the fields of a scenario store and URLSearchParams
 * reads a "+" back as a space, so a name travels through the hash as the
 * characters that survive that round trip and nothing else. Applied on the
 * way in as well: a hand-edited link is not a licence to put arbitrary text
 * into a store name that other surfaces then print.
 */
function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9 .,'-]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 80);
}

/** The fields a schema rejected, for a message that names the problem. */
function badFields(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>): string {
  return [...new Set(issues.map((i) => i.path.filter((k) => typeof k === "string").join(".")).filter(Boolean))].join(", ");
}

export interface ParsedView {
  view: ViewState;
  /** Parts of the link that were unusable, phrased for a reader. */
  dropped: string[];
}

/**
 * Parse a hash and say what, if anything, had to be thrown away. The scenario
 * pieces are held to the same schemas the tools apply, so a stale or
 * hand-edited link degrades to the parts that still work instead of failing
 * whole at the first out-of-range number.
 */
export function readViewHash(hash: string): ParsedView {
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  const dropped: string[] = [];

  const flat = flattenParams(DEFAULT_PARAMS);
  const packed = h.get("p");
  if (packed != null) {
    const p = packed.split(",").map(Number);
    if (p.length === PARAM_KEYS.length && p.every((x) => Number.isFinite(x))) {
      PARAM_KEYS.forEach((k, i) => ((flat as Record<string, number>)[k] = p[i]));
    } else {
      dropped.push(`the packed model settings, which fall back to the defaults (not ${PARAM_KEYS.length} numbers)`);
    }
  }
  // A hand-edited or stale link can carry values every other surface rejects
  // (a negative base spend prices tracts in negative dollars), so hold the
  // packed numbers to the same schema and fall back to defaults as this parser
  // does with any other malformed field.
  const checked = paramsSchema.safeParse(flat);
  if (!checked.success) dropped.push(`the packed model settings, which fall back to the defaults (${badFields(checked.error.issues)} outside the range the model accepts)`);
  const params: ScenarioParams = checked.success ? toParams(checked.data) : DEFAULT_PARAMS;

  const scenario: Store[] = [];
  for (const item of (h.get("scn") ?? "").split("|").filter(Boolean)) {
    const m = STORE_ITEM.exec(item);
    if (!m) {
      dropped.push("a scenario store written in a form this map cannot read");
      continue;
    }
    if (scenario.length >= 100) {
      dropped.push("scenario stores past the 100 a scenario may carry");
      break;
    }
    const type = m[1] as StoreType;
    const parsed = storeSchema.safeParse({
      type,
      lat: Number(m[2]),
      lon: Number(m[3]),
      size: m[4] ? Number(m[4]) : 1,
      segments: m[5] ? m[5].split(/[+ ]/).filter(Boolean) : [],
      name: safeName(m[6] ?? "") || defaultStoreName(type),
    });
    if (!parsed.success) {
      dropped.push(`a scenario store outside the range the model accepts (${badFields(parsed.error.issues)})`);
      continue;
    }
    // Ided by how many stores were kept, not by position in the hash: the
    // server ids the same stores by their position in the `add` array it is
    // sent, so a dropped item would shift every id after it out of step.
    scenario.push({ ...parsed.data, id: `new-${scenario.length}`, name: parsed.data.name ?? defaultStoreName(type), proposed: true });
  }

  const closed: string[] = [];
  for (const id of (h.get("closed") ?? "").split(",").filter(Boolean)) {
    if (closed.length >= 100) {
      dropped.push("closures past the 100 a scenario may carry");
      break;
    }
    if (!overridesSchema.shape.remove.safeParse([id]).success) {
      dropped.push("a closed-store id longer than the 40 characters the tools accept");
      continue;
    }
    closed.push(id);
  }

  const capacityScale: ScenarioOverrides["capacityScale"] = [];
  for (const item of (h.get("cap") ?? "").split("|").filter(Boolean)) {
    const m = /^([\w-]+):([\w:*-]+)=(\d+(?:\.\d+)?)$/.exec(item);
    if (!m) {
      dropped.push("a capacity change written in a form this map cannot read");
      continue;
    }
    if (capacityScale.length >= 50) {
      dropped.push("capacity changes past the 50 a scenario may carry");
      break;
    }
    const entry = { dc: m[1], category: m[2], factor: Number(m[3]) };
    const parsed = overridesSchema.shape.capacityScale.safeParse([entry]);
    if (!parsed.success) {
      dropped.push(`a capacity change outside the range the model accepts (${badFields(parsed.error.issues)})`);
      continue;
    }
    capacityScale.push(entry);
  }

  const modeRaw = h.get("mode") as Mode | null;
  const segRaw = h.get("seg");
  return {
    view: {
      mode: modeRaw && MODES.has(modeRaw) ? modeRaw : DEFAULT_VIEW.mode,
      segment: segRaw && SEGMENT_IDS.has(segRaw) ? segRaw : DEFAULT_VIEW.segment,
      params,
      scenario,
      closed,
      capacityScale,
      selected: /^13\d{9}$/.test(h.get("sel") ?? "") ? h.get("sel") : null,
      showCompetitors: h.get("comp") !== "0",
    },
    dropped,
  };
}

export function parseViewHash(hash: string): ViewState {
  return readViewHash(hash).view;
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
        .map((s) => {
          const fields = `${s.type}@${s.lat.toFixed(5)},${s.lon.toFixed(5)}@${s.size}@${s.segments.join("+")}`;
          // Names carry too, so a reloaded four-store scenario still has four
          // legend rows a reader can tell apart — but only when the name says
          // more than the one the parser would give the store anyway.
          const name = safeName(s.name);
          return name && name !== defaultStoreName(s.type) ? `${fields}@${name}` : fields;
        })
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
