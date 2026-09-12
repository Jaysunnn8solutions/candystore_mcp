"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { SimulationResult } from "@/lib/model/simulate";
import type { DcResult, DistributionCenter, MarketResult, ScenarioParams } from "@/lib/model/types";
import { DC_COLOR, MONTH_LABELS, MONTH_START_WEEK, meterLevel, money, pct } from "../scales";
import { CalibrationStrip } from "./CalibrationStrip";
import { ForecastFacets } from "./ForecastFacets";
import { YearStrip } from "./YearStrip";
import type { ForecastDraft, ForecastRequest, PopoverId } from "./types";
import { useOverflowWarn } from "./useOverflowWarn";
import { Meter } from "./widgets/Meter";
import { Segmented } from "./widgets/Segmented";
import { Stepper } from "./widgets/Stepper";
import styles from "./SupplyDeck.module.css";
import w from "./Widgets.module.css";

export type ForecastView = "chart" | "table";

/**
 * The tightest capacity row anywhere. Addressed by id rather than a ref threaded
 * through three components, and focusable, so "lost to caps" and the plan's
 * capacity note land on the control that fixes them.
 */
export const WORST_METER_ID = "worst-meter";

interface Props {
  dcs: DistributionCenter[];
  result: MarketResult | null;
  labels: Record<string, string>;
  capacityScale: Array<{ dc: string; category: string; factor: number }>;
  onCapacityScale: (dc: string, category: string, factor: number) => void;
  forecastDraft: ForecastDraft;
  onForecastDraft: (d: ForecastDraft) => void;
  onForecast: (r: ForecastRequest) => Promise<void>;
  forecast: SimulationResult | null;
  forecasting: boolean;
  forecastView: ForecastView;
  onForecastView: (v: ForecastView) => void;
  params: ScenarioParams;
  onParams: (p: ScenarioParams) => void;
  activeDc: string;
  onActiveDc: (id: string) => void;
  popover: PopoverId;
  onPopover: (p: PopoverId) => void;
  /** How many meters each card shows before the disclosure. */
  visibleMeters: number;
}

interface Row {
  cat: string;
  name: string;
  demand: number;
  capacity: number;
}

/** Rows sorted by utilization, because the binding constraint is the point. */
function rowsFor(r: DcResult | undefined, labels: Record<string, string>): Row[] {
  if (!r) return [];
  return Object.entries(r.weeklyDemand)
    .filter(([, v]) => v > 0)
    .map(([cat, demand]) => ({
      cat,
      name: cat === "traditional" ? "Traditional" : labels[cat.replace("specialty:", "")] ?? cat,
      demand,
      capacity: r.capacity[cat] ?? 0,
    }))
    .sort((a, b) => b.demand / Math.max(1, b.capacity) - a.demand / Math.max(1, a.capacity));
}

