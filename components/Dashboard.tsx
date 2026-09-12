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
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${r.status}`);
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

/** Tracks a media query, so a breakpoint can gate behaviour and not only CSS. */
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
  const [plan, setPlan] = useState<SitePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [forecast, setForecast] = useState<SimulationResult | null>(null);
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
  // A short window cuts the deck, so a third meter row per centre would not fit.
  const tall = useMediaQuery("(min-height: 761px)");

  const scenarioActive = scenario.length > 0 || closed.length > 0 || capacityScale.length > 0;
  const view: ViewState = { mode, segment, params, scenario, closed, capacityScale, selected, showCompetitors };

  useEffect(() => {
    writeHash(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, segment, params, scenario, closed, capacityScale, selected, showCompetitors]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getJson<TractCollection>(`/api/tracts?v=${API_VERSION}`), getJson<StaticData>(`/api/static?v=${API_VERSION}`)])
      .then(([t, s]) => {
        if (cancelled) return;
        setTracts(t);
        setStaticData(s);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
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

  // Scenario.
  const scenarioKey = scenarioActive ? scenarioBody(params, { scenario, closed, capacityScale }) : null;
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
  const stores = useMemo(() => {
    const base = (staticData?.stores ?? []).filter((s) => !closed.includes(s.id));
    return [...base, ...scenario];
  }, [staticData, closed, scenario]);
  // Trade-area colours are assigned over every store the data knows about,
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
        setPlan(r);
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
        setForecast(r);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setForecasting(false);
      }
    },
    [params, scenario, closed, capacityScale]
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

  // One listener, one precedence order. Four things claim Esc, and the
  // placing-mode exit must not be the one that loses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") {
        if (popover) setPopover(null);
        else if (placing) setPlacing(null);
        else if (boardOpen) setBoardOpen(false);
        else if (focusMode) setFocusMode(false);
        else if (selected) setSelected(null);
        else return;
        e.preventDefault();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const layers: Mode[] = ["demand", "specialty", "share", "uncaptured", "primary"];
      const n = Number(e.key);
      if (n >= 1 && n <= 5) setMode(layers[n - 1]);
      else if (e.key === "\\") setBoardOpen((v) => !v);
      else if (e.key === "f" || e.key === "F") setFocusMode((v) => !v);
      else if (e.key === "a" || e.key === "A") setPopover((v) => (v === "about" ? null : "about"));
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popover, placing, boardOpen, focusMode, selected]);

  const dcs = useMemo(() => staticData?.dcs ?? [], [staticData]);
  // Derived rather than synced: the centre picker only exists past two centres,
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
    forecast,
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

  // Both are desktop states: below 1000px the frame is a stacked page with
  // nothing to collapse, so they are simply not in effect there.
  const focused = focusMode && wide;
  // Board mode reveals the deck's folded rows, and focus mode has no deck, so
  // the two are never in effect together.
  const board = boardOpen && wide && !focused;

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
          onBoard={() => setBoardOpen((v) => !v)}
          focusMode={focused}
          onFocus={() => setFocusMode((v) => !v)}
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
          plan={plan}
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
