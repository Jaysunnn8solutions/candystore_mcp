/**
 * A self-contained HTML map of the current scenario: Leaflet and its CSS
 * inlined from node_modules, tract geometry and results embedded as JSON,
 * layer buttons and tooltips in a few lines of inline script. Opens by
 * double-click with no server and no network (except the basemap tiles).
 *
 * Only the local stdio server renders this; the remote server has no
 * filesystem to write to and no node_modules to read Leaflet from.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { loadCompetitors, loadDcs, loadManifest, loadTracts } from "../data/load";
import { effectiveStores } from "../model/market";
import type { ScenarioOverrides } from "../model/params";
import type { MarketResult } from "../model/types";

function leafletAssets(): { js: string; css: string } {
  const require = createRequire(import.meta.url);
  const dir = path.dirname(require.resolve("leaflet/package.json"));
  return {
    js: readFileSync(path.join(dir, "dist", "leaflet.js"), "utf8"),
    css: readFileSync(path.join(dir, "dist", "leaflet.css"), "utf8"),
  };
}

export interface RenderOptions {
  title?: string;
  mode?: "demand" | "specialty" | "share" | "uncaptured";
  segment?: string;
}

export function renderMapHtml(result: MarketResult, overrides: ScenarioOverrides, opts: RenderOptions = {}): string {
  const { js, css } = leafletAssets();
  const manifest = loadManifest();
  const tracts = loadTracts();
  const stores = effectiveStores(overrides);
  // The run's own store results: their segments are the ones actually
  // carried, where the raw store's list is still empty after an auto-pick.
  const storeResults = new Map(result.stores.map((s) => [s.id, s]));
  const byGeoid = new Map(result.tracts.map((t) => [t.geoid, t]));

  // Slim payload: geometry plus the few numbers the page colours by.
  const features = tracts.features.map((f) => {
    const p = f.properties;
    const t = byGeoid.get(p.geoid)!;
    const ourDollars = Object.entries(t.byCategory).reduce((s, [c, v]) => s + v * (t.captured[c] ?? 0), 0);
    return {
      type: "Feature",
      geometry: f.geometry,
      properties: {
        g: p.geoid,
        n: p.name,
        pl: p.place,
        pop: p.pop,
        inc: p.medianIncome,
        d: Math.round(t.total),
        sp: Object.fromEntries(Object.entries(t.byCategory).filter(([c]) => c !== "traditional").map(([c, v]) => [c.replace("specialty:", ""), Math.round(v)])),
        sh: t.total > 0 ? Math.round((ourDollars / t.total) * 1000) / 1000 : 0,
        un: Math.round(t.total - ourDollars),
        ps: t.primaryStore,
      },
    };
  });

  const payload = {
    title: opts.title ?? "Candy store planning — metro Atlanta",
    mode: opts.mode ?? "demand",
    segment: opts.segment ?? "latam",
    segments: manifest.segments,
    features,
    stores: stores.map((s) => ({ ...s, segments: storeResults.get(s.id)?.segments ?? s.segments, revenue: storeResults.get(s.id)?.revenue ?? 0, fill: storeResults.get(s.id)?.fillRate ?? 1 })),
    dcs: loadDcs().map((d) => ({ id: d.id, name: d.name, lon: d.lon, lat: d.lat, result: result.dcs.find((x) => x.id === d.id) })),
    competitors: loadCompetitors(),
    totals: result.totals,
    generated: new Date().toISOString(),
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(payload.title)}</title>
<style>${css}</style>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 13px; color: #0b0b0b; background: #f9f9f7; }
  #app { display: grid; grid-template-columns: 320px 1fr; height: 100vh; }
  aside { padding: 16px; overflow: auto; background: #fcfcfb; border-right: 1px solid rgba(0,0,0,.12); }
  h1 { font-size: 17px; margin: 0 0 6px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #52514e; margin: 16px 0 6px; }
  .muted { color: #52514e; }
  .seg { display: flex; flex-wrap: wrap; border: 1px solid rgba(0,0,0,.12); border-radius: 8px; overflow: hidden; margin-bottom: 8px; }
  .seg button { flex: 1 1 auto; border: 0; background: transparent; padding: 7px 6px; font: inherit; font-size: 12px; cursor: pointer; color: #52514e; }
  .seg button.on { background: #0b0b0b; color: #fff; font-weight: 600; }
  select { width: 100%; padding: 6px; border: 1px solid rgba(0,0,0,.12); border-radius: 8px; font: inherit; margin-bottom: 8px; }
  .legend div { display: flex; align-items: center; gap: 8px; margin: 3px 0; }
  .sw { width: 14px; height: 14px; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); flex: none; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  td, th { padding: 4px 6px; border-bottom: 1px solid #e1e0d9; text-align: right; font-size: 12px; }
  td:first-child, th:first-child { text-align: left; }
  #map { height: 100%; }
  .leaflet-tooltip { font: 12px system-ui; }
  .tile { display: inline-block; padding: 8px 10px; border: 1px solid rgba(0,0,0,.12); border-radius: 8px; margin: 0 6px 6px 0; background: #f9f9f7; }
  .tile b { display: block; font-size: 18px; }
  .foot { font-size: 11px; color: #898781; margin-top: 16px; }
</style>
</head>
<body>
<div id="app">
  <aside>
    <h1 id="title"></h1>
    <p class="muted">Where candy demand is, who we already capture, and where the specialty segments live. Ten-county metro Atlanta by census tract.</p>
    <div id="tiles"></div>
    <h2>Layer</h2>
    <div class="seg" id="modes"></div>
    <select id="segment"></select>
    <div class="legend" id="legend"></div>
    <h2>Stores</h2>
    <table id="stores"></table>
    <h2>Distribution centers</h2>
    <table id="dcs"></table>
    <div class="foot" id="foot"></div>
  </aside>
  <div id="map"></div>
</div>
<script>${js}</script>
<script id="data" type="application/json">${JSON.stringify(payload).replace(/<\/script/gi, "<\\/script")}</script>
<script>
(function () {
  const D = JSON.parse(document.getElementById('data').textContent);
  const $ = (id) => document.getElementById(id);
  const money = (x) => Math.abs(x) >= 1e6 ? '$' + (x/1e6).toFixed(1) + 'M' : Math.abs(x) >= 1e3 ? '$' + Math.round(x/1e3) + 'k' : '$' + Math.round(x);
  const pct = (x) => (x*100).toFixed(x < 0.1 ? 1 : 0) + '%';
  $('title').textContent = D.title;
  // Two different shares on one page: the tile is chain revenue after supply
  // caps over all regional spend, the layer is what a tract's own stores draw
  // before caps. Both labels say which, because "share" alone read as one number.
  $('tiles').innerHTML = '<div class="tile"><b>' + money(D.totals.marketDemand) + '</b>market / yr</div><div class="tile"><b>' + money(D.totals.ourRevenue) + '</b>our revenue</div><div class="tile"><b>' + pct(D.totals.ourShare) + '</b>share of spend we sell</div>';
  const MODES = [['demand','Demand'],['specialty','Specialty'],['share','We capture'],['uncaptured','Uncaptured']];
  let mode = D.mode, segment = D.segment;
  const BLUE = ['#cde2fb','#86b6ef','#3987e5','#1c5cab','#0d366b'];
  const ORANGE = ['#fbe3d6','#f5b592','#eb6834','#b84a1f','#7a2f11'];
  const GREEN = ['#e1e0d9','#b7e0c0','#6cc08b','#2c9a5a','#006b2f'];
  function bins(values) { const s = values.filter(v => v > 0).sort((a,b)=>a-b); const q = (p) => s.length ? s[Math.floor((s.length-1)*p)] : 0; return [q(.2), q(.4), q(.6), q(.8)]; }
  function colorFor(p) {
    if (p.pop === 0) return '#c3c2b7';
    if (mode === 'demand') return ramp(p.d, demandBins, BLUE);
    if (mode === 'specialty') { const v = p.sp[segment] || 0; return v > 0 ? ramp(v, specBins, ORANGE) : '#e1e0d9'; }
    if (mode === 'share') return p.sh <= 0 ? '#e1e0d9' : p.sh < .1 ? GREEN[1] : p.sh < .25 ? GREEN[2] : p.sh < .5 ? GREEN[3] : GREEN[4];
    return ramp(p.un, uncapBins, BLUE);
  }
  function ramp(v, b, cols) { if (v <= 0) return cols[0]; for (let i = 0; i < b.length; i++) if (v < b[i]) return cols[i]; return cols[4]; }
  const demandBins = bins(D.features.map(f => f.properties.d));
  const uncapBins = bins(D.features.map(f => f.properties.un));
  let specBins = bins(D.features.map(f => f.properties.sp[segment] || 0));
  const map = L.map('map').setView([33.85, -84.35], 9);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri', maxZoom: 16 }).addTo(map);
  const layer = L.geoJSON({ type: 'FeatureCollection', features: D.features }, {
    style: (f) => ({ fillColor: colorFor(f.properties), fillOpacity: .75, color: '#fff', weight: .5 }),
    onEachFeature: (f, l) => {
      const p = f.properties;
      const sp = Object.entries(p.sp).map(([k,v]) => (D.segments.find(s => s.id === k) || {label:k}).label + ' ' + money(v)).join(', ');
      l.bindTooltip('<b>' + p.n + '</b><br>' + p.pl + ' · ' + p.pop.toLocaleString() + ' residents<br>demand ' + money(p.d) + '/yr · we capture ' + pct(p.sh) + (sp ? '<br>specialty: ' + sp : '') + (p.ps ? '<br>primary store: ' + (D.stores.find(s => s.id === p.ps) || {name: p.ps}).name : ''), { sticky: true });
    }
  }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { pane: 'markerPane', opacity: .9 }).addTo(map);
  for (const c of D.competitors) L.circleMarker([c.lat, c.lon], { radius: 4, color: '#fff', weight: 1, fillColor: '#898781', fillOpacity: .9 }).bindTooltip(c.name + ' (competitor)').addTo(map);
  for (const d of D.dcs) L.circleMarker([d.lat, d.lon], { radius: 9, color: '#0b0b0b', weight: 2, fillColor: '#eda100', fillOpacity: 1 }).bindTooltip('<b>' + d.name + '</b> distribution center').addTo(map);
  for (const s of D.stores) L.circleMarker([s.lat, s.lon], { radius: 8, color: '#0b0b0b', weight: 2, fillColor: s.type === 'general' ? '#2a78d6' : '#e87ba4', fillOpacity: 1, dashArray: s.proposed ? '3 3' : null }).bindTooltip('<b>' + s.name + '</b><br>' + s.type + (s.segments.length ? ' (' + s.segments.join(', ') + ')' : '') + ' · ' + money(s.revenue) + '/yr' + (s.proposed ? ' · proposed' : '')).addTo(map);
  function renderModes() {
    $('modes').innerHTML = MODES.map(([id, label]) => '<button class="' + (mode === id ? 'on' : '') + '" data-m="' + id + '">' + label + '</button>').join('');
    $('modes').querySelectorAll('button').forEach(b => b.onclick = () => { mode = b.dataset.m; refresh(); });
    $('segment').style.display = mode === 'specialty' ? '' : 'none';
    const b = mode === 'demand' ? demandBins : mode === 'specialty' ? specBins : mode === 'uncaptured' ? uncapBins : null;
    const cols = mode === 'specialty' ? ORANGE : mode === 'share' ? GREEN : BLUE;
    const labels = mode === 'share' ? ['none', 'under 10%', '10–25%', '25–50%', 'over 50%'] : ['lowest fifth', '', 'middle', '', 'highest fifth'];
    $('legend').innerHTML = cols.map((c, i) => '<div><span class="sw" style="background:' + c + '"></span><span>' + (mode === 'share' ? labels[i] : (b && i < 4 ? 'under ' + money(b[i]) : b ? money(b[3]) + ' and up' : '')) + '</span></div>').join('') + '<div><span class="sw" style="background:#2a78d6;border-radius:50%"></span>general store</div><div><span class="sw" style="background:#e87ba4;border-radius:50%"></span>specialty store</div><div><span class="sw" style="background:#eda100;border-radius:50%"></span>distribution center</div><div><span class="sw" style="background:#898781;border-radius:50%"></span>competitor</div>';
  }
  function refresh() { specBins = bins(D.features.map(f => f.properties.sp[segment] || 0)); renderModes(); layer.setStyle((f) => ({ fillColor: colorFor(f.properties), fillOpacity: .75, color: '#fff', weight: .5 })); }
  $('segment').innerHTML = D.segments.map(s => '<option value="' + s.id + '"' + (s.id === segment ? ' selected' : '') + '>' + s.label + '</option>').join('');
  $('segment').onchange = (e) => { segment = e.target.value; refresh(); };
  $('stores').innerHTML = '<tr><th>Store</th><th>Type</th><th>Revenue/yr</th></tr>' + D.stores.map(s => '<tr><td>' + s.name + (s.proposed ? ' <span class="muted">(proposed)</span>' : '') + '</td><td>' + s.type + '</td><td>' + money(s.revenue) + (s.fill < .999 ? ' <span class="muted">fill ' + pct(s.fill) + '</span>' : '') + '</td></tr>').join('');
  // Unclamped on purpose: a center working past its weekly capacity is the
  // thing to see, and clamping it to "100%" hid the shortfall. Mirrors
  // utilization() in lib/tools/shared.ts.
  const used = (v, cap) => cap > 0 ? pct(v / cap) : 'no capacity';
  $('dcs').innerHTML = '<tr><th>Center</th><th>Category</th><th>Used</th></tr>' + D.dcs.flatMap(d => Object.entries(d.result ? d.result.weeklyDemand : {}).filter(([,v]) => v > 0).map(([c, v]) => '<tr><td>' + d.name + '</td><td>' + c.replace('specialty:', '') + '</td><td>' + used(v, d.result.capacity[c] || 0) + '</td></tr>')).join('');
  $('foot').textContent = 'Generated ' + D.generated.slice(0, 16).replace('T', ' ') + '. Demographics: ACS 5-year via the Census Bureau. Competitors: OpenStreetMap. The chain itself is fictional: its stores, base spend, store costs, distribution centers and capacities are mock assumptions.';
  renderModes();
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
