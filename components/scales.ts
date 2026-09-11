/** Colour scales and formatting for the map. */

import type { Mode } from "@/lib/view-state";
export type { Mode };

export const MODES: Array<{ id: Mode; label: string; blurb: string }> = [
  { id: "demand", label: "Demand", blurb: "How much each tract spends on candy per year, all categories." },
  { id: "specialty", label: "Specialty", blurb: "Demand for one heritage segment's familiar candy, where the segment has critical mass." },
  { id: "share", label: "Our share", blurb: "Share of each tract's candy spend our stores capture." },
  { id: "uncaptured", label: "Uncaptured", blurb: "Spend our stores don't reach: where an opening would draw from." },
  { id: "primary", label: "Trade areas", blurb: "Which of our stores each tract mostly shops at." },
];

export const BLUE = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];
export const ORANGE = ["#fbe3d6", "#f5b592", "#eb6834", "#b84a1f", "#7a2f11"];
export const GREEN = ["#e1e0d9", "#b7e0c0", "#6cc08b", "#2c9a5a", "#006b2f"];
export const NEUTRAL = "#e1e0d9";
export const NO_DATA = "#c3c2b7";

/** Categorical slots for trade areas, in the validated palette order. */
export const STORE_SLOTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

export const STORE_TYPE_COLORS = { general: "#2a78d6", specialty: "#e87ba4" };
export const DC_COLOR = "#eda100";
export const COMPETITOR_COLOR = "#898781";

/** Quintile breaks over positive values. */
export function quintiles(values: number[]): number[] {
  const s = values.filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p: number) => (s.length ? s[Math.floor((s.length - 1) * p)] : 0);
  return [q(0.2), q(0.4), q(0.6), q(0.8)];
}

export function ramp(v: number, breaks: number[], colors: string[]): string {
  if (v <= 0) return colors[0];
  for (let i = 0; i < breaks.length; i++) if (v < breaks[i]) return colors[i];
  return colors[4];
}

export function shareColor(share: number): string {
  if (share <= 0) return NEUTRAL;
  if (share < 0.1) return GREEN[1];
  if (share < 0.25) return GREEN[2];
  if (share < 0.5) return GREEN[3];
  return GREEN[4];
}

export function money(x: number): string {
  const abs = Math.abs(x);
  if (abs >= 1e6) return `$${(x / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `$${Math.round(x / 1e3)}k`;
  return `$${Math.round(x)}`;
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0)}%`;
}

export function fmtNum(x: number | null | undefined): string {
  return x == null ? "n/a" : Math.round(x).toLocaleString("en-US");
}
