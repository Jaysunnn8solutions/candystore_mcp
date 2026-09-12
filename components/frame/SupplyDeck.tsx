"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { SimulationResult } from "@/lib/model/simulate";
import type { DcResult, DistributionCenter, MarketResult, ScenarioParams } from "@/lib/model/types";
import { DC_COLOR, MONTH_LABELS, MONTH_START_WEEK, meterLevel, money } from "../scales";
import { CalibrationStrip } from "./CalibrationStrip";
import { ForecastFacets } from "./ForecastFacets";
import { YearStrip } from "./YearStrip";
import type { ForecastDraft, ForecastRequest, PopoverId } from "./types";
import { useOverflowWarn } from "./useOverflowWarn";
import { Meter, meterFigure } from "./widgets/Meter";
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
  /**
   * Total weekly capacity per centre as it stood when that forecast ran, null
   * until one has. The chart's bars only move when a run completes, so its cap
   * rule and its scale have to come from the same moment — see capsFor().
   */
  forecastCaps?: Record<string, number> | null;
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

/**
 * The weekly cap the forecast chart draws its rule, its label and its scale
 * from. It has to be the capacity the run used: the bars only change when a
 * forecast completes, so reading the live result instead rescaled the whole
 * chart under old bars on the next capacity edit — a ×2.0 stepper turned a
 * capped simulation into comfortable headroom without touching a bar. Falls
 * back to the live figure for a centre the recorded run does not name.
 */
function capsFor(dcs: DistributionCenter[], result: MarketResult | null, ran: Record<string, number> | null | undefined): Record<string, number> {
  return Object.fromEntries(
    dcs.map((d) => [d.id, ran?.[d.id] ?? Object.values(result?.dcs.find((x) => x.id === d.id)?.capacity ?? d.capacity).reduce((a, b) => a + b, 0)])
  );
}

