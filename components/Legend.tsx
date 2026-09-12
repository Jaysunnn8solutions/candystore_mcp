"use client";

import { BLUE, COMPETITOR_COLOR, DC_COLOR, GREEN, NEUTRAL, ORANGE, STORE_TYPE_COLORS, money, storeColor, type Mode } from "./scales";
import type { Store } from "@/lib/model/types";
import styles from "./Legend.module.css";

export function Legend({ mode, breaks, stores }: { mode: Mode; breaks: number[]; stores: Store[] }) {
  const rows: Array<{ color: string; label: string; round?: boolean }> = [];
  if (mode === "share") {
    ["none", "under 10%", "10 to 25%", "25 to 50%", "over 50%"].forEach((l, i) => rows.push({ color: GREEN[i], label: l }));
  } else if (mode === "primary") {
    stores.forEach((s, i) => rows.push({ color: storeColor(i), label: s.name }));
    rows.push({ color: NEUTRAL, label: "no store of ours in reach" });
  } else {
    const cols = mode === "specialty" ? ORANGE : BLUE;
    cols.forEach((c, i) => rows.push({ color: c, label: i < 4 ? `under ${money(breaks[i] ?? 0)}` : `${money(breaks[3] ?? 0)} and up` }));
    if (mode === "specialty") rows.push({ color: NEUTRAL, label: "segment below critical mass" });
  }
  rows.push({ color: STORE_TYPE_COLORS.general, label: "general store", round: true });
  rows.push({ color: STORE_TYPE_COLORS.specialty, label: "specialty store", round: true });
  rows.push({ color: DC_COLOR, label: "distribution center", round: true });
  rows.push({ color: COMPETITOR_COLOR, label: "competitor", round: true });
  return (
    <div className={styles.legend} aria-label="Map legend">
      {rows.map((r, i) => (
        <div key={`${i}-${r.label}`} className={styles.row}>
          <span className={styles.swatch} style={{ background: r.color, borderRadius: r.round ? "50%" : undefined }} />
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}
