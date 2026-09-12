"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_VERSION } from "@/lib/api-version";
import type { DataManifest, TractCollection } from "@/lib/data/load";
import type { GeoMatch } from "@/lib/geocode";
import type { SitePlan } from "@/lib/model/optimizer";
import { DEFAULT_STORE_COSTS } from "@/lib/model/optimizer-defaults";
import { flattenParams } from "@/lib/model/params";
import type { SimulationResult } from "@/lib/model/simulate";
import type { Competitor, DistributionCenter, MarketResult, ScenarioParams, Store, StoreType } from "@/lib/model/types";
import { viewToClipboardText, type ViewState } from "@/lib/view-state";
import { download, toCsv } from "./exportData";
import { DecisionRail } from "./frame/DecisionRail";
import { LensRail } from "./frame/LensRail";
import { MapOverlays } from "./frame/MapOverlays";
import { DroppedNotice, OutcomeBar } from "./frame/OutcomeBar";
import { remainderNote } from "./frame/plan-text";
import { BoardPanel, SupplyDeck, WORST_METER_ID, type ForecastView } from "./frame/SupplyDeck";
import type { BudgetDraft, BudgetRequest, ForecastDraft, ForecastRequest, PopoverId } from "./frame/types";
import type { MapPoint } from "./MarketMap";
import { quintiles, storeColors, type Mode } from "./scales";
import { currentLink, readHashFull, writeHash } from "./urlState";
import frame from "./frame/AppFrame.module.css";
import w from "./frame/Widgets.module.css";
import styles from "./Dashboard.module.css";

const MarketMap = dynamic(() => import("./MarketMap"), { ssr: false, loading: () => <div className={styles.mapLoading}>Loading map…</div> });

interface StaticData {
  stores: Store[];
  dcs: DistributionCenter[];
  competitors: Competitor[];
  manifest: DataManifest;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    /*
     * The routes send `issues` beside `error` (lib/api.ts), and the model's own
     * messages are specific: 'Unknown category "specialty". Known: traditional,
     * specialty:latam, …, *, specialty:*'. Only `error` was read, so a link
     * carrying one bad id produced the banner "Invalid parameters" and nothing
     * else — the server knew exactly which field was wrong and the screen would
     * not say. The path names the field, because an id is meaningless without it.
     */
    const body = (await r.json().catch(() => ({}))) as { error?: string; issues?: Array<{ message?: string; path?: Array<string | number> }> };
    const first = body.issues?.[0];
    const where = first?.path?.length ? `${first.path.join(".")}: ` : "";
    const detail = first?.message ? `${where}${first.message}` : "";
    throw new Error([body.error ?? `HTTP ${r.status}`, detail].filter(Boolean).join(" — "));
  }
  return r.json() as Promise<T>;
}

function scenarioBody(params: ScenarioParams, view: Pick<ViewState, "scenario" | "closed" | "capacityScale">, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    ...flattenParams(params),
    add: view.scenario.map((s) => ({ type: s.type, lon: s.lon, lat: s.lat, size: s.size, segments: s.segments, name: s.name })),
    remove: view.closed,
    capacityScale: view.capacityScale,
    ...extra,
  });
}

/**
 * A run is only current while the market it simulated is still the market on
 * screen. That is the scenario body: stores, closures, capacity overrides and
 * the model parameters. Change any of those and the run is a simulation of a
 * different chain, so it is withheld.
 *
 * The horizon, start week and outage rate are deliberately NOT in the key. They
 * are the draft of the next request, not a description of this one, and every
 * surface that shows a run reads its length and settings from the run's own
 * `options`. Keying on them meant nudging the weeks stepper — which sits inches
 * from the chart, and is exactly how someone compares two horizons — threw away
 * a completed run and replaced it with a "Not run" panel, which was also the
 * one sentence that was untrue at that moment.
 */
function forecastKeyOf(inputs: string): string {
  return inputs;
}

/**
 * Weekly capacity per center, summed over categories, as the server computes it
 * — this mirrors effectiveDcs in lib/model/market.ts: base capacity times every
 * capacityScale factor that matches the category, wildcards included. Taken from
 * the overrides rather than from the market result on screen because that result
 * can still be the one before the edit a forecast run already carried, and a cap
 * line drawn from the wrong scenario is the whole defect this closes.
 */
