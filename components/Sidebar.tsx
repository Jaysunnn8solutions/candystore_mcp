"use client";

import { useState, type FormEvent } from "react";
import type { GeoMatch } from "@/lib/geocode";
import type { SitePlan } from "@/lib/model/optimizer";
import { DEFAULT_STORE_COSTS } from "@/lib/model/optimizer-defaults";
import type { SimulationResult } from "@/lib/model/simulate";
import type { DistributionCenter, MarketResult, ScenarioParams, Store, StoreType, TractProps } from "@/lib/model/types";
import { Legend } from "./Legend";
import type { MapPoint } from "./MarketMap";
import { ourShare } from "./MarketMap";
import { MODES, STORE_TYPE_COLORS, fmtNum, money, pct, type Mode } from "./scales";
import styles from "./Sidebar.module.css";

export interface SelectedTract {
  props: TractProps;
  result: MarketResult["tracts"][number] | undefined;
}

export interface BudgetRequest {
  budget: number;
  costGeneral: number;
  costSpecialty: number;
  types: StoreType[];
}

export interface ForecastRequest {
  weeks: number;
  startWeek: number;
  outageProbability: number;
}

interface Props {
  mode: Mode;
  onMode: (m: Mode) => void;
  segment: string;
  onSegment: (s: string) => void;
  segments: Array<{ id: string; label: string }>;
  breaks: number[];
  params: ScenarioParams;
  onParams: (p: ScenarioParams) => void;
  result: MarketResult | null;
  baseline: MarketResult | null;
  loading: boolean;
  stores: Store[];
  dcs: DistributionCenter[];
  selected: SelectedTract | null;
  onClearSelection: () => void;
  onSearch: (q: string) => Promise<GeoMatch[]>;
  onGoTo: (p: MapPoint) => void;
  showCompetitors: boolean;
  onShowCompetitors: (v: boolean) => void;
  // scenario
  placing: StoreType | null;
  onPlacing: (t: StoreType | null) => void;
  scenario: Store[];
  onRemoveStore: (id: string) => void;
  closed: string[];
  onToggleClosed: (id: string) => void;
  onClearScenario: () => void;
  capacityScale: Array<{ dc: string; category: string; factor: number }>;
  onCapacityScale: (dc: string, category: string, factor: number) => void;
  // budget
  onPlan: (req: BudgetRequest) => Promise<void>;
  plan: SitePlan | null;
  planning: boolean;
  // forecast
  onForecast: (req: ForecastRequest) => Promise<void>;
  forecast: SimulationResult | null;
  forecasting: boolean;
  // share
  onCopy: (kind: "link" | "settings") => Promise<{ text: string; copied: boolean }>;
  onExport: () => void;
}

