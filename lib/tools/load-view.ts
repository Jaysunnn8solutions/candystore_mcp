import { flattenParams } from "../model/params";
import { hashFromInput, readViewHash, viewToToolArgs } from "../view-state";
import { describeParams, market, money, pct, readOnly, text, tractLabel, z } from "./shared";

export const loadViewConfig = {
  title: "Load a map link",
  description:
    "Read a link copied from the map (or its Copy-settings block) and return " +
    "the model parameters, scenario stores, closures and capacity changes it " +
    "encodes, as the exact arguments to pass to the other tools.",
  inputSchema: z.object({ link: z.string().min(1).max(6000) }).strict(),
  annotations: readOnly,
};

export function loadViewHandler({ link }: { link: string }) {
  const urlMatch = /https?:\/\/\S+/.exec(link);
  const { view, dropped } = readViewHash(hashFromInput(urlMatch ? urlMatch[0] : link));
  const args = viewToToolArgs(view);
  const r = market(flattenParams(view.params), {
    add: view.scenario.map((s) => ({ type: s.type, lon: s.lon, lat: s.lat, size: s.size, segments: s.segments, name: s.name })),
    remove: view.closed,
    capacityScale: view.capacityScale,
  });
  return text(
    [
      `View loaded. Pass these arguments to any analysis tool — every tool except describe_market, which only reports the baseline, and load_view itself:`,
      "```json",
      JSON.stringify(args, null, 2),
      "```",
      `- Layer: ${view.mode}${view.mode === "specialty" ? ` (${view.segment})` : ""}.`,
      `- Settings: ${describeParams(view.params)}.`,
      `- Scenario: ${view.scenario.length} added store(s), ${view.closed.length} closed, ${view.capacityScale.length} capacity change(s).`,
      dropped.length ? `- Could not be used from this link: ${dropped.join("; ")}. Everything else in it is above.` : "",
      `- With these settings: chain revenue ${money(r.totals.ourRevenue)}/yr, share ${pct(r.totals.ourShare)}.`,
      view.selected ? `- Selected tract: ${tractLabel(view.selected)}. Call get_tract for the profile.` : "",
    ].join("\n")
  );
}