export function SupplyDeck(p: Props) {
  const deck = useRef<HTMLDivElement>(null);
  useOverflowWarn(deck, "supply deck");

  const many = p.dcs.length > 2;
  const shown = many ? p.dcs.filter((d) => d.id === p.activeDc) : p.dcs;
  const allRows = useMemo(
    () => new Map(p.dcs.map((d) => [d.id, rowsFor(p.result?.dcs.find((x) => x.id === d.id), p.labels)])),
    [p.dcs, p.result, p.labels]
  );

  // The tightest row anywhere, so "lost to caps" leads to its own remedy.
  const worstId = useMemo(() => {
    let best: { id: string; u: number } | null = null;
    for (const [dc, rows] of allRows) {
      for (const r of rows) {
        const u = r.demand / Math.max(1, r.capacity);
        if (!best || u > best.u) best = { id: `${dc}:${r.cat}`, u };
      }
    }
    return best?.id ?? null;
  }, [allRows]);

  return (
    <div ref={deck} className={styles.deck}>
      <div className={styles.deckTop} data-many={many ? "true" : undefined}>
        {many && (
          <div className={styles.dcCard}>
            <Segmented
              label="Distribution center"
              options={p.dcs.map((d) => ({ id: d.id, label: d.name.replace(" DC", ""), badge: String(p.capacityScale.filter((c) => c.dc === d.id).length || "") }))}
              value={p.activeDc}
              onChange={p.onActiveDc}
              size="sm"
            />
          </div>
        )}
        {shown.map((d) => (
          <DcCard
            key={d.id}
            dc={d}
            rows={allRows.get(d.id) ?? []}
            capacityScale={p.capacityScale}
            onCapacityScale={p.onCapacityScale}
            popover={p.popover}
            onPopover={p.onPopover}
            worstId={worstId}
            visibleMeters={p.visibleMeters}
          />
        ))}

        <div className={styles.forecast}>
          <div className={styles.forecastControls}>
            <div className={styles.fcTop}>
              <h2 className={w.h2}>Forecast</h2>
              <Segmented
                label="Forecast horizon"
                options={[13, 26, 39, 52].map((n) => ({ id: String(n), label: `${n}` }))}
                value={String(p.forecastDraft.weeks)}
                onChange={(v) => p.onForecastDraft({ ...p.forecastDraft, weeks: Number(v) })}
                size="sm"
              />
            </div>
            <YearStrip
              startWeek={p.forecastDraft.startWeek}
              weeks={p.forecastDraft.weeks}
              onStartWeek={(sw) => p.onForecastDraft({ ...p.forecastDraft, startWeek: sw })}
            />
            <div className={styles.fcFields}>
              <label htmlFor="fc-weeks">weeks</label>
              <Stepper id="fc-weeks" label="forecast length in weeks" value={p.forecastDraft.weeks} onChange={(v) => p.onForecastDraft({ ...p.forecastDraft, weeks: v })} min={4} max={52} step={1} size="sm" />
              {/* These two keep their visible label as the field's name: the
                  long form the ± buttons want does not contain the words on
                  screen, and a name that omits them is unsayable. */}
              <label htmlFor="fc-start">from week</label>
              <Stepper id="fc-start" label="starting calendar week" value={p.forecastDraft.startWeek} onChange={(v) => p.onForecastDraft({ ...p.forecastDraft, startWeek: v })} min={1} max={52} step={1} size="sm" labelled />
              <label htmlFor="fc-outage">outage / wk</label>
              <Stepper id="fc-outage" label="weekly outage probability in percent" value={p.forecastDraft.outage} onChange={(v) => p.onForecastDraft({ ...p.forecastDraft, outage: v })} min={0} max={50} step={1} suffix="%" size="sm" labelled />
            </div>
            <div className={styles.fcRow}>
              <button
                type="button"
                className={`${w.ghost} ${styles.runButton}`}
                disabled={p.forecasting}
                onClick={() => p.onForecast({ weeks: p.forecastDraft.weeks, startWeek: p.forecastDraft.startWeek, outageProbability: p.forecastDraft.outage / 100 })}
              >
                {p.forecasting ? "Simulating…" : "Run forecast"}
              </button>
            </div>
          </div>

          <ForecastPanel {...p} />
        </div>
      </div>

      <CalibrationStrip params={p.params} onParams={p.onParams} />
    </div>
  );
}

function ForecastPanel(p: Props) {
  const capacityByDc = useMemo(
    () => Object.fromEntries(p.dcs.map((d) => [d.id, Object.values(p.result?.dcs.find((x) => x.id === d.id)?.capacity ?? d.capacity).reduce((a, b) => a + b, 0)])),
    [p.dcs, p.result]
  );

  if (!p.forecast) {
    // A region that jumps on every completed run is worse than stable
    // geometry, so the empty state is designed rather than collapsed.
    const startMonth = MONTH_LABELS[MONTH_START_WEEK.reduce((best, wk, i) => (wk <= p.forecastDraft.startWeek ? i : best), 0)];
    return (
      <div className={styles.forecastPanel}>
        <p className={styles.empty}>
          Not run · {p.forecastDraft.weeks} weeks from week {p.forecastDraft.startWeek} ({startMonth}), {p.forecastDraft.outage}% chance a centre goes out in any week.
        </p>
        <YearStrip startWeek={p.forecastDraft.startWeek} weeks={p.forecastDraft.weeks} readOnly />
        <p className={styles.empty}>
          Run to see mean and peak weekly orders per centre against each centre&apos;s cap, and what outages and caps are
          expected to cost. Weeks 42–44 are the Halloween run-up; 49–52 Christmas.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.forecastPanel}>
      <div className={styles.forecastHead}>
        <p className={styles.verdict}>
          {money(p.forecast.totals.horizonRevenue)} of orders over {p.forecast.options.weeks} weeks; expected {money(p.forecast.totals.expectedLost)} lost to outages and caps.
        </p>
        <Segmented
          label="Forecast view"
          options={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]}
          value={p.forecastView}
          onChange={(v) => p.onForecastView(v as ForecastView)}
          size="sm"
          className={styles.viewSwitch}
        />
      </div>
      {p.forecastView === "chart" ? (
        <ForecastFacets forecast={p.forecast} dcs={p.dcs} capacityByDc={capacityByDc} />
      ) : (
        <WeeklyTable forecast={p.forecast} dcs={p.dcs} />
      )}
    </div>
  );
}

