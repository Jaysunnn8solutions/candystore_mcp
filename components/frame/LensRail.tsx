"use client";

import { useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { GeoMatch } from "@/lib/geocode";
import { DEFAULT_PARAMS } from "@/lib/model/params";
import type { MarketResult, ScenarioParams } from "@/lib/model/types";
import type { MapPoint } from "../MarketMap";
import { BLUE, GREEN, MODES, ORANGE, STORE_SLOTS, pct, type Mode } from "../scales";
import { changedParamCount } from "./params-fields";
import type { PopoverId } from "./types";
import { useOverflowWarn } from "./useOverflowWarn";
import styles from "./LensRail.module.css";
import w from "./Widgets.module.css";

interface Props {
  mode: Mode;
  onMode: (m: Mode) => void;
  segment: string;
  onSegment: (s: string) => void;
  /** Every segment the manifest carries, not only the ones with markets. */
  segments: Array<{ id: string; label: string }>;
  result: MarketResult | null;
  params: ScenarioParams;
  onParams: (p: ScenarioParams) => void;
  onSearch: (q: string) => Promise<GeoMatch[]>;
  onGoTo: (p: MapPoint) => void;
  onShowAbout: () => void;
  popover: PopoverId;
  onPopover: (p: PopoverId) => void;
}

/** The palette each layer actually paints with, for its 24x14 ramp swatch. */
const RAMPS: Record<Mode, string[]> = {
  demand: BLUE,
  specialty: ORANGE,
  share: GREEN,
  uncaptured: BLUE,
  primary: STORE_SLOTS.slice(0, 5),
};

export function LensRail(p: Props) {
  const rail = useRef<HTMLDivElement>(null);
  useOverflowWarn(rail, "lens rail");
  const tabs = useRef<HTMLDivElement>(null);
  const segs = useRef<HTMLDivElement>(null);
  const changed = changedParamCount(p.params);

  const counts = new Map((p.result?.segments ?? []).map((s) => [s.id, s]));
  const maxDemand = Math.max(1, ...(p.result?.segments ?? []).map((s) => s.demand));
  const rows = [...p.segments].sort((a, b) => (counts.get(b.id)?.demand ?? 0) - (counts.get(a.id)?.demand ?? 0));
  const enabled = rows.filter((r) => (counts.get(r.id)?.markets ?? 0) > 0 || r.id === p.segment);

  const moveTab = (delta: number) => {
    const i = MODES.findIndex((m) => m.id === p.mode);
    const next = MODES[Math.min(MODES.length - 1, Math.max(0, i + delta))];
    if (!next) return;
    p.onMode(next.id);
    tabs.current?.querySelectorAll<HTMLButtonElement>("button")[MODES.indexOf(next)]?.focus();
  };

  // Arrow keys walk `enabled`, never `rows`, so a segment with no markets is
  // stepped over rather than being a dead stop that answers nothing.
  const moveSeg = (delta: number) => {
    const i = enabled.findIndex((s) => s.id === p.segment);
    const next = enabled[Math.min(enabled.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta))];
    if (!next) return;
    p.onSegment(next.id);
    p.onMode("specialty");
    segs.current?.querySelectorAll<HTMLButtonElement>("button")[rows.findIndex((r) => r.id === next.id)]?.focus();
  };

  return (
    <div ref={rail} className={styles.rail}>
      <SearchField onSearch={p.onSearch} onGoTo={p.onGoTo} popover={p.popover} onPopover={p.onPopover} />

      <div className={styles.layerBlock}>
        <h2 className={w.h2}>Map layer</h2>
        <div
          ref={tabs}
          className={styles.tablist}
          role="tablist"
          aria-orientation="vertical"
          aria-label="Map layer"
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") moveTab(-1);
            else if (e.key === "ArrowDown") moveTab(1);
            else if (e.key === "Home") moveTab(-MODES.length);
            else if (e.key === "End") moveTab(MODES.length);
            else return;
            e.preventDefault();
          }}
        >
          {MODES.map((m) => {
            const on = p.mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls="map-region"
                tabIndex={on ? 0 : -1}
                className={styles.layerRow}
                onClick={() => p.onMode(m.id)}
              >
                <span className={styles.spine} aria-hidden />
                <span className={styles.layerText}>
                  <span className={styles.layerLabel}>{m.label}</span>
                  {on && <span className={styles.layerBlurb}>{m.blurb}</span>}
                </span>
                <span className={styles.ramp} aria-hidden>
                  {RAMPS[m.id].map((c, i) => (
                    <span key={i} style={{ ["--c" as string]: c } as CSSProperties} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.segBlock}>
        <h2 className={w.h2}>
          Segments<span>{enabled.length} of {rows.length} markets</span>
        </h2>
        <div
          ref={segs}
          className={styles.segList}
          role="radiogroup"
          aria-label="Heritage segment"
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") moveSeg(-1);
            else if (e.key === "ArrowDown") moveSeg(1);
            else if (e.key === "Home") moveSeg(-rows.length);
            else if (e.key === "End") moveSeg(rows.length);
            else return;
            e.preventDefault();
          }}
        >
          {rows.map((s) => {
            const info = counts.get(s.id);
            const markets = info?.markets ?? 0;
            const on = p.segment === s.id;
            const dead = markets === 0 && !on;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-disabled={dead || undefined}
                // A radiogroup keeps exactly one tab stop. The checked segment
                // is always in `enabled`, so there is always one.
                tabIndex={on ? 0 : -1}
                className={styles.segRow}
                title={`${s.label} — ${markets} tract${markets === 1 ? "" : "s"} at critical mass`}
                onClick={() => {
                  if (dead) return;
                  // The board doubles as the discovery path into the Specialty
                  // layer, so picking a segment also switches to it.
                  p.onSegment(s.id);
                  p.onMode("specialty");
                }}
              >
                <span className={styles.segName}>{s.label}</span>
                <span className={w.spark} aria-hidden>
                  <span className={w.sparkFill} style={{ width: `${((info?.demand ?? 0) / maxDemand) * 100}%` }} />
                </span>
                <span className={styles.segCount}>{markets}</span>
                {/* The 26px count column can only print the number, and a title
                    is not announced on arrow-key focus, so the reason a dimmed
                    row answers nothing joins the row's own name instead. */}
                {dead && <span className={w.srOnly}> — no tracts at critical mass</span>}
              </button>
            );
          })}
        </div>
        <p className={styles.caption}>
          A tract counts as a segment market when the segment is at least {pct(p.result?.params.demand.criticalMass ?? p.params.demand.criticalMass)} of
          its population. Click a tract for details.
        </p>
      </div>

      <div className={styles.foot}>
        <div className={styles.calRow}>
          <button type="button" className={styles.calHandle} onClick={() => document.querySelector<HTMLInputElement>("#cal-strip input")?.focus()}>
            Calibration · {changed === 0 ? "all at defaults" : `${changed} changed`}
          </button>
          {changed > 0 && (
            <button type="button" className={`${styles.calHandle} ${styles.calReset}`} onClick={() => p.onParams(DEFAULT_PARAMS)}>
              Reset
            </button>
          )}
        </div>
        <button type="button" className={`${styles.calHandle} ${styles.aboutLink}`} onClick={p.onShowAbout}>
          About
        </button>
      </div>
    </div>
  );
}

