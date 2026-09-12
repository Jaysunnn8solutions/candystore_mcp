"use client";

import { useRef, useState } from "react";
import type { SimulationResult } from "@/lib/model/simulate";
import type { DistributionCenter } from "@/lib/model/types";
import { SEASON_PEAKS, money } from "../scales";
import styles from "./SupplyDeck.module.css";
import w from "./Widgets.module.css";

/**
 * Weekly supplier orders, one facet per distribution centre. Facets rather than
 * a stack of two centres because the model's binding constraint is a per-DC
 * capacity, and a per-DC rule cannot be drawn across a stack. Both facets share
 * one scale, so no second axis and no misread comparison.
 *
 * Laid out in HTML rather than a stretched SVG so the marks keep their real
 * pixel sizes: at most 24px thick, a 4px rounded top, a 2px surface gap between
 * the mean and the peak headroom above it.
 */
export function ForecastFacets({ forecast, dcs, capacityByDc, compact }: { forecast: SimulationResult; dcs: DistributionCenter[]; capacityByDc: Record<string, number>; compact?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const weeks = forecast.weekly;
  if (weeks.length === 0 || dcs.length === 0) return null;

  const peakMax = Math.max(
    1,
    ...weeks.flatMap((wk) => dcs.map((d) => wk.total[d.id]?.peak ?? 0)),
    ...dcs.map((d) => capacityByDc[d.id] ?? 0)
  );
  const lostMax = Math.max(1, ...weeks.map((wk) => wk.lost));
  const n = weeks.length;
  const hovered = hover != null ? weeks[hover] : null;

  const bands = SEASON_PEAKS.map((s) => {
    const idx = weeks.map((wk, i) => (wk.calendarWeek >= s.from && wk.calendarWeek <= s.to ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) return null;
    return { label: s.label, from: idx[0], to: idx[idx.length - 1] };
  }).filter((b): b is { label: string; from: number; to: number } => b !== null);

  return (
    <div className={styles.facets}>
      <ul className={w.keys}>
        <li><span className={w.keySwatch} style={{ ["--k" as string]: "var(--fill)" }} />mean</li>
        <li><span className={w.keySwatch} style={{ ["--k" as string]: "var(--fill-soft)" }} />peak headroom</li>
        <li><span className={w.keyRule} />cap</li>
        <li><span className={w.keySwatch} style={{ ["--k" as string]: "var(--over)" }} />lost</li>
      </ul>

      <div
        ref={body}
        className={styles.facetBody}
        onPointerMove={(e) => {
          const r = body.current?.getBoundingClientRect();
          if (!r) return;
          setHover(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {dcs.map((d, di) => {
          const cap = capacityByDc[d.id] ?? 0;
          return (
            <div key={d.id} className={styles.facet}>
              <span className={styles.facetName} title={d.name}>{d.name.replace(" DC", "")}</span>
              <div className={styles.plot} role="img" aria-label={`${d.name}: mean and peak weekly orders against a ${money(cap)} weekly cap over ${n} weeks`}>
                {bands.map((b) => (
                  <span key={b.label} className={styles.band} style={{ left: `${(b.from / n) * 100}%`, width: `${((b.to - b.from + 1) / n) * 100}%` }} aria-hidden />
                ))}
                {cap > 0 && <span className={styles.capRule} style={{ bottom: `${(cap / peakMax) * 100}%` }} aria-hidden />}
                {/* Captions after the columns, so a band's name is not painted
                    over by the bars standing inside it. Dropped in the board's
                    narrower chart, where two of them would collide — the axis
                    weeks and the hover tooltip still name the peak there. */}
                {di === 0 && !compact && bands.map((b) => (
                  <em key={b.label} className={styles.bandLabel} style={{ left: `${((b.to + 1) / n) * 100}%` }} aria-hidden>{b.label}</em>
                ))}
                <div className={styles.cols} aria-hidden>
                  {weeks.map((wk, i) => {
                    const t = wk.total[d.id];
                    const mean = t?.mean ?? 0;
                    const peak = Math.max(t?.peak ?? 0, mean);
                    const meanPct = (mean / peakMax) * 100;
                    const headPct = ((peak - mean) / peakMax) * 100;
                    return (
                      <span key={wk.week} className={styles.col} data-hover={i === hover ? "true" : undefined}>
                        {/* Over-cap peaks used to repaint this segment in
                            --over, which is the swatch the legend below gives
                            to "lost" — one colour, two meanings, in one figure.
                            The cap rule is already drawn and a peak crossing it
                            is the honest signal, so the headroom keeps its own
                            hue and --over means lost revenue and nothing else. */}
                        {headPct > 0.3 && (
                          <span className={styles.head} style={{ bottom: `calc(${meanPct}% + 2px)`, height: `${headPct}%` }} />
                        )}
                        <span className={styles.mean} data-top={headPct > 0.3 ? undefined : "true"} style={{ height: `${Math.max(meanPct, 0.8)}%` }} />
                      </span>
                    );
                  })}
                </div>
              </div>
              <span className={styles.capLabel}>cap {money(cap)}</span>
            </div>
          );
        })}

        <div className={styles.lostStrip}>
          <span className={styles.facetName}>lost</span>
          <div className={styles.plot} role="img" aria-label={`Expected revenue lost to outages and caps by week, up to ${money(lostMax)} in the worst week`}>
            <div className={styles.cols} aria-hidden>
              {weeks.map((wk) => (
                <span key={wk.week} className={styles.col}>
                  {/* Floored well above transparent, so the solid swatch in the
                      legend is not brighter than the marks it stands for. */}
                  {wk.lost > 0 && <span className={styles.lostTick} style={{ opacity: 0.55 + 0.45 * (wk.lost / lostMax) }} />}
                </span>
              ))}
            </div>
          </div>
          <span className={styles.capLabel} />
        </div>

        <div className={styles.axis} aria-hidden>
          <span className={styles.facetName} />
          <div className={styles.plot}>
            <div className={styles.cols}>
              {weeks.map((wk, i) => (
                <span key={wk.week} className={styles.col}>{i % 4 === 0 ? wk.calendarWeek : ""}</span>
              ))}
            </div>
          </div>
          <span className={styles.capLabel} />
        </div>

        {hovered && (
          <div className={styles.crosshairTip} style={{ left: `${Math.min(80, ((hover! + 0.5) / n) * 100)}%` }}>
            <strong>week {hovered.calendarWeek}</strong>
            {dcs.map((d) => (
              <span key={d.id}>{d.name.replace(" DC", "")}: {money(hovered.total[d.id]?.mean ?? 0)} mean, ≤{money(hovered.total[d.id]?.peak ?? 0)} peak</span>
            ))}
            <span>lost: {hovered.lost > 500 ? money(hovered.lost) : "–"}</span>
          </div>
        )}
      </div>
    </div>
  );
}
