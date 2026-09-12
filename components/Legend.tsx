"use client";

import type { CSSProperties } from "react";
import { BLUE, COMPETITOR_COLOR, DC_COLOR, GREEN, MODES, NEUTRAL, ORANGE, STORE_TYPE_COLORS, money, type Mode } from "./scales";
import type { Store } from "@/lib/model/types";
import styles from "./Legend.module.css";

interface Props {
  mode: Mode;
  breaks: number[];
  stores: Store[];
  /** Store id → colour, assigned over the whole roster so a closure cannot reshuffle it. */
  storeSlots: Map<string, string>;
  showCompetitors: boolean;
  onShowCompetitors: (v: boolean) => void;
  /** Collapsed: the ramp alone, so a folded legend is still a legend. */
  compact?: boolean;
}

const SHARE_LABELS = ["none", "under 10%", "10 to 25%", "25 to 50%", "over 50%"];

export function Legend({ mode, breaks, stores, storeSlots, showCompetitors, onShowCompetitors, compact }: Props) {
  const sequential = mode === "demand" || mode === "specialty" || mode === "uncaptured";
  const colors = mode === "specialty" ? ORANGE : BLUE;
  const slot = (s: Store) => storeSlots.get(s.id) ?? NEUTRAL;
  const ramp = mode === "share" ? GREEN : mode === "primary" ? stores.slice(0, 5).map(slot) : colors;

  if (compact) {
    // Named from MODES, and only the sequential layers are a scale: Trade areas
    // is one colour per store and Our share is banded, so calling either a
    // light-to-dark ramp would describe a form the map does not have.
    const label = MODES.find((m) => m.id === mode)?.label ?? mode;
    const shape =
      mode === "primary" ? "one colour per store" : mode === "share" ? "five share bands, light to dark" : "scale, light to dark";
    return (
      <div className={styles.legend}>
        <div className={styles.ramp} role="img" aria-label={`${label}: ${shape}. Expand the legend for the values.`}>
          {ramp.map((c, i) => <span key={i} style={{ ["--c" as string]: c } as CSSProperties} />)}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.legend}>
      {sequential && (
        <>
          <div className={styles.ramp} aria-hidden>
            {colors.map((c, i) => <span key={i} style={{ ["--c" as string]: c } as CSSProperties} />)}
          </div>
          <div
            className={styles.breaks}
            role="img"
            aria-label={`${mode === "specialty" ? "Specialty demand" : mode === "uncaptured" ? "Uncaptured demand" : "Demand"} per tract, in five steps light to dark: under ${money(breaks[0] ?? 0)}, then ${breaks.map((b) => money(b ?? 0)).join(", ")}, then ${money(breaks[3] ?? 0)} and up.`}
          >
            {breaks.map((b, i) => (
              <span key={i} style={{ left: `${((i + 1) / 5) * 100}%` }}>{money(b ?? 0)}</span>
            ))}
          </div>
        </>
      )}

      {mode === "share" && (
        <>
          <div className={styles.ramp} aria-hidden>
            {GREEN.map((c, i) => <span key={i} style={{ ["--c" as string]: c } as CSSProperties} />)}
          </div>
          <div className={styles.rows}>
            {GREEN.map((c, i) => (
              <div key={i} className={styles.row}>
                <span className={styles.swatch} style={{ ["--c" as string]: c } as CSSProperties} />
                <span className={styles.label}>{SHARE_LABELS[i]}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {mode === "specialty" && (
        <div className={styles.row}>
          <span className={styles.swatch} style={{ ["--c" as string]: NEUTRAL } as CSSProperties} />
          <span className={styles.label}>segment below critical mass</span>
        </div>
      )}

      {mode === "primary" && (
        // A trade-area legend has one row per store, which is a result and may
        // run to dozens: it scrolls, the marker key below it never does.
        <div className={styles.rows}>
          {stores.map((s) => (
            <div key={s.id} className={styles.row}>
              <span className={styles.swatch} style={{ ["--c" as string]: slot(s) } as CSSProperties} />
              <span className={styles.label} title={s.name}>{s.name}</span>
            </div>
          ))}
          <div className={styles.row}>
            <span className={styles.swatch} style={{ ["--c" as string]: NEUTRAL } as CSSProperties} />
            <span className={styles.label}>no store of ours in reach</span>
          </div>
        </div>
      )}

      <div className={styles.markers}>
        <div className={styles.row}>
          <span className={`${styles.swatch} ${styles.round}`} style={{ ["--c" as string]: STORE_TYPE_COLORS.general } as CSSProperties} />
          <span className={styles.label}>general</span>
        </div>
        <div className={styles.row}>
          <span className={`${styles.swatch} ${styles.round}`} style={{ ["--c" as string]: STORE_TYPE_COLORS.specialty } as CSSProperties} />
          <span className={styles.label}>specialty</span>
        </div>
        <div className={styles.row}>
          <span className={`${styles.swatch} ${styles.round}`} style={{ ["--c" as string]: DC_COLOR } as CSSProperties} />
          <span className={styles.label}>distribution center</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={showCompetitors}
          className={styles.compRow}
          onClick={() => onShowCompetitors(!showCompetitors)}
        >
          <span
            className={`${styles.swatch} ${styles.round}`}
            style={{ ["--c" as string]: showCompetitors ? COMPETITOR_COLOR : "transparent", boxShadow: showCompetitors ? undefined : `inset 0 0 0 2px ${COMPETITOR_COLOR}` } as CSSProperties}
          />
          <span className={styles.label}>competitors</span>
          {showCompetitors && <span className={styles.check} aria-hidden>✓</span>}
        </button>
      </div>
    </div>
  );
}