function capacityTotals(dcs: DistributionCenter[], capacityScale: ViewState["capacityScale"]): Record<string, number> {
  return Object.fromEntries(
    dcs.map((d) => {
      let total = 0;
      for (const [cat, base] of Object.entries(d.capacity)) {
        let cap = base;
        for (const s of capacityScale) {
          const match = s.dc === d.id && (s.category === "*" || s.category === cat || (s.category === "specialty:*" && cat.startsWith("specialty:")));
          if (match) cap *= s.factor;
        }
        total += cap;
      }
      return [d.id, total];
    })
  );
}

/**
 * The server re-ids added stores by their position in the `add` array
 * (`new-0`, `new-1`, …), so the client has to use the same positional ids or
 * every lookup by store id into the returned result misses. Renumbering on
 * removal too keeps them aligned with the next request body.
 */
function renumber(list: Store[]): Store[] {
  return list.map((s, i) => (s.id === `new-${i}` ? s : { ...s, id: `new-${i}` }));
}

function useDebouncedFetch<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>, delay: number, onDone: (v: T | null, err: string | null) => void) {
  const latest = useRef(0);
  useEffect(() => {
    if (key === null) return;
    const id = ++latest.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetcher(controller.signal)
        .then((v) => id === latest.current && onDone(v, null))
        .catch((e: unknown) => {
          if (id === latest.current && !(e instanceof DOMException && e.name === "AbortError")) onDone(null, e instanceof Error ? e.message : String(e));
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Tracks a media query, so a breakpoint can gate behavior and not only CSS. */
function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return on;
}

export function Dashboard() {
  const [initial] = useState(readHashFull);
  const [mode, setMode] = useState<Mode>(initial.view.mode);
  const [segment, setSegment] = useState(initial.view.segment);
  const [params, setParams] = useState<ScenarioParams>(initial.view.params);
  // Renumbered on the way in as well, so a link whose store ids the parser had
  // to shift cannot seed the state out of step with the request body.
  const [scenario, setScenario] = useState<Store[]>(() => renumber(initial.view.scenario));
  const [closed, setClosed] = useState<string[]>(initial.view.closed);
  const [capacityScale, setCapacityScale] = useState(initial.view.capacityScale);
  const [selected, setSelected] = useState<string | null>(initial.view.selected);
  const [showCompetitors, setShowCompetitors] = useState(initial.view.showCompetitors);
  const [placing, setPlacing] = useState<StoreType | null>(null);
  const [searchMarker, setSearchMarker] = useState<MapPoint | null>(null);
  const [flyTo, setFlyTo] = useState<MapPoint | null>(null);

  const [tracts, setTracts] = useState<TractCollection | null>(null);
  const [staticData, setStaticData] = useState<StaticData | null>(null);
  const [baseline, setBaseline] = useState<MarketResult | null>(null);
  const [result, setResult] = useState<{ key: string; value: MarketResult | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The plan and the forecast are keyed on the inputs they were computed from,
  // exactly as `result` is below. Neither used to be, so a plan went on naming
  // stores the roster no longer held and a forecast went on being drawn beside
  // outcome figures from a different scenario, with nothing on screen saying so.
  // `caps` is the capacity that run was posted with; the chart's cap line has to
  // come from there and not from the live result, which moves under it.
  const [plan, setPlan] = useState<{ key: string; value: SitePlan } | null>(null);
  const [planning, setPlanning] = useState(false);
  const [forecast, setForecast] = useState<{ key: string; value: SimulationResult; caps: Record<string, number> } | null>(null);
  const [forecasting, setForecasting] = useState(false);

  // Layout and draft state. None of it reaches the hash, and none of it may
  // join the writeHash dependency list below: a layout toggle must never
  // rewrite the URL, which is how a view reaches the MCP tools.
  const [boardOpen, setBoardOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [forecastView, setForecastView] = useState<ForecastView>("chart");
  const [popover, setPopover] = useState<PopoverId>(null);
  const [dropped, setDropped] = useState<string[]>(initial.dropped);
  const [activeDc, setActiveDc] = useState("");
  const [budget, setBudget] = useState<BudgetDraft>({
    budgetM: 10,
    costG: DEFAULT_STORE_COSTS.general / 1e6,
    costS: DEFAULT_STORE_COSTS.specialty / 1e6,
    general: true,
    specialty: true,
  });
  const [forecastDraft, setForecastDraft] = useState<ForecastDraft>({ weeks: 26, startWeek: 36, outage: 3 });

  const wide = useMediaQuery("(min-width: 1000px)");
  const roomy = useMediaQuery("(min-width: 1101px)");
  // A short window cuts the deck, so a third meter row per center would not fit.
  const tall = useMediaQuery("(min-height: 761px)");

  const scenarioActive = scenario.length > 0 || closed.length > 0 || capacityScale.length > 0;
  const view: ViewState = { mode, segment, params, scenario, closed, capacityScale, selected, showCompetitors };

  useEffect(() => {
    writeHash(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, segment, params, scenario, closed, capacityScale, selected, showCompetitors]);

  useEffect(() => {
    let canceled = false;
    Promise.all([getJson<TractCollection>(`/api/tracts?v=${API_VERSION}`), getJson<StaticData>(`/api/static?v=${API_VERSION}`)])
      .then(([t, s]) => {
        if (canceled) return;
        setTracts(t);
        setStaticData(s);
      })
      .catch((e: unknown) => !canceled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      canceled = true;
    };
  }, []);

  // Baseline (parameters only).
  const baselineKey = JSON.stringify(flattenParams(params));
  useDebouncedFetch(
    baselineKey,
    useCallback((signal: AbortSignal) => {
      setLoading(true);
      return getJson<MarketResult>("/api/market", { method: "POST", headers: { "Content-Type": "application/json" }, body: baselineKey, signal });
    }, [baselineKey]),
    250,
    useCallback((v: MarketResult | null, err: string | null) => {
      if (v) {
        setBaseline(v);
        setVersion((n) => n + 1);
        setError(null);
      } else if (err) setError(err);
      setLoading(false);
    }, [])
  );

  // Scenario. One string stands for "the inputs any run was computed from", so
  // the scenario fetch, the plan and the forecast all judge staleness the same
  // way. Only the fetch is skipped when nothing is overridden.
  const inputsKey = scenarioBody(params, { scenario, closed, capacityScale });
  const scenarioKey = scenarioActive ? inputsKey : null;
  useDebouncedFetch(
    scenarioKey,
    useCallback((signal: AbortSignal) => getJson<MarketResult>("/api/market", { method: "POST", headers: { "Content-Type": "application/json" }, body: scenarioKey ?? "{}", signal }), [scenarioKey]),
    250,
    useCallback((v: MarketResult | null, err: string | null) => {
      if (!scenarioKey) return;
      // Recorded even when it failed, so the request is not left looking pending.
      setResult({ key: scenarioKey, value: v });
      if (v) setVersion((n) => n + 1);
      else if (err) setError(err);
    }, [scenarioKey])
  );

  // A scenario result only describes the inputs it was computed from, so until
  // it catches up fall back to the baseline rather than present two different
  // parameter sets as a before and after. The baseline is debounced too, so in
  // the moment after a slider moves it is one parameter set behind; both
  // windows are marked busy, and nothing is compared across them.
  const scenarioShown = scenarioKey !== null && result?.key === scenarioKey ? result.value : null;
  const shown = scenarioShown ?? baseline;
  const busy = loading || (scenarioKey !== null && result?.key !== scenarioKey);
  // Same rule for the two runs the user starts by hand. A plan whose key no
  // longer matches is describing a roster that has since changed, and a forecast
  // whose key no longer matches is a simulation of different inputs, so both are
  // withheld rather than shown beside figures that disagree with them. The deck
  // already has a designed "Not run" state that says what the current settings
  // would simulate, which is the honest thing to show in their place.
  const planShown = plan?.key === inputsKey ? plan.value : null;
  const forecastRun = forecast?.key === forecastKeyOf(inputsKey) ? forecast : null;
  const stores = useMemo(() => {
    const base = (staticData?.stores ?? []).filter((s) => !closed.includes(s.id));
    return [...base, ...scenario];
  }, [staticData, closed, scenario]);
  // Trade-area colors are assigned over every store the data knows about,
  // closed ones included, so a closure does not renumber the survivors. Built
  // here rather than inside the map and the legend, so the two cannot disagree.
  const storeSlots = useMemo(() => storeColors([...(staticData?.stores ?? []), ...scenario]), [staticData, scenario]);
  const segments = useMemo(() => staticData?.manifest.segments ?? [], [staticData]);
  const segmentLabels = useMemo(() => Object.fromEntries(segments.map((s) => [s.id, s.label])), [segments]);

  const breaks = useMemo(() => {
    const all = shown?.tracts ?? [];
    if (mode === "specialty") return quintiles(all.map((t) => t.byCategory[`specialty:${segment}`] ?? 0));
    if (mode === "uncaptured") return quintiles(all.map((t) => t.total * (1 - (t.total > 0 ? Object.entries(t.byCategory).reduce((s, [c, v]) => s + v * (t.captured[c] ?? 0), 0) / t.total : 0))));
    return quintiles(all.map((t) => t.total));
  }, [shown, mode, segment]);

  const selectedInfo = useMemo(() => {
    if (!selected || !tracts) return null;
    const f = tracts.features.find((x) => x.properties.geoid === selected);
    if (!f) return null;
    return { props: f.properties, result: shown?.tracts.find((t) => t.geoid === selected) };
  }, [selected, tracts, shown]);

  const addStore = useCallback((s: Store) => setScenario((list) => renumber([...list, s])), []);
  const removeStore = useCallback((id: string) => setScenario((list) => renumber(list.filter((s) => s.id !== id))), []);
  const onPlace = useCallback(
    (lon: number, lat: number) => {
      if (!placing) return;
      const n = scenario.length + 1;
      addStore({ id: `new-${scenario.length}`, name: `Proposed ${placing} store ${n}`, type: placing, lon: Math.round(lon * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5, size: 1, segments: [], proposed: true });
    },
    [placing, scenario.length, addStore]
  );

  const onPlan = useCallback(
    async (req: BudgetRequest) => {
      setPlanning(true);
      try {
        const r = await getJson<SitePlan>("/api/sites", { method: "POST", headers: { "Content-Type": "application/json" }, body: scenarioBody(params, { scenario, closed, capacityScale }, { ...req }) });
        // Keyed against the roster the plan leaves behind, not the one it ran
        // on: its picks join the scenario on the next line, so keying it on the
        // inputs would make it stale the instant it arrived. Delete one of those
        // stores afterwards and the key no longer matches, which is the point —
        // the plan stops claiming a store the rail above it no longer lists.
        setPlan({ key: scenarioBody(params, { scenario: [...scenario, ...r.picks.map((k) => k.store)], closed, capacityScale }), value: r });
        if (r.picks.length === 0) {
          // Same reason the panel gives for leftover capital, rather than
          // blaming revenue when the run was stopped by cost or by the clock.
          setError(`No sites picked: ${remainderNote(r)}`);
          return;
        }
        setScenario((list) => renumber([...list, ...r.picks.map((k) => k.store)]));
        setFlyTo({ lon: r.picks[0].store.lon, lat: r.picks[0].store.lat, label: r.picks[0].tractName });
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPlanning(false);
      }
    },
    [params, scenario, closed, capacityScale]
  );

  const onForecast = useCallback(
    async (req: ForecastRequest) => {
      setForecasting(true);
      try {
        const r = await getJson<SimulationResult>("/api/forecast", { method: "POST", headers: { "Content-Type": "application/json" }, body: scenarioBody(params, { scenario, closed, capacityScale }, { ...req, runs: 300 }) });
        setForecast({
          key: forecastKeyOf(scenarioBody(params, { scenario, closed, capacityScale })),
          value: r,
          caps: capacityTotals(staticData?.dcs ?? [], capacityScale),
        });
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setForecasting(false);
      }
    },
    [params, scenario, closed, capacityScale, staticData]
  );

  const onCapacityScale = useCallback((dc: string, category: string, factor: number) => {
    setCapacityScale((list) => {
      const rest = list.filter((c) => !(c.dc === dc && c.category === category));
      return Math.abs(factor - 1) < 1e-9 ? rest : [...rest, { dc, category, factor }];
    });
  }, []);

  const onSearch = useCallback(async (q: string) => (await getJson<{ matches: GeoMatch[] }>(`/api/geocode?q=${encodeURIComponent(q)}`)).matches, []);
  const onGoTo = useCallback((p: MapPoint) => {
    setSearchMarker(p);
    setFlyTo({ ...p });
  }, []);
  const onCopy = useCallback(
    async (kind: "link" | "settings") => {
      const link = currentLink(view);
      const text = kind === "link" ? link : viewToClipboardText(view, link);
      try {
        await navigator.clipboard.writeText(text);
        return { text, copied: true };
      } catch {
        return { text, copied: false };
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, segment, params, scenario, closed, capacityScale, selected, showCompetitors]
  );
  const onExport = useCallback(() => {
    if (!tracts || !shown) return;
    download(`candy-market-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(tracts, shown), "text/csv");
  }, [tracts, shown]);

  const jumpToWorstMeter = useCallback(() => {
    const el = document.getElementById(WORST_METER_ID);
    el?.scrollIntoView({ block: "nearest" });
    el?.focus();
  }, []);

  /*
   * Leaving desktop puts both flags down. They are only *in effect* while wide,
   * so a narrow window made them invisible rather than false: the board could
   * not be closed there — Esc tests the derived value, `\` is bound only while
   * wide, and the button is hidden — so widening the window again sprang a board
   * open that the user had left behind minutes earlier. Adjusted during render,
   * the way the stale-key comparisons above are, because an effect that calls
   * setState is the shape this project's lint rules reject.
   */
  const [lastWide, setLastWide] = useState(wide);
  if (wide !== lastWide) {
    setLastWide(wide);
    if (!wide) {
      setBoardOpen(false);
      setFocusMode(false);
    }
  }

  // Both are desktop states: below 1000px the frame is a stacked page with
  // nothing to collapse, so they are simply not in effect there.
  const focused = focusMode && wide;
  // Board mode reveals the deck's folded rows, and focus mode has no deck, so
  // the two are never in effect together.
  const board = boardOpen && wide && !focused;

  // The board takes the map's place and focus mode is the map on its own, so
  // opening either has to drop the other. They used to be independent flags, and
  // a board left set behind focus mode was invisible, sprang back open on exit,
  // and swallowed the Esc that was meant to leave focus mode.
  const toggleBoard = useCallback(() => {
    setFocusMode(false);
    setBoardOpen((v) => !v);
  }, []);
  const toggleFocus = useCallback(() => {
    setBoardOpen(false);
    setFocusMode((v) => !v);
  }, []);

  // One listener, one precedence order. Four things claim Esc, and the
  // placing-mode exit must not be the one that loses. Esc tests the derived
  // `board` and `focused` — the panels the user can actually see — because the
  // raw flags can be set while nothing is on screen to close, and an Esc spent
  // on an invisible panel reads as a dead key. The same reason gates \ and F on
  // `wide`: below the breakpoint neither state exists, so the keys stay unbound
  // rather than flipping a flag with no effect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") {
        if (popover) setPopover(null);
        else if (placing) setPlacing(null);
        else if (board) setBoardOpen(false);
        else if (focused) setFocusMode(false);
        else if (selected) setSelected(null);
        else return;
        e.preventDefault();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const layers: Mode[] = ["demand", "specialty", "share", "uncaptured", "primary"];
      const n = Number(e.key);
      if (n >= 1 && n <= 5) setMode(layers[n - 1]);
      else if (wide && e.key === "\\") toggleBoard();
      else if (wide && (e.key === "f" || e.key === "F")) toggleFocus();
      else if (e.key === "a" || e.key === "A") setPopover((v) => (v === "about" ? null : "about"));
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popover, placing, board, focused, selected, wide, toggleBoard, toggleFocus]);

  const dcs = useMemo(() => staticData?.dcs ?? [], [staticData]);
  // Derived rather than synced: the center picker only exists past two centers,
  // and a stale id from a data change resolves to the first one on the spot.
  const currentDc = dcs.some((d) => d.id === activeDc) ? activeDc : dcs[0]?.id ?? "";

  const deckProps = {
    dcs,
    result: shown,
    labels: segmentLabels,
    capacityScale,
    onCapacityScale,
    forecastDraft,
    onForecastDraft: setForecastDraft,
    onForecast,
    forecast: forecastRun?.value ?? null,
    // The capacity that was in force when this forecast ran. The chart's cap
    // rule and its y-scale belong to the bars beside them, not to a capacity
    // stepper the user has moved since.
    forecastCaps: forecastRun?.caps ?? null,
    forecasting,
    forecastView,
    onForecastView: setForecastView,
    params,
    onParams: setParams,
    activeDc: currentDc,
    onActiveDc: setActiveDc,
    popover,
    onPopover: setPopover,
    visibleMeters: roomy && tall ? 3 : 2,
  };

  // The board is an overlay, not a modal — the rails and the deck under it stay
  // live — so nothing is trapped. But a keyboard user who opens it must not have
  // to tab the whole page to reach it, and must land where they were on close.
  const boardClose = useRef<HTMLButtonElement>(null);
  const beforeBoard = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (board) {
      beforeBoard.current = document.activeElement as HTMLElement | null;
      boardClose.current?.focus();
      return;
    }
    beforeBoard.current?.focus();
    beforeBoard.current = null;
  }, [board]);

  return (
    <div className={frame.app} data-app-frame data-focus={focused ? "true" : undefined}>
      <header className={frame.bar}>
        <OutcomeBar
          result={shown}
          baseline={baseline}
          resultIsScenario={scenarioShown !== null}
          scenarioActive={scenarioActive}
          busy={busy}
          scenario={scenario}
          closed={closed}
          capacityScale={capacityScale}
          params={params}
          onClearScenario={() => {
            setScenario([]);
            setClosed([]);
            setCapacityScale([]);
            setPlan(null);
            setPlacing(null);
          }}
          onCopy={onCopy}
          onExport={onExport}
          ready={!!shown}
          boardOpen={board}
          onBoard={toggleBoard}
          focusMode={focused}
          onFocus={toggleFocus}
          onJumpToWorstMeter={jumpToWorstMeter}
          popover={popover}
          onPopover={setPopover}
          narrow={!wide}
        />
        {!focused && <DroppedNotice dropped={dropped} onDismiss={() => setDropped([])} />}
      </header>

      <aside className={`${frame.lens} ${focused ? frame.collapsed : ""}`} inert={focused || undefined}>
        <LensRail
          mode={mode}
          onMode={setMode}
          segment={segment}
          onSegment={setSegment}
          segments={segments}
          result={shown}
          params={params}
          onParams={setParams}
          onSearch={onSearch}
          onGoTo={onGoTo}
          onShowAbout={() => setPopover("about")}
          popover={popover}
          onPopover={setPopover}
        />
      </aside>

      <main className={`${frame.mapPane} ${styles.mapPane}`} id="map-region">
        {error && (
          <div className={styles.error} role="alert">
            {error}
            <button onClick={() => setError(null)} aria-label="Dismiss">×</button>
          </div>
        )}
        {tracts && staticData ? (
          <MarketMap
            tracts={tracts}
            result={shown}
            version={version}
            mode={mode}
            segment={segment}
            segmentLabels={segmentLabels}
            stores={stores}
            storeSlots={storeSlots}
            dcs={staticData.dcs}
            competitors={staticData.competitors}
            showCompetitors={showCompetitors}
            placing={placing}
            searchMarker={searchMarker}
            flyTo={flyTo}
            selected={selected}
            onSelect={setSelected}
            onPlace={onPlace}
            onRemoveStore={removeStore}
          />
        ) : (
          <div className={styles.mapLoading}>Loading tracts…</div>
        )}
        <MapOverlays
          mode={mode}
          breaks={breaks}
          stores={stores}
          storeSlots={storeSlots}
          selected={selectedInfo}
          labels={segmentLabels}
          onClearSelection={() => setSelected(null)}
          showCompetitors={showCompetitors}
          onShowCompetitors={setShowCompetitors}
          placing={placing}
        />
      </main>

      <aside className={`${frame.decide} ${focused ? frame.collapsed : ""}`} inert={focused || undefined}>
        <DecisionRail
          allStores={staticData?.stores ?? []}
          scenario={scenario}
          closed={closed}
          result={shown}
          labels={segmentLabels}
          placing={placing}
          onPlacing={setPlacing}
          onToggleClosed={(id) => setClosed((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))}
          onRemoveStore={removeStore}
          budget={budget}
          onBudget={setBudget}
          onPlan={onPlan}
          plan={planShown}
          planning={planning}
          onJumpToWorstMeter={jumpToWorstMeter}
        />
      </aside>

      <section className={`${frame.deck} ${focused ? frame.collapsed : ""}`} inert={focused || undefined}>
        <SupplyDeck {...deckProps} />
      </section>

      {board && (
        <div className={frame.board} role="dialog" aria-label="All controls and all rows">
          <div className={frame.boardHead}>
            <span className={frame.boardTitle}>All controls and all rows</span>
            <span className={frame.boardNote}>Every capacity category, and the weekly table beside the chart. It takes the map&apos;s place, so every other control stays on screen.</span>
            <button ref={boardClose} type="button" className={w.iconBtn} aria-label="Close" onClick={() => setBoardOpen(false)}>×</button>
          </div>
          <div className={frame.boardBody}>
            <BoardPanel {...deckProps} />
          </div>
        </div>
      )}
    </div>
  );
}