export function Sidebar(p: Props) {
  const modeInfo = MODES.find((m) => m.id === p.mode)!;
  const labels = Object.fromEntries(p.segments.map((s) => [s.id, s.label]));
  const scenarioActive = p.scenario.length > 0 || p.closed.length > 0 || p.capacityScale.length > 0;

  return (
    <aside className={styles.sidebar}>
      <header className={styles.header}>
        <h1>Candy store planning</h1>
        <p>
          Where candy demand is, which heritage segments want familiar candy, what our stores
          capture, where to open next, and what to tell suppliers. Ten-county metro Atlanta by census tract.
        </p>
      </header>

      <SearchBox onSearch={p.onSearch} onGoTo={p.onGoTo} />

      <section>
        <div className={`${styles.segmented} ${styles.wrap}`} role="tablist">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={p.mode === m.id} className={p.mode === m.id ? styles.active : ""} onClick={() => p.onMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <p className={styles.blurb}>{modeInfo.blurb}</p>
        {p.mode === "specialty" && (
          <select className={styles.select} value={p.segment} onChange={(e) => p.onSegment(e.target.value)} aria-label="Heritage segment">
            {p.segments.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        )}
        <Legend mode={p.mode} breaks={p.breaks} stores={p.stores} />
        <label className={styles.check}>
          <input type="checkbox" checked={p.showCompetitors} onChange={(e) => p.onShowCompetitors(e.target.checked)} />
          Show competitors
        </label>
      </section>

      {p.selected ? (
        <TractCard sel={p.selected} labels={labels} stores={p.stores} onClose={p.onClearSelection} />
      ) : (
        <Summary result={p.result} baseline={scenarioActive ? p.baseline : null} loading={p.loading} labels={labels} />
      )}

      <section>
        <h2>Stores</h2>
        <p className={styles.blurb}>Pick a type and click the map to open a store. Click a proposed store on the map to remove it. Tick an existing store to close it.</p>
        <div className={styles.chips}>
          {(["general", "specialty"] as StoreType[]).map((t) => (
            <button key={t} className={`${styles.chip} ${p.placing === t ? styles.chipActive : ""}`} style={{ ["--chip" as string]: STORE_TYPE_COLORS[t] }} onClick={() => p.onPlacing(p.placing === t ? null : t)}>
              <span className={styles.dot} />
              {t === "general" ? "General store" : "Specialty store"}
            </button>
          ))}
        </div>
        <ul className={styles.facilities}>
          {p.stores.map((s) => {
            const r = p.result?.stores.find((x) => x.id === s.id);
            return (
              <li key={s.id}>
                {s.proposed ? (
                  <span className={styles.dot} style={{ background: STORE_TYPE_COLORS[s.type] }} />
                ) : (
                  <input type="checkbox" checked={p.closed.includes(s.id)} onChange={() => p.onToggleClosed(s.id)} aria-label={`Close ${s.name}`} title="Close this store" />
                )}
                <span className={styles.facilityLabel}>
                  {s.name}
                  <span className={styles.muted}> {s.type}{s.segments.length ? ` · ${s.segments.map((g) => labels[g] ?? g).join(", ")}` : ""}{r ? ` · ${money(r.revenue)}/yr` : ""}</span>
                </span>
                {s.proposed && (
                  <button className={styles.iconButton} onClick={() => p.onRemoveStore(s.id)} aria-label="Remove store">×</button>
                )}
              </li>
            );
          })}
          {p.closed.map((id) => (
            <li key={`closed-${id}`}>
              <input type="checkbox" checked onChange={() => p.onToggleClosed(id)} aria-label={`Reopen ${id}`} />
              <span className={`${styles.facilityLabel} ${styles.muted}`}>closed: {id}</span>
            </li>
          ))}
        </ul>
        {scenarioActive && (
          <button className={styles.linkButton} onClick={p.onClearScenario}>Clear scenario</button>
        )}
      </section>

      <BudgetPanel onPlan={p.onPlan} plan={p.plan} planning={p.planning} labels={labels} />

      <SupplyPanel dcs={p.dcs} result={p.result} capacityScale={p.capacityScale} onCapacityScale={p.onCapacityScale} onForecast={p.onForecast} forecast={p.forecast} forecasting={p.forecasting} labels={labels} />

      <ParamsPanel params={p.params} onParams={p.onParams} />

      <SharePanel onCopy={p.onCopy} onExport={p.onExport} ready={!!p.result} />

      <footer className={styles.footer}>
        <p>
          Demographics: ACS 5-year estimates via the Census Bureau, including foreign-born by region of birth. Competitors: OpenStreetMap.
          Spend, costs, stores and capacities are mock assumptions. <a href="https://github.com/Jaysunnn8solutions/candystore_mcp">Source and method</a>.
          The same model is available to AI assistants at <code>/mcp</code>.
        </p>
      </footer>
    </aside>
  );
}

function SearchBox({ onSearch, onGoTo }: { onSearch: (q: string) => Promise<GeoMatch[]>; onGoTo: (p: MapPoint) => void }) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<GeoMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      const m = await onSearch(q.trim());
      setMatches(m);
      if (m.length === 1) {
        onGoTo({ lon: m[0].lon, lat: m[0].lat, label: m[0].label });
        setMatches(null);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <form onSubmit={submit} className={styles.search}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a neighbourhood or address" aria-label="Search a place" />
        <button type="submit" className={styles.button} disabled={busy}>{busy ? "…" : "Go"}</button>
      </form>
      {matches && matches.length === 0 && <p className={styles.blurb}>Nothing found inside metro Atlanta.</p>}
      {matches && matches.length > 1 && (
        <ul className={styles.matches}>
          {matches.map((m) => (
            <li key={`${m.lat},${m.lon}`}>
              <button className={styles.linkButton} onClick={() => { onGoTo({ lon: m.lon, lat: m.lat, label: m.label }); setMatches(null); }}>
                {m.label}{m.kind ? <span className={styles.muted}> · {m.kind}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Summary({ result, baseline, loading, labels }: { result: MarketResult | null; baseline: MarketResult | null; loading: boolean; labels: Record<string, string> }) {
  if (!result) {
    return (
      <section><h2>The market</h2><p className={styles.blurb}>{loading ? "Computing…" : "No results."}</p></section>
    );
  }
  const t = result.totals;
  const arrow = (a: number, b: number, f: (x: number) => string) => (baseline ? <span className={styles.muted}>{f(a)} → </span> : null);
  return (
    <section aria-busy={loading}>
      <h2>{baseline ? "With your scenario" : "The market"}{loading && <span className={styles.spinner}>updating</span>}</h2>
      <div className={styles.tiles}>
        <div className={styles.tile}><span className={styles.tileValue}>{money(t.marketDemand)}</span><span className={styles.tileLabel}>candy spend per year</span></div>
        <div className={styles.tile}><span className={styles.tileValue}>{arrow(baseline?.totals.ourRevenue ?? 0, t.ourRevenue, money)}{money(t.ourRevenue)}</span><span className={styles.tileLabel}>our revenue</span></div>
        <div className={styles.tile}><span className={styles.tileValue}>{arrow(baseline?.totals.ourShare ?? 0, t.ourShare, pct)}{pct(t.ourShare)}</span><span className={styles.tileLabel}>our share</span></div>
      </div>
      {t.lostToCaps > 1000 && <p className={styles.blurb}>{money(t.lostToCaps)} a year of captured demand is lost to distribution caps.</p>}
      <h3>Specialty segments</h3>
      <table className={styles.table}>
        <thead><tr><th>Segment</th><th>Tracts</th><th>Demand</th></tr></thead>
        <tbody>
          {result.segments.filter((s) => s.markets > 0).map((s) => (
            <tr key={s.id}><td>{labels[s.id] ?? s.label}</td><td>{s.markets}</td><td>{money(s.demand)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className={styles.blurb}>A tract counts as a segment market when the segment is at least {pct(result.params.demand.criticalMass)} of its population. Click a tract for details.</p>
    </section>
  );
}

function TractCard({ sel, labels, stores, onClose }: { sel: SelectedTract; labels: Record<string, string>; stores: Store[]; onClose: () => void }) {
  const { props: p, result: t } = sel;
  const heritage = Object.entries(p.heritage).filter(([, v]) => v >= 0.02).sort((a, b) => b[1] - a[1]);
  return (
    <section className={styles.detail}>
      <div className={styles.detailHead}><h2>{p.name}</h2><button onClick={onClose} aria-label="Close">×</button></div>
      <p className={styles.where}>{p.place}, {p.county} County · {fmtNum(p.pop)} residents · {fmtNum(p.households)} households</p>
      {t && (
        <div className={styles.tiles}>
          <div className={styles.tile}><span className={styles.tileValue}>{money(t.total)}</span><span className={styles.tileLabel}>candy spend / yr</span></div>
          <div className={styles.tile}><span className={styles.tileValue}>{pct(ourShare(t))}</span><span className={styles.tileLabel}>we capture</span></div>
        </div>
      )}
      {t && (
        <dl className={styles.facts}>
          {Object.entries(t.byCategory).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
            <div key={c} className={styles.factRow}>
              <dt>{c === "traditional" ? "Traditional" : `${labels[c.replace("specialty:", "")] ?? c} specialty`}</dt>
              <dd>{money(v)} · {pct(t.captured[c] ?? 0)} ours</dd>
            </div>
          ))}
        </dl>
      )}
      {t?.primaryStore && <p className={styles.blurb}>Shops mostly at {stores.find((s) => s.id === t.primaryStore)?.name ?? t.primaryStore}.</p>}
      <h3>People</h3>
      <dl className={styles.facts}>
        <dt>Median income</dt><dd>{p.medianIncome == null ? "n/a" : money(p.medianIncome)}</dd>
        <dt>Under 18</dt><dd>{p.childShare == null ? "n/a" : pct(p.childShare)}</dd>
        <dt>Foreign-born</dt><dd>{p.foreignBornShare == null ? "n/a" : pct(p.foreignBornShare)}</dd>
        <dt>Density</dt><dd>{fmtNum(p.pop / Math.max(p.landKm2, 0.01))} / km²</dd>
        {p.pop2019 ? <><dt>Since 2019</dt><dd>{p.pop >= p.pop2019 ? "+" : ""}{(((p.pop - p.pop2019) / p.pop2019) * 100).toFixed(0)}%</dd></> : null}
      </dl>
      {heritage.length > 0 && (
        <>
          <h3>Heritage (born abroad, by region)</h3>
          <dl className={styles.facts}>
            {heritage.map(([k, v]) => (
              <div key={k} className={styles.factRow}><dt>{labels[k] ?? k}</dt><dd>{pct(v)}</dd></div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}

function BudgetPanel({ onPlan, plan, planning, labels }: { onPlan: (r: BudgetRequest) => Promise<void>; plan: SitePlan | null; planning: boolean; labels: Record<string, string> }) {
  const [budgetM, setBudgetM] = useState(10);
  const [costG, setCostG] = useState(DEFAULT_STORE_COSTS.general / 1e6);
  const [costS, setCostS] = useState(DEFAULT_STORE_COSTS.specialty / 1e6);
  const [general, setGeneral] = useState(true);
  const [specialty, setSpecialty] = useState(true);
  const types = [general && "general", specialty && "specialty"].filter(Boolean) as StoreType[];
  return (
    <section>
      <h2>Open new stores with a budget</h2>
      <p className={styles.blurb}>The optimizer opens stores one at a time by revenue added per dollar, counting sales pulled from our own stores and supply caps. Purchases join the scenario.</p>
      <label className={styles.field}><span>Budget</span><span className={styles.inputUnit}>$<input type="number" min={1} max={500} step={1} value={budgetM} onChange={(e) => setBudgetM(Number(e.target.value))} />M</span></label>
      <label className={styles.field}><span><input type="checkbox" checked={general} onChange={(e) => setGeneral(e.target.checked)} /> General store cost</span><span className={styles.inputUnit}>$<input type="number" min={0.1} max={50} step={0.1} value={costG} onChange={(e) => setCostG(Number(e.target.value))} />M</span></label>
      <label className={styles.field}><span><input type="checkbox" checked={specialty} onChange={(e) => setSpecialty(e.target.checked)} /> Specialty store cost</span><span className={styles.inputUnit}>$<input type="number" min={0.1} max={50} step={0.1} value={costS} onChange={(e) => setCostS(Number(e.target.value))} />M</span></label>
      <button className={styles.button} disabled={planning || types.length === 0} onClick={() => onPlan({ budget: budgetM * 1e6, costGeneral: costG * 1e6, costSpecialty: costS * 1e6, types })}>
        {planning ? "Planning…" : "Plan the expansion"}
      </button>
      {plan && (
        <div className={styles.budgetResult}>
          <p className={styles.verdict}>{money(plan.spent)} opens {plan.picks.length} stores and lifts revenue {money(plan.baseline.ourRevenue)} → {money(plan.after.ourRevenue)} a year.</p>
          <ol className={styles.picks}>
            {plan.picks.map((k) => (
              <li key={k.step}>
                <strong>{k.store.type}</strong>{k.store.segments.length ? ` (${k.store.segments.map((g) => labels[g] ?? g).join(", ")})` : ""} near {k.tractName}, {k.place}: +{money(k.gain)}/yr{k.cannibalized > 1000 ? <span className={styles.muted}> ({money(k.cannibalized)} from our other stores)</span> : null}
              </li>
            ))}
          </ol>
          {plan.remaining > 0 && plan.picks.length > 0 && <p className={styles.blurb}>{money(plan.remaining)} left: no further site clears the minimum gain, usually because a distribution center is at capacity. Raise capacity below and plan again.</p>}
        </div>
      )}
    </section>
  );
}

function SupplyPanel({ dcs, result, capacityScale, onCapacityScale, onForecast, forecast, forecasting, labels }: {
  dcs: DistributionCenter[];
  result: MarketResult | null;
  capacityScale: Array<{ dc: string; category: string; factor: number }>;
  onCapacityScale: (dc: string, category: string, factor: number) => void;
  onForecast: (r: ForecastRequest) => Promise<void>;
  forecast: SimulationResult | null;
  forecasting: boolean;
  labels: Record<string, string>;
}) {
  const [weeks, setWeeks] = useState(26);
  const [startWeek, setStartWeek] = useState(36);
  const [outage, setOutage] = useState(3);
  const factorFor = (dc: string, category: string) => capacityScale.find((c) => c.dc === dc && c.category === category)?.factor ?? 1;
  return (
    <section>
      <h2>Supply chain</h2>
      <p className={styles.blurb}>Each store draws from its nearest distribution center. Specialty candy is capped tightly by what suppliers can ship; traditional loosely. Scale a center&apos;s capacity to test relief.</p>
      {dcs.map((d) => {
        const r = result?.dcs.find((x) => x.id === d.id);
        return (
          <div key={d.id} className={styles.dcBlock}>
            <strong>{d.name}</strong>
            {(["traditional", "*"] as const).map((cat) => (
              <label key={cat} className={styles.range}>
                <span>{cat === "*" ? "All specialty" : "Traditional"} capacity <strong>×{factorFor(d.id, cat === "*" ? "specialty:*" : cat).toFixed(1)}</strong></span>
                <input type="range" min={0} max={3} step={0.1} value={factorFor(d.id, cat === "*" ? "specialty:*" : cat)} onChange={(e) => onCapacityScale(d.id, cat === "*" ? "specialty:*" : cat, Number(e.target.value))} />
              </label>
            ))}
            {r && (
              <ul className={styles.util}>
                {Object.entries(r.weeklyDemand).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([c, v]) => {
                  const cap = r.capacity[c] ?? 0;
                  const used = Math.min(1, v / Math.max(1, cap));
                  return (
                    <li key={c}>
                      <span>{c === "traditional" ? "Traditional" : labels[c.replace("specialty:", "")] ?? c}</span>
                      <span className={styles.bar}><span style={{ width: `${used * 100}%`, background: used >= 0.999 ? "#b83232" : used > 0.8 ? "#eb6834" : "#2a78d6" }} /></span>
                      <span className={styles.muted}>{money(v)}/wk of {money(cap)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
      <h3>Supplier forecast</h3>
      <div className={styles.suggest}>
        <label className={styles.inputUnit}><input type="number" min={4} max={52} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} /> weeks</label>
        <label className={styles.inputUnit}>from wk <input type="number" min={1} max={52} value={startWeek} onChange={(e) => setStartWeek(Number(e.target.value))} /></label>
        <label className={styles.inputUnit}><input type="number" min={0} max={50} value={outage} onChange={(e) => setOutage(Number(e.target.value))} />% outage/wk</label>
      </div>
      <button className={styles.button} disabled={forecasting} onClick={() => onForecast({ weeks, startWeek, outageProbability: outage / 100 })}>{forecasting ? "Simulating…" : "Forecast orders"}</button>
      {forecast && (
        <div className={styles.budgetResult}>
          <p className={styles.verdict}>{money(forecast.totals.horizonRevenue)} of orders over {forecast.options.weeks} weeks; expected {money(forecast.totals.expectedLost)} lost to outages and caps.</p>
          <table className={styles.table}>
            <thead><tr><th>Wk</th>{dcs.map((d) => <th key={d.id}>{d.name.replace(" DC", "")}</th>)}<th>Lost</th></tr></thead>
            <tbody>
              {forecast.weekly.map((w) => (
                <tr key={w.week}>
                  <td>{w.calendarWeek}</td>
                  {dcs.map((d) => {
                    const mean = Object.values(w.mean[d.id] ?? {}).reduce((a, b) => a + b, 0);
                    const hi = Object.values(w.p90[d.id] ?? {}).reduce((a, b) => a + b, 0);
                    return <td key={d.id}>{money(mean)}<span className={styles.muted}> ≤{money(hi)}</span></td>;
                  })}
                  <td>{w.lost > 500 ? money(w.lost) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.blurb}>Mean weekly orders per center, with the p90 to plan capacity against. Weeks 42–44 are the Halloween run-up; 49–52 Christmas.</p>
        </div>
      )}
    </section>
  );
}

const PARAM_FIELDS: Array<{ group: "demand" | "gravity"; key: string; label: string; min: number; max: number; step: number; hint: string }> = [
  { group: "demand", key: "baseSpend", label: "Spend per household", min: 20, max: 400, step: 5, hint: "annual candy spend at the median income" },
  { group: "demand", key: "incomeElasticity", label: "Income effect", min: 0, max: 1.5, step: 0.05, hint: "how strongly spend rises with income" },
  { group: "demand", key: "childBoost", label: "Children effect", min: 0, max: 3, step: 0.1, hint: "how strongly a young population raises spend" },
  { group: "demand", key: "criticalMass", label: "Critical mass", min: 0.02, max: 0.3, step: 0.01, hint: "segment share needed for a specialty market" },
  { group: "demand", key: "specialtyAffinity", label: "Specialty affinity", min: 0, max: 1, step: 0.05, hint: "share of a heritage household's spend on familiar candy" },
  { group: "gravity", key: "maxKm", label: "Store reach (km)", min: 2, max: 20, step: 0.5, hint: "beyond this a store draws nothing" },
  { group: "gravity", key: "beta", label: "Distance decay", min: 0.5, max: 4, step: 0.1, hint: "higher means people travel less" },
  { group: "gravity", key: "outsideOption", label: "Buy elsewhere", min: 0, max: 0.2, step: 0.005, hint: "pull of grocery and online" },
];

function ParamsPanel({ params, onParams }: { params: ScenarioParams; onParams: (p: ScenarioParams) => void }) {
  return (
    <section>
      <h2>Model assumptions</h2>
      {PARAM_FIELDS.map((f) => {
        const value = (params[f.group] as unknown as Record<string, number>)[f.key];
        return (
          <label key={f.key} className={styles.range} title={f.hint}>
            <span>{f.label} <strong>{f.key === "criticalMass" ? pct(value) : value}</strong></span>
            <input type="range" min={f.min} max={f.max} step={f.step} value={value} onChange={(e) => onParams({ ...params, [f.group]: { ...params[f.group], [f.key]: Number(e.target.value) } })} />
          </label>
        );
      })}
    </section>
  );
}

function SharePanel({ onCopy, onExport, ready }: { onCopy: Props["onCopy"]; onExport: () => void; ready: boolean }) {
  const [status, setStatus] = useState<{ kind: "link" | "settings"; copied: boolean; text: string } | null>(null);
  const copy = async (kind: "link" | "settings") => setStatus({ kind, ...(await onCopy(kind)) });
  return (
    <section>
      <h2>Share and export</h2>
      <div className={styles.buttonRow}>
        <button className={styles.button} onClick={() => copy("settings")} disabled={!ready}>Copy settings for Claude</button>
        <button className={styles.button} onClick={() => copy("link")} disabled={!ready}>Copy link</button>
        <button className={styles.button} onClick={onExport} disabled={!ready}>CSV</button>
      </div>
      {status?.copied && <p className={styles.blurb}>{status.kind === "settings" ? "Copied. Paste it into a chat with the candystore-mcp server attached." : "Link copied."}</p>}
      {status && !status.copied && <textarea className={styles.copyBox} readOnly value={status.text} rows={4} onFocus={(e) => e.currentTarget.select()} />}
      <p className={styles.blurb}>The settings block carries every slider, store and capacity change as the exact arguments the MCP tools accept. Running the server locally also lets it write this map to an HTML file.</p>
    </section>
  );
}
