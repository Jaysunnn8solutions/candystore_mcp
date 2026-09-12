"use client";

import { useState } from "react";
import type { Store, StoreType } from "@/lib/model/types";
import { Legend } from "../Legend";
import { ourShare } from "../MarketMap";
import { MODES, fmtNum, money, pct, type Mode } from "../scales";
import type { SelectedTract } from "./types";
import styles from "./MapOverlays.module.css";
import w from "./Widgets.module.css";

interface Props {
  mode: Mode;
  breaks: number[];
  stores: Store[];
  storeSlots: Map<string, string>;
  selected: SelectedTract | null;
  labels: Record<string, string>;
  onClearSelection: () => void;
  showCompetitors: boolean;
  onShowCompetitors: (v: boolean) => void;
  placing: StoreType | null;
}

/**
 * The legend and the tract card, over the map instead of in a column. Selecting
 * a tract now evicts nothing: the outcome figures, both rails and the deck are
 * unchanged while the card is open.
 */
export function MapOverlays(p: Props) {
  const [legendOpen, setLegendOpen] = useState(true);
  const mode = MODES.find((m) => m.id === p.mode)!;

  return (
    <div className={styles.layer}>
      <div className={`${styles.card} ${styles.legend}`} aria-label="Map legend">
        <div className={styles.legendHead}>
          <span className={styles.legendTitle}>{mode.label}</span>
          <button type="button" className={w.iconBtn} aria-expanded={legendOpen} aria-controls="legend-body" aria-label={legendOpen ? "Collapse the legend" : "Expand the legend"} onClick={() => setLegendOpen((v) => !v)}>
            {legendOpen ? "▾" : "▸"}
          </button>
        </div>
        {/* Collapsed still shows the ramp, so the map is never legend-less. */}
        <div id="legend-body">
          <Legend mode={p.mode} breaks={p.breaks} stores={p.stores} storeSlots={p.storeSlots} showCompetitors={p.showCompetitors} onShowCompetitors={p.onShowCompetitors} compact={!legendOpen} />
        </div>
      </div>

      {p.placing && (
        <div className={`${styles.card} ${styles.hint}`} role="status">
          Click the map to open a {p.placing} store — Esc to cancel.
        </div>
      )}

      {p.selected && <TractInspector sel={p.selected} labels={p.labels} stores={p.stores} onClose={p.onClearSelection} />}
    </div>
  );
}

function TractInspector({ sel, labels, stores, onClose }: { sel: SelectedTract; labels: Record<string, string>; stores: Store[]; onClose: () => void }) {
  const { props: t, result: r } = sel;
  const heritage = Object.entries(t.heritage).filter(([, v]) => v >= 0.02).sort((a, b) => b[1] - a[1]);
  // An apportioned 2019 count is split out of the 2010 tracts by land area, so
  // one tract's change is rough. A missing basis is no promise that it is not,
  // so only a recorded "direct" earns the unqualified number.
  const exact2019 = t.pop2019Basis === "direct";
  const basis2019 = exact2019
    ? "The 2019 count comes from one unchanged 2010 tract."
    : t.pop2019Basis === "apportioned"
      ? "The 2019 count is apportioned by land area from the re-delineated 2010 tracts, so this tract's change is approximate."
      : "This tract records no basis for its 2019 count, so treat the change as approximate.";

  return (
    <section className={`${styles.card} ${styles.inspector}`} aria-label={`Tract ${t.name}`}>
      <div className={styles.inspectorHead}>
        <h2>{t.name}</h2>
        <button type="button" className={w.iconBtn} onClick={onClose} aria-label="Close">×</button>
      </div>
      <p className={styles.where}>{t.place}, {t.county} County · {fmtNum(t.pop)} residents · {fmtNum(t.households)} households</p>

      {r && (
        <div className={styles.figures}>
          <div className={styles.figure}>
            <span className={styles.figureValue}>{money(r.total)}</span>
            <span className={styles.figureLabel}>candy spend / yr</span>
          </div>
          <div className={styles.figure}>
            <span className={styles.figureValue}>{pct(ourShare(r))}</span>
            <span className={styles.figureLabel}>we capture</span>
          </div>
        </div>
      )}

      {r && (
        <dl className={styles.facts}>
          {Object.entries(r.byCategory).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
            <div key={c} className={styles.factRow}>
              <dt>{c === "traditional" ? "Traditional" : `${labels[c.replace("specialty:", "")] ?? c} specialty`}</dt>
              <dd>{money(v)} · {pct(r.captured[c] ?? 0)} ours</dd>
            </div>
          ))}
        </dl>
      )}
      {r?.primaryStore && <p className={styles.note}>Shops mostly at {stores.find((s) => s.id === r.primaryStore)?.name ?? r.primaryStore}.</p>}

      <h3 className={styles.h3}>People</h3>
      <dl className={styles.facts}>
        <dt>Median income</dt><dd>{t.medianIncome == null ? "n/a" : money(t.medianIncome)}</dd>
        <dt>Under 18</dt><dd>{t.childShare == null ? "n/a" : pct(t.childShare)}</dd>
        <dt>Foreign-born</dt><dd>{t.foreignBornShare == null ? "n/a" : pct(t.foreignBornShare)}</dd>
        <dt>Density</dt><dd>{fmtNum(t.pop / Math.max(t.landKm2, 0.01))} / km²</dd>
        {t.pop2019 ? (
          <>
            <dt>Since 2019</dt>
            <dd title={basis2019}>
              {exact2019 ? "" : "~"}{t.pop >= t.pop2019 ? "+" : ""}{(((t.pop - t.pop2019) / t.pop2019) * 100).toFixed(0)}%
              {t.pop2019Basis === "apportioned" ? " (apportioned)" : ""}
            </dd>
          </>
        ) : null}
      </dl>

      {heritage.length > 0 && (
        <>
          <h3 className={styles.h3}>Heritage (born abroad, by region)</h3>
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