export function WeeklyTable({ forecast, dcs }: { forecast: SimulationResult; dcs: DistributionCenter[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={w.srOnly}>
          Mean weekly orders per distribution center, with the highest simulated run to plan capacity against, and revenue lost each week.
        </caption>
        <thead>
          <tr>
            <th>Wk</th>
            {dcs.map((d) => <th key={d.id}>{d.name.replace(" DC", "")}</th>)}
            <th>Lost</th>
          </tr>
        </thead>
        <tbody>
          {forecast.weekly.map((wk) => (
            <tr key={wk.week}>
              <td>{wk.calendarWeek}</td>
              {dcs.map((d) => {
                // Per-category quantiles do not add up to a total quantile, so the
                // simulation reports figures summed per run for the whole center.
                const t = wk.total[d.id];
                return <td key={d.id}>{money(t?.mean ?? 0)}<span className={w.muted}> ≤{money(t?.peak ?? 0)}</span></td>;
              })}
              <td>{wk.lost > 500 ? money(wk.lost) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface CardProps {
  dc: DistributionCenter;
  rows: Row[];
  capacityScale: Array<{ dc: string; category: string; factor: number }>;
  onCapacityScale: (dc: string, category: string, factor: number) => void;
  popover: PopoverId;
  onPopover: (p: PopoverId) => void;
  worstId: string | null;
  visibleMeters: number;
}

const PILLS = { ok: null, tight: "TIGHT", over: "CAPPED" } as const;

export function DcCard({ dc, rows, capacityScale, onCapacityScale, popover, onPopover, worstId, visibleMeters, all }: CardProps & { all?: boolean }) {
  const card = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLElement>(null);
  // The deck clips its own overflow so the cards stay inside it, so the full
  // list has to leave the deck entirely to be seen.
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null);
  useOverflowWarn(card, `dc card ${dc.id}`);
  const open = popover === `cap:${dc.id}`;

  /*
   * Portaled to the body, so its tab position is the end of the document rather
   * than beside the disclosure that opened it: focus has to be moved in by
   * hand. Dismissal matches SharePopover — Esc from the dashboard's one key
   * listener, its own ×, or a pointerdown strictly outside it. And the position
   * is captured from the anchor at click time, so it has to be recaptured on a
   * resize or it detaches from the card it belongs to.
   */
  useEffect(() => {
    if (!open) return;
    head.current?.focus();
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setAt({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !anchor.current?.contains(t)) onPopover(null);
    };
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, onPopover]);
  const factorFor = (category: string) => capacityScale.find((c) => c.dc === dc.id && c.category === category)?.factor ?? 1;
  const overrides = capacityScale.filter((c) => c.dc === dc.id);
  const shown = all ? rows : rows.slice(0, visibleMeters);
  const hidden = all ? [] : rows.slice(visibleMeters);
  const worstHidden = hidden.reduce<Row | null>((best, r) => (!best || r.demand / Math.max(1, r.capacity) > best.demand / Math.max(1, best.capacity) ? r : best), null);
  const hiddenLevel = worstHidden ? meterLevel(worstHidden.demand, worstHidden.capacity) : "ok";

  return (
    <div ref={anchor} className={styles.dcAnchor}>
      <div ref={card} className={styles.dcCard}>
        <div className={styles.dcHead}>
          <span className={w.dot} style={{ ["--dot" as string]: DC_COLOR } as CSSProperties} aria-hidden />
          <span className={styles.dcName} title={dc.name}>{dc.name}</span>
          {overrides.length > 0 && (
            <button
              type="button"
              className={w.iconBtn}
              aria-label={`Reset ${dc.name} capacity to normal`}
              title="Reset this centre's capacity"
              // Factor 1 is how the dashboard deletes an override, so this
              // clears the centre out of the URL for free.
              onClick={() => overrides.forEach((c) => onCapacityScale(dc.id, c.category, 1))}
            >
              ↺
            </button>
          )}
        </div>

        {(["traditional", "specialty:*"] as const).map((cat) => (
          <div key={cat} className={styles.capRow}>
            <label htmlFor={`cap-${dc.id}-${cat}`}>{cat === "traditional" ? "Traditional" : "Specialty"}</label>
            <Stepper
              id={`cap-${dc.id}-${cat}`}
              label={`${cat === "traditional" ? "traditional" : "specialty"} capacity at ${dc.name}`}
              value={factorFor(cat)}
              onChange={(v) => onCapacityScale(dc.id, cat, v)}
              min={0}
              max={3}
              step={0.1}
              prefix="×"
              size="sm"
              detent={1}
              neutral={factorFor(cat) === 1}
            />
          </div>
        ))}

        <ul className={all ? styles.boardMeters : styles.meters}>
          {shown.map((r) => (
            <Meter key={r.cat} name={r.name} demand={r.demand} capacity={r.capacity} id={!all && worstId === `${dc.id}:${r.cat}` ? WORST_METER_ID : undefined} />
          ))}
        </ul>

        {hidden.length > 0 && worstHidden && (
          <button
            type="button"
            className={styles.moreRow}
            aria-expanded={open}
            aria-controls={`cap-${dc.id}`}
            onClick={() => {
              if (open) return onPopover(null);
              const r = anchor.current?.getBoundingClientRect();
              if (r) setAt({ left: r.left, bottom: window.innerHeight - r.top + 6 });
              onPopover(`cap:${dc.id}`);
            }}
          >
            +{hidden.length} more · worst {pct(worstHidden.demand / Math.max(1, worstHidden.capacity))}
            {PILLS[hiddenLevel] && <em className={`${w.flag} ${hiddenLevel === "over" ? w.flagPriority : w.flagWatch}`}>{PILLS[hiddenLevel]}</em>}
          </button>
        )}
      </div>

      {open && at && createPortal(
        <div ref={pop} id={`cap-${dc.id}`} className={`${w.popover} ${styles.capPop}`} role="dialog" aria-label={`${dc.name} — every capacity category`} style={{ left: at.left, bottom: at.bottom }}>
          <div className={w.popHead}>
            <strong ref={head} tabIndex={-1}>{dc.name} · every category</strong>
            <span style={{ flex: 1 }} />
            <button type="button" className={w.iconBtn} aria-label="Close" onClick={() => onPopover(null)}>×</button>
          </div>
          <ul>
            {rows.map((r) => <Meter key={r.cat} name={r.name} demand={r.demand} capacity={r.capacity} />)}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}

/**
 * Show everything: the capacity rows each card folds away, and the weekly table
 * beside the chart. Nothing else, because every other control is already on
 * screen by default.
 */
export function BoardPanel(p: Props) {
  const many = p.dcs.length > 2;
  const shown = many ? p.dcs.filter((d) => d.id === p.activeDc) : p.dcs;
  const capacityByDc = useMemo(
    () => Object.fromEntries(p.dcs.map((d) => [d.id, Object.values(p.result?.dcs.find((x) => x.id === d.id)?.capacity ?? d.capacity).reduce((a, b) => a + b, 0)])),
    [p.dcs, p.result]
  );

  return (
    <div className={styles.boardGrid} data-many={many ? "true" : undefined}>
      {many && (
        <div className={styles.boardCol}>
          <Segmented
            label="Distribution center"
            options={p.dcs.map((d) => ({ id: d.id, label: d.name.replace(" DC", "") }))}
            value={p.activeDc}
            onChange={p.onActiveDc}
            size="sm"
          />
        </div>
      )}
      {shown.map((d) => (
        <div key={d.id} className={styles.boardCol}>
          <DcCard
            dc={d}
            rows={rowsFor(p.result?.dcs.find((x) => x.id === d.id), p.labels)}
            capacityScale={p.capacityScale}
            onCapacityScale={p.onCapacityScale}
            popover={p.popover}
            onPopover={p.onPopover}
            worstId={null}
            visibleMeters={p.visibleMeters}
            all
          />
        </div>
      ))}
      <div className={styles.boardCol}>
        <h2 className={w.h2}>Forecast</h2>
        {p.forecast ? (
          <div className={styles.boardForecast}>
            <ForecastFacets forecast={p.forecast} dcs={p.dcs} capacityByDc={capacityByDc} compact />
            <WeeklyTable forecast={p.forecast} dcs={p.dcs} />
          </div>
        ) : (
          <p className={styles.empty}>No forecast yet. Run one from the deck to fill this column with the chart and the weekly table side by side.</p>
        )}
      </div>
    </div>
  );
}

export { rowsFor };
