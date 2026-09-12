"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { latLng, type Layer, type PathOptions } from "leaflet";
import type { Feature } from "geojson";
import "leaflet/dist/leaflet.css";
import type { TractCollection } from "@/lib/data/load";
import type { Competitor, DistributionCenter, MarketResult, Store, StoreType, TractProps } from "@/lib/model/types";
import {
  BLUE,
  COMPETITOR_COLOR,
  DC_COLOR,
  GREEN,
  NEUTRAL,
  NO_DATA,
  ORANGE,
  SEARCH_COLOR,
  STORE_TYPE_COLORS,
  fmtNum,
  money,
  pct,
  quintiles,
  ramp,
  shareColor,
  utilization,
  type Mode,
} from "./scales";
import { useMapResize } from "./frame/useMapResize";
import styles from "./GapMap.module.css";

export interface MapPoint {
  lon: number;
  lat: number;
  label: string;
}

interface Props {
  tracts: TractCollection;
  result: MarketResult | null;
  version: number;
  mode: Mode;
  segment: string;
  segmentLabels: Record<string, string>;
  stores: Store[];
  /** Store id → trade-area colour, keyed to identity rather than list position. */
  storeSlots: Map<string, string>;
  dcs: DistributionCenter[];
  competitors: Competitor[];
  showCompetitors: boolean;
  placing: StoreType | null;
  searchMarker: MapPoint | null;
  flyTo: MapPoint | null;
  selected: string | null;
  onSelect: (geoid: string | null) => void;
  onPlace: (lon: number, lat: number) => void;
  onRemoveStore: (id: string) => void;
}

const CENTER: [number, number] = [33.85, -84.35];
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const TILES = {
  light: `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  dark: `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  labelsLight: `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  labelsDark: `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
};
const ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors";
const DARK_QUERY = "(prefers-color-scheme: dark)";
/** How many trade areas carry a name on the map itself. The legend names them all. */
const MAX_AREA_LABELS = 6;

function subscribeDark(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function useDarkMode() {
  return useSyncExternalStore(subscribeDark, () => window.matchMedia(DARK_QUERY).matches, () => false);
}

function MapEvents({ placing, onPlace }: { placing: StoreType | null; onPlace: (lon: number, lat: number) => void }) {
  const map = useMapEvents({
    click(e) {
      if (placing) onPlace(e.latlng.lng, e.latlng.lat);
    },
  });
  useEffect(() => {
    const el = map.getContainer();
    el.style.cursor = placing ? "crosshair" : "";
    return () => {
      el.style.cursor = "";
    };
  }, [map, placing]);
  return null;
}

function FlyTo({ target }: { target: MapPoint | null }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    // Padded away from the top-right corner, where the tract inspector sits:
    // a searched place or a plan's first pick must not land under the card.
    map.stop();
    map.flyToBounds(latLng(target.lat, target.lon).toBounds(600), {
      paddingTopLeft: [0, 0],
      paddingBottomRight: [304, 0],
      maxZoom: Math.max(map.getZoom(), 12),
      duration: 0.8,
    });
  }, [map, target]);
  return null;
}

/**
 * Leaflet listens only for `window resize`, and the frame changes the map
 * container without one when focus mode collapses the rails.
 */
function ResizeWatcher() {
  useMapResize(useMap());
  return null;
}

