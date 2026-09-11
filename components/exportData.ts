import type { TractCollection } from "@/lib/data/load";
import type { MarketResult } from "@/lib/model/types";
import { ourShare } from "./MarketMap";

export function toCsv(tracts: TractCollection, result: MarketResult): string {
  const cats = Object.keys(result.totals.marketByCategory);
  const header = ["geoid", "name", "place", "county", "pop", "households", "medianIncome", "demandTotal", "ourShare", "primaryStore", ...cats.map((c) => `demand_${c}`), ...cats.map((c) => `captured_${c}`)];
  const byGeoid = new Map(result.tracts.map((t) => [t.geoid, t]));
  const lines = [header.join(",")];
  for (const f of tracts.features) {
    const p = f.properties;
    const t = byGeoid.get(p.geoid);
    if (!t) continue;
    const row = [p.geoid, p.name, p.place, p.county, p.pop, p.households, p.medianIncome ?? "", Math.round(t.total), ourShare(t).toFixed(4), t.primaryStore ?? "", ...cats.map((c) => Math.round(t.byCategory[c] ?? 0)), ...cats.map((c) => (t.captured[c] ?? 0).toFixed(4))];
    lines.push(row.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(","));
  }
  return lines.join("\n");
}

export function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