function SearchField({ onSearch, onGoTo, popover, onPopover }: Pick<Props, "onSearch" | "onGoTo" | "popover" | "onPopover">) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<GeoMatch[] | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      const m = await onSearch(q.trim());
      if (m.length === 1) {
        onGoTo({ lon: m[0].lon, lat: m[0].lat, label: m[0].label });
        setMatches(null);
        onPopover(null);
        return;
      }
      setMatches(m);
      onPopover("search");
    } finally {
      setBusy(false);
    }
  };

  const open = popover === "search" && matches !== null;

  return (
    <form onSubmit={submit} className={styles.search}>
      <label className={w.srOnly} htmlFor="place-search">Search a place</label>
      <input id="place-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a place" />
      <button type="submit" className={w.ghost} disabled={busy}>{busy ? "…" : "Go"}</button>
      {open && (
        <div className={`${w.popover} ${styles.matchPop}`}>
          {matches.length === 0 ? (
            <p>Nothing found inside metro Atlanta.</p>
          ) : (
            <ul>
              {matches.map((m) => (
                <li key={`${m.lat},${m.lon}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onGoTo({ lon: m.lon, lat: m.lat, label: m.label });
                      setMatches(null);
                      onPopover(null);
                    }}
                  >
                    {m.label}
                    {m.kind ? <span className={w.muted}> · {m.kind}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