export default function MarketMap(props: Props) {
  const { tracts, result, version, mode, segment, segmentLabels, stores, storeSlots, dcs, competitors, showCompetitors, placing, searchMarker, flyTo, selected, onSelect, onPlace, onRemoveStore } = props;
  const dark = useDarkMode();

  // react-leaflet runs onEachFeature once per GeoJSON mount, so the click
  // handlers below keep whatever `placing` was then. A ref lets them read the
  // current mode without remounting 1200 polygons to flip a cursor.
  const placingRef = useRef(placing);
  useEffect(() => {
    placingRef.current = placing;
  }, [placing]);

  const byGeoid = useMemo(() => new Map(result?.tracts.map((t) => [t.geoid, t]) ?? []), [result]);
  const breaks = useMemo(() => {
    const all = result?.tracts ?? [];
    const cat = `specialty:${segment}`;
    return {
      demand: quintiles(all.map((t) => t.total)),
      specialty: quintiles(all.map((t) => t.byCategory[cat] ?? 0)),
      uncaptured: quintiles(all.map((t) => uncaptured(t))),
    };
  }, [result, segment]);

  const layerKey = `${mode}-${segment}-${version}-${selected ?? ""}-${stores.length}`;

  /**
   * Which stores earn a permanent label in Trade areas. Leaflet tooltips do no
   * collision avoidance, so one label per store is only readable while the
   * chain is small — and the sidebar's default $10M plan opens ten more, which
   * piled fifteen labels on top of each other over central Atlanta.
   *
   * Direct labels are selective by rule: the biggest trade areas get named on
   * the map, and the legend carries every store, so identity is never lost —
   * only repeated. Ties break by id so the set cannot flicker between renders.
   */
  const labelled = useMemo(() => {
    if (mode !== "primary") return new Set<string>();
    const won = new Map<string, number>();
    for (const t of result?.tracts ?? []) {
      if (t.primaryStore) won.set(t.primaryStore, (won.get(t.primaryStore) ?? 0) + 1);
    }
    const ranked = stores
      .filter((s) => (won.get(s.id) ?? 0) > 0)
      .sort((a, b) => (won.get(b.id) ?? 0) - (won.get(a.id) ?? 0) || a.id.localeCompare(b.id));
    return new Set(ranked.slice(0, MAX_AREA_LABELS).map((s) => s.id));
  }, [mode, result, stores]);

  const style = useMemo(
    () =>
      (feature?: Feature): PathOptions => {
        const p = feature?.properties as TractProps;
        const t = byGeoid.get(p.geoid);
        let fill = NO_DATA;
        if (t && p.pop > 0) {
          if (mode === "demand") fill = ramp(t.total, breaks.demand, BLUE);
          else if (mode === "specialty") {
            const v = t.byCategory[`specialty:${segment}`] ?? 0;
            fill = v > 0 ? ramp(v, breaks.specialty, ORANGE) : NEUTRAL;
          } else if (mode === "share") fill = shareColor(ourShare(t));
          else if (mode === "uncaptured") fill = ramp(uncaptured(t), breaks.uncaptured, BLUE);
          else fill = t.primaryStore ? (storeSlots.get(t.primaryStore) ?? NEUTRAL) : NEUTRAL;
        }
        const isSelected = selected === p.geoid;
        return { fillColor: fill, fillOpacity: mode === "primary" ? 0.55 : 0.78, color: isSelected ? "#0b0b0b" : dark ? "#2c2c2a" : "#ffffff", weight: isSelected ? 3 : 0.5, opacity: 1 };
      },
    [byGeoid, mode, segment, breaks, selected, dark, storeSlots]
  );

  const onEachFeature = (feature: Feature, layer: Layer) => {
    const p = feature.properties as TractProps;
    const t = byGeoid.get(p.geoid);
    const specialty = t
      ? Object.entries(t.byCategory)
          .filter(([c]) => c !== "traditional")
          .map(([c, v]) => `${segmentLabels[c.replace("specialty:", "")] ?? c} ${money(v)}`)
          .join(", ")
      : "";
    layer.bindTooltip(
      `<strong>${p.name}</strong><br/>${p.place} · ${fmtNum(p.pop)} residents` +
        (t ? `<br/>demand ${money(t.total)}/yr · we capture ${pct(ourShare(t))}` : "") +
        (specialty ? `<br/>specialty: ${specialty}` : "") +
        (t?.primaryStore ? `<br/>shops at ${stores.find((s) => s.id === t.primaryStore)?.name ?? t.primaryStore}` : ""),
      { sticky: true, className: styles.tooltip, direction: "top", offset: [0, -8] }
    );
    layer.on({
      click: () => {
        if (placingRef.current) return;
        onSelect(selected === p.geoid ? null : p.geoid);
      },
    });
  };

  const ink = dark ? "#ffffff" : "#0b0b0b";
  const stroke = dark ? "#1a1a19" : "#ffffff";

  return (
    <MapContainer center={CENTER} zoom={9} minZoom={8} maxZoom={16} className={styles.map}>
      <MapEvents placing={placing} onPlace={onPlace} />
      <FlyTo target={flyTo} />
      <ResizeWatcher />
      <TileLayer key={dark ? "dark" : "light"} url={dark ? TILES.dark : TILES.light} attribution={ATTRIBUTION} />
      <GeoJSON key={layerKey} data={tracts} style={style} onEachFeature={onEachFeature} />
      <TileLayer key={dark ? "ld" : "ll"} url={dark ? TILES.labelsDark : TILES.labelsLight} pane="markerPane" opacity={0.9} />
      {showCompetitors &&
        competitors.map((c) => (
          <CircleMarker key={c.id} center={[c.lat, c.lon]} radius={4} pathOptions={{ color: stroke, weight: 1, fillColor: COMPETITOR_COLOR, fillOpacity: 0.9 }}>
            <Tooltip direction="top" offset={[0, -4]}>{c.name} · competitor</Tooltip>
          </CircleMarker>
        ))}
      {dcs.map((d) => {
        const r = result?.dcs.find((x) => x.id === d.id);
        const used = r ? Object.entries(r.weeklyDemand).filter(([, v]) => v > 0).map(([c, v]) => `${c.replace("specialty:", "")} ${utilization(v, r.capacity[c] ?? 0)}`).join(", ") : "";
        return (
          <CircleMarker key={d.id} center={[d.lat, d.lon]} radius={10} pathOptions={{ color: ink, weight: 2, fillColor: DC_COLOR, fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -10]}>{d.name} · distribution center{used ? ` · ${used}` : ""}</Tooltip>
          </CircleMarker>
        );
      })}
      {stores.map((s) => {
        const r = result?.stores.find((x) => x.id === s.id);
        // A specialty store placed with no segments has them picked for it, so the result knows what it carries.
        const segments = r?.segments ?? s.segments;
        return (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lon]}
            radius={s.proposed ? 9 : 8}
            pathOptions={{ color: mode === "primary" ? (storeSlots.get(s.id) ?? ink) : ink, weight: mode === "primary" ? 4 : 2, fillColor: STORE_TYPE_COLORS[s.type], fillOpacity: 1, dashArray: s.proposed ? "3 3" : undefined }}
            eventHandlers={s.proposed ? { click: () => onRemoveStore(s.id) } : {}}
          >
            <Tooltip direction="top" offset={[0, -9]}>
              {s.name} · {s.type}
              {segments.length ? ` (${segments.map((g) => segmentLabels[g] ?? g).join(", ")})` : ""}
              {r ? ` · ${money(r.revenue)}/yr` : ""}
              {s.proposed ? " · proposed, click to remove" : ""}
            </Tooltip>
          </CircleMarker>
        );
      })}
      {/* Direct labels for the trade areas, on an anchor of their own so the
          store marker keeps its hover tooltip. Only in this layer: elsewhere
          the fill means demand, not identity, and permanent labels would be
          noise. Only the largest few areas, because Leaflet does not move a
          label out of another one's way — see `labelled` above. */}
      {stores
        .filter((s) => labelled.has(s.id))
        .map((s) => (
          <CircleMarker key={`label-${s.id}`} center={[s.lat, s.lon]} radius={1} interactive={false} pathOptions={{ opacity: 0, fillOpacity: 0 }}>
            <Tooltip direction="bottom" offset={[0, 8]} permanent className={styles.areaLabel}>{s.name}</Tooltip>
          </CircleMarker>
        ))}
      {searchMarker && (
        <CircleMarker center={[searchMarker.lat, searchMarker.lon]} radius={9} pathOptions={{ color: ink, weight: 2, fillColor: SEARCH_COLOR, fillOpacity: 1 }}>
          <Tooltip direction="top" offset={[0, -9]} permanent>{searchMarker.label}</Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  );
}

export function ourShare(t: MarketResult["tracts"][number]): number {
  if (t.total <= 0) return 0;
  return Object.entries(t.byCategory).reduce((s, [c, v]) => s + v * (t.captured[c] ?? 0), 0) / t.total;
}

export function uncaptured(t: MarketResult["tracts"][number]): number {
  return t.total * (1 - ourShare(t));
}

export { GREEN };
