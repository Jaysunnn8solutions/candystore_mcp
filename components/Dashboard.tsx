"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_VERSION } from "@/lib/api-version";
import type { DataManifest, TractCollection } from "@/lib/data/load";
import type { GeoMatch } from "@/lib/geocode";
import type { SitePlan } from "@/lib/model/optimizer";
import { flattenParams } from "@/lib/model/params";
import type { SimulationResult } from "@/lib/model/simulate";
import type { Competitor, DistributionCenter, MarketResult, ScenarioParams, Store, StoreType } from "@/lib/model/types";
import { viewToClipboardText, type ViewState } from "@/lib/view-state";
import { download, toCsv } from "./exportData";
import type { MapPoint } from "./MarketMap";
import { quintiles, type Mode } from "./scales";
import { Sidebar, type BudgetRequest, type ForecastRequest } from "./Sidebar";
import { currentLink, readHash, writeHash } from "./urlState";
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

export function Dashboard() {
  const [initial] = useState(readHash);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [segment, setSegment] = useState(initial.segment);
  const [params, setParams] = useState<ScenarioParams>(initial.params);
  const [scenario, setScenario] = useState<Store[]>(initial.scenario);
  const [closed, setClosed] = useState<string[]>(initial.closed);
  const [capacityScale, setCapacityScale] = useState(initial.capacityScale);
  const [selected, setSelected] = useState<string | null>(initial.selected);
  const [showCompetitors, setShowCompetitors] = useState(initial.showCompetitors);
  const [placing, setPlacing] = useState<StoreType | null>(null);
  const [searchMarker, setSearchMarker] = useState<MapPoint | null>(null);
  const [flyTo, setFlyTo] = useState<MapPoint | null>(null);

  const [tracts, setTracts] = useState<TractCollection | null>(null);
  const [staticData, setStaticData] = useState<StaticData | null>(null);
  const [baseline, setBaseline] = useState<MarketResult | null>(null);
  const [result, setResult] = useState<MarketResult | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<SitePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [forecast, setForecast] = useState<SimulationResult | null>(null);
  const [forecasting, setForecasting] = useState(false);

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
      if (v) {
        setResult(v);
        setVersion((n) => n + 1);
      } else if (err) setError(err);
    }, [])
  );

  const shown = scenarioActive && result ? result : baseline;
  const stores = useMemo(() => {
    const base = (staticData?.stores ?? []).filter((s) => !closed.includes(s.id));
    return [...base, ...scenario];
  }, [staticData, closed, scenario]);
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

  const addStore = useCallback((s: Store) => setScenario((list) => [...list, s]), []);
  const onPlace = useCallback(
    (lon: number, lat: number) => {
      if (!placing) return;
      const n = scenario.length + 1;
      addStore({ id: `new-${Date.now()}`, name: `Proposed ${placing} store ${n}`, type: placing, lon: Math.round(lon * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5, size: 1, segments: [], proposed: true });
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
          setError("No site adds enough revenue at these costs and capacities.");
          return;
        }
        setScenario((list) => [...list, ...r.picks.map((k) => ({ ...k.store, id: `plan-${Date.now()}-${k.step}` }))]);
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

  return (
    <div className={styles.app}>
      <Sidebar
        mode={mode}
        onMode={setMode}
        segment={segment}
        onSegment={setSegment}
        segments={segments.filter((s) => (shown?.segments.find((x) => x.id === s.id)?.markets ?? 0) > 0 || s.id === segment)}
        breaks={breaks}
        params={params}
        onParams={setParams}
        result={shown}
        baseline={baseline}
        loading={loading}
        stores={stores}
        dcs={staticData?.dcs ?? []}
        selected={selectedInfo}
        onClearSelection={() => setSelected(null)}
        onSearch={onSearch}
        onGoTo={onGoTo}
        showCompetitors={showCompetitors}
        onShowCompetitors={setShowCompetitors}
        placing={placing}
        onPlacing={setPlacing}
        scenario={scenario}
        onRemoveStore={(id) => setScenario((list) => list.filter((s) => s.id !== id))}
        closed={closed}
        onToggleClosed={(id) => setClosed((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))}
        onClearScenario={() => {
          setScenario([]);
          setClosed([]);
          setCapacityScale([]);
          setPlan(null);
          setPlacing(null);
        }}
        capacityScale={capacityScale}
        onCapacityScale={onCapacityScale}
        onPlan={onPlan}
        plan={plan}
        planning={planning}
        onForecast={onForecast}
        forecast={forecast}
        forecasting={forecasting}
        onCopy={onCopy}
        onExport={onExport}
      />
      <main className={styles.mapPane}>
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
            dcs={staticData.dcs}
            competitors={staticData.competitors}
            showCompetitors={showCompetitors}
            placing={placing}
            searchMarker={searchMarker}
            flyTo={flyTo}
            selected={selected}
            onSelect={setSelected}
            onPlace={onPlace}
            onRemoveStore={(id) => setScenario((list) => list.filter((s) => s.id !== id))}
          />
        ) : (
          <div className={styles.mapLoading}>Loading tracts…</div>
        )}
      </main>
    </div>
  );
}