function ForecastPanel(p: Props) {
  const capacityByDc = useMemo(() => capsFor(p.dcs, p.result, p.forecastCaps), [p.dcs, p.result, p.forecastCaps]);

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
        {/* Every number here names the run's own settings, never the draft
            beside it. The steppers to the left are the next request, and
            changing them no longer discards this run, so the two can differ —
            which makes it this line's job to say which one it is describing. */}
        <p className={styles.verdict}>
          {money(p.forecast.totals.horizonRevenue)} of orders over {p.forecast.options.weeks} weeks from week {p.forecast.options.startWeek}, at {Math.round(p.forecast.options.outageProbability * 100)}% outage; expected {money(p.forecast.totals.expectedLost)} lost to outages and caps.
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

/**
 * .capPop's width, so the placement can keep the box inside the window without
 * measuring it. On a window too narrow for 300px the rule there is
 * `100vw - 16px`, and the clamp below already resolves to the same 8px margin.
 */
const CAP_POP_W = 300;

interface Spot {
  left: number;
  top?: number;
  bottom?: number;
  /** The room the chosen side has, which is all the height the box may take. */
  room: number;
}

/**
 * Where the capacity list goes. It used to set `left` and `bottom` only, which
 * is safe while the deck is pinned to the bottom of the frame but not below
 * 1000px, where the deck is the last block of a long scrolling page: anchored
 * to a card near the top of the screen, the box grew straight up past the top
 * of the window and took its heading and its close button with it. So it opens
 * on whichever side has the room and never asks for more height than that side
 * has.
 */
function place(r: DOMRect, width: number): Spot {
  const gap = 6;
  const edge = 8;
  const above = r.top - gap - edge;
  const below = window.innerHeight - r.bottom - gap - edge;
  const left = Math.max(edge, Math.min(r.left, window.innerWidth - width - edge));
  return above >= below
    ? { left, bottom: window.innerHeight - r.top + gap, room: Math.max(0, above) }
    : { left, top: r.bottom + gap, room: Math.max(0, below) };
}

export function DcCard({ dc, rows, capacityScale, onCapacityScale, popover, onPopover, worstId, visibleMeters, all }: CardProps & { all?: boolean }) {
  const card = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLElement>(null);
  // The deck clips its own overflow so the cards stay inside it, so the full
  // list has to leave the deck entirely to be seen.
  const [at, setAt] = useState<Spot | null>(null);
  useOverflowWarn(card, `dc card ${dc.id}`);
  // Board mode mounts a second live copy of every card while the deck's is
  // still up, so every id here carries a namespace. Two identical
  // `cap-dc-east-traditional` fields meant the board's label focused the deck's
  // stepper, and the board copy's popover effect ran against the deck's open
  // popover and closed it on the next click. The board copy folds nothing away,
  // so its own key is never opened.
  const ns = all ? `board-${dc.id}` : dc.id;
  const open = popover === `cap:${ns}`;

  /*
   * Portaled to the body, so its tab position is the end of the document rather
   * than beside the disclosure that opened it: focus has to be moved in by
   * hand, and handed back by hand. Every dismissal path unmounts the portal
   * while focus is inside it, which drops focus to <body> and restarts the next
   * Tab at the top of the document. Dismissal matches SharePopover — Esc from
   * the dashboard's one key listener, its own ×, or a pointerdown strictly
   * outside it. And the position is captured from the anchor at click time, so
   * it has to be recaptured on a resize or a scroll or it detaches from the card
   * it belongs to; below 1000px the page itself is what scrolls.
   */
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    // The portal is already mounted by the time this runs, and React keeps the
    // same node across re-renders, so the cleanup can hold it directly rather
    // than read a ref that may have been cleared by then.
    const box = pop.current;
    head.current?.focus();
    const reposition = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setAt(place(r, CAP_POP_W));
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !anchor.current?.contains(t)) onPopover(null);
    };
    // Focus mode collapses the deck and marks it inert, but this list hangs off
    // the body, where neither reaches it: it stayed on screen over the map the
    // frame had just cleared, clickable and still in the tab order. The frame's
    // own switch is the attribute its stylesheet already collapses on.
    const frameRoot = anchor.current?.closest("[data-app-frame]");
    const watch = new MutationObserver(() => {
      if (frameRoot?.getAttribute("data-focus") === "true") onPopover(null);
    });
    if (frameRoot) watch.observe(frameRoot, { attributes: true, attributeFilter: ["data-focus"] });
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", onDown);
      watch.disconnect();
      // Only when focus is still ours to give back: a pointerdown outside has
      // already put it on something the user chose.
      const now = document.activeElement;
      if (!now || now === document.body || box?.contains(now)) before?.focus();
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
            <label htmlFor={`cap-${ns}-${cat}`}>{cat === "traditional" ? "Traditional" : "Specialty"}</label>
            <Stepper
              id={`cap-${ns}-${cat}`}
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
            aria-controls={`cap-${ns}`}
            onClick={() => {
              if (open) return onPopover(null);
              const r = anchor.current?.getBoundingClientRect();
              if (r) setAt(place(r, CAP_POP_W));
              onPopover(`cap:${ns}`);
            }}
          >
            {/* The figure the meters print, not demand over Math.max(1,
                capacity): that guard belongs in the sort key, where it only
                orders rows. Printed, it divided weekly dollars by $1 and turned
                a category stepped to ×0 into "worst 240000%" — beside a CAPPED
                pill computed from the honest rule. */}
            +{hidden.length} more · worst {meterFigure(worstHidden.demand, worstHidden.capacity)}
            {PILLS[hiddenLevel] && <em className={`${w.flag} ${hiddenLevel === "over" ? w.flagPriority : w.flagWatch}`}>{PILLS[hiddenLevel]}</em>}
          </button>
        )}
      </div>

      {open && at && createPortal(
        <div
          ref={pop}
          id={`cap-${ns}`}
          className={`${w.popover} ${styles.capPop}`}
          role="dialog"
          aria-label={`${dc.name} — every capacity category`}
          style={{ left: at.left, top: at.top, bottom: at.bottom, ["--room" as string]: `${at.room}px` } as CSSProperties}
        >
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
  const capacityByDc = useMemo(() => capsFor(p.dcs, p.result, p.forecastCaps), [p.dcs, p.result, p.forecastCaps]);

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
