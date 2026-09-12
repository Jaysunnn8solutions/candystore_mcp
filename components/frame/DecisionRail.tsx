"use client";

import { useMemo, useRef, type CSSProperties } from "react";
import type { SitePlan } from "@/lib/model/optimizer";
import type { MarketResult, Store, StoreType } from "@/lib/model/types";
import { STORE_TYPE_COLORS, money } from "../scales";
import { remainderIsCapacity, remainderNote } from "./plan-text";
import type { BudgetDraft, BudgetRequest } from "./types";
import { useOverflowWarn } from "./useOverflowWarn";
import { AddStoreChip, OpenSwitch } from "./widgets/ToggleChip";
import { Stepper } from "./widgets/Stepper";
import styles from "./DecisionRail.module.css";
import w from "./Widgets.module.css";

interface Props {
  /** Every store in the data, closed ones included, so a closed row can name itself. */
  allStores: Store[];
  scenario: Store[];
  closed: string[];
  result: MarketResult | null;
  labels: Record<string, string>;
  placing: StoreType | null;
  onPlacing: (t: StoreType | null) => void;
  onToggleClosed: (id: string) => void;
  onRemoveStore: (id: string) => void;
  budget: BudgetDraft;
  onBudget: (b: BudgetDraft) => void;
  onPlan: (r: BudgetRequest) => Promise<void>;
  plan: SitePlan | null;
  planning: boolean;
  onJumpToWorstMeter: () => void;
}

/*
 * Four, not five. $25M and $50M sit 5% and 10% along a 248–316px rail, which is
 * 13–16px apart: their labels printed as "2550" and no 24px target could be put
 * on either without swallowing the other. The stepper above reaches any figure
 * from $1M, so the preset is a shortcut, not the only route to $25M.
 */
const TICKS = [50, 100, 250, 500];
const BUDGET_MAX = 500;

export function DecisionRail(p: Props) {
  const rail = useRef<HTMLDivElement>(null);
  useOverflowWarn(rail, "decision rail");

  const closedSet = useMemo(() => new Set(p.closed), [p.closed]);
  const open = p.allStores.filter((s) => !closedSet.has(s.id));
  const shut = p.allStores.filter((s) => closedSet.has(s.id));
  /*
   * A link can carry a closed id this data does not have — the hash reader
   * accepts any id under 40 characters and the model drops unknown ids without
   * saying so. Intersecting with the roster made that id disappear from the rail
   * while the outcome bar's chip still counted it, so two figures on screen
   * disagreed and the only way out was the chip's × , which also wipes the
   * added stores and capacity overrides the same link carried. The id is all
   * there is to name it by, and it gets its own switch so it can be undone
   * alone.
   */
  const known = useMemo(() => new Set(p.allStores.map((s) => s.id)), [p.allStores]);
  /*
   * Only once the roster has arrived. `allStores` is empty until /api/static
   * resolves, and that request is issued beside the tract GeoJSON, the heaviest
   * payload in the app — so during every cold load of a shared link carrying
   * closures, every id in it looked unknown. The rail read "0 open · 3 closed"
   * over three struck-through raw ids, each claiming no store had that id, for
   * perfectly valid stores, and it stayed that way for good if the fetch failed.
   * An empty roster is not evidence that an id is wrong.
   */
  const orphans = useMemo(
    () => (p.allStores.length === 0 ? [] : [...closedSet].filter((id) => !known.has(id))),
    [closedSet, known, p.allStores.length]
  );
  const closedCount = shut.length + orphans.length;
  const maxDemand = Math.max(1, ...(p.result?.stores ?? []).map((s) => s.demand));

  const types = [p.budget.general && "general", p.budget.specialty && "specialty"].filter(Boolean) as StoreType[];

  const row = (s: Store, kind: "open" | "proposed" | "closed") => {
    const r = p.result?.stores.find((x) => x.id === s.id);
    // A specialty store placed with no segments has them picked for it, so the result knows what it carries.
    const segments = r?.segments ?? s.segments;
    const title = `${s.name} · ${s.type}${segments.length ? ` · ${segments.map((g) => p.labels[g] ?? g).join(", ")}` : ""}`;
    return (
      <li key={`${kind}-${s.id}`} className={styles.storeRow} data-closed={kind === "closed" ? "true" : undefined}>
        <span
          className={`${w.dot} ${kind === "closed" ? w.dotRing : kind === "proposed" ? w.dotDashed : ""}`}
          style={{ ["--dot" as string]: STORE_TYPE_COLORS[s.type] } as CSSProperties}
          aria-hidden
        />
        <span className={styles.storeName} title={title}>{s.name}</span>
        <span className={styles.storeFig}>
          <span className={styles.storeMoney}>{r ? `${money(r.revenue)}/yr` : kind === "closed" ? "closed" : "–"}</span>
          {r && r.demand > 0 && (
            // One mark for both "is this store big" and "is it supply-starved":
            // the unfilled step is exactly the demand the caps did not supply.
            <span className={w.twoTone} aria-hidden>
              <span style={{ width: `${(r.revenue / maxDemand) * 100}%` }} />
              <span style={{ width: `${(Math.max(r.demand - r.revenue, 0) / maxDemand) * 100}%` }} />
            </span>
          )}
        </span>
        {kind === "proposed" ? (
          <button type="button" className={w.iconBtn} aria-label={`Remove ${s.name}`} onClick={() => p.onRemoveStore(s.id)}>×</button>
        ) : (
          <OpenSwitch closed={kind === "closed"} name={s.name} onToggle={() => p.onToggleClosed(s.id)} />
        )}
      </li>
    );
  };

  return (
    <div ref={rail} className={styles.rail} data-armed={p.placing ? "true" : undefined} data-planned={p.plan ? "true" : undefined}>
      <h2 className={w.h2}>
        Our stores<span>{open.length} open{p.scenario.length > 0 ? ` · +${p.scenario.length} new` : ""}{closedCount > 0 ? ` · ${closedCount} closed` : ""}</span>
      </h2>
      <div className={styles.addRow}>
        {(["general", "specialty"] as StoreType[]).map((t) => (
          <AddStoreChip
            key={t}
            pressed={p.placing === t}
            color={STORE_TYPE_COLORS[t]}
            label={t === "general" ? "Add general" : "Add specialty"}
            onPress={() => p.onPlacing(p.placing === t ? null : t)}
          />
        ))}
      </div>
      {/* Every row's bar is two data classes, so it needs a key — the same one
          PlanResult prints over the identical construction. Once, under the
          heading, because every row shares one encoding. */}
      {p.result && (
        <ul className={`${w.keys} ${styles.rosterKeys}`}>
          <li><span className={w.keySwatch} style={{ ["--k" as string]: "var(--fill)" }} />keeps</li>
          <li><span className={w.keySwatch} style={{ ["--k" as string]: "var(--fill-track)" }} />not supplied</li>
        </ul>
      )}
      <ul className={styles.roster}>
        {open.map((s) => row(s, "open"))}
        {p.scenario.map((s) => row(s, "proposed"))}
        {closedCount > 0 && <li className={styles.closedHead}>Closed</li>}
        {shut.map((s) => row(s, "closed"))}
        {orphans.map((id) => (
          <li key={`gone-${id}`} className={styles.storeRow} data-closed="true">
            {/* No type, so no type colour: the dot falls back to --muted. */}
            <span className={`${w.dot} ${w.dotRing}`} aria-hidden />
            <span className={styles.storeName} title={`${id} — closed by the link, but no store with that id is in this data`}>{id}</span>
            <span className={styles.storeFig}>
              <span className={styles.storeMoney}>unknown</span>
            </span>
            <OpenSwitch closed name={id} onToggle={() => p.onToggleClosed(id)} />
          </li>
        ))}
      </ul>

      <div className={styles.spacer} />
      <div className={styles.divider} />

      <div className={styles.planBlock}>
        <h2 className={w.h2}>Expansion plan</h2>

        <div className={styles.budgetRow}>
          <label htmlFor="budget-m">Budget</label>
          <Stepper
            id="budget-m"
            label="budget in millions of dollars"
            value={p.budget.budgetM}
            onChange={(v) => p.onBudget({ ...p.budget, budgetM: v })}
            min={1}
            max={BUDGET_MAX}
            step={1}
            prefix="$"
            suffix="M"
            big
          />
        </div>
        <div className={styles.ruler}>
          <span className={styles.rulerTrack} aria-hidden />
          <span className={styles.rulerFill} style={{ width: `${(p.budget.budgetM / BUDGET_MAX) * 100}%` }} aria-hidden />
          {TICKS.map((t) => (
            <span key={t}>
              <button
                type="button"
                // The last tick is at 100%, where a symmetric target would run
                // off the rail's edge and be clipped, so it leans inward.
                className={`${styles.rulerTick} ${t === BUDGET_MAX ? styles.rulerTickLast : ""}`}
                style={{ left: `${(t / BUDGET_MAX) * 100}%` }}
                aria-label={`Set budget to $${t} million`}
                onClick={() => p.onBudget({ ...p.budget, budgetM: t })}
              />
              <span className={styles.rulerLabel} style={{ left: `${(t / BUDGET_MAX) * 100}%` }} aria-hidden>{t}</span>
            </span>
          ))}
        </div>

        {(["general", "specialty"] as StoreType[]).map((t) => {
          const on = t === "general" ? p.budget.general : p.budget.specialty;
          const cost = t === "general" ? p.budget.costG : p.budget.costS;
          return (
            <div key={t} className={styles.costRow} data-off={on ? undefined : "true"}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                className={w.chip}
                style={{ ["--dot" as string]: STORE_TYPE_COLORS[t] } as CSSProperties}
                onClick={() => p.onBudget({ ...p.budget, [t]: !on } as BudgetDraft)}
              >
                <span className={`${w.dot} ${on ? "" : w.dotRing}`} />
                <span className={styles.costName}>{t === "general" ? "General" : "Specialty"}</span>
              </button>
              <Stepper
                id={`cost-${t}`}
                label={`${t} store cost in millions of dollars`}
                value={cost}
                onChange={(v) => p.onBudget({ ...p.budget, [t === "general" ? "costG" : "costS"]: v } as BudgetDraft)}
                min={0.1}
                max={50}
                step={0.1}
                prefix="$"
                suffix="M"
                size="sm"
                className={styles.costStepper}
                disabled={!on}
              />
              <span className={styles.costAfford}>up to {Math.floor(p.budget.budgetM / Math.max(cost, 0.1))}</span>
            </div>
          );
        })}

        <button
          type="button"
          className={styles.planButton}
          disabled={p.planning || types.length === 0}
          title={types.length === 0 ? "Turn on at least one store type" : undefined}
          onClick={() => p.onPlan({ budget: p.budget.budgetM * 1e6, costGeneral: p.budget.costG * 1e6, costSpecialty: p.budget.costS * 1e6, types })}
        >
          {p.planning ? "Planning…" : "Plan the expansion"}
        </button>

        {p.plan ? <PlanResult plan={p.plan} labels={p.labels} onJumpToWorstMeter={p.onJumpToWorstMeter} /> : (
          <p className={styles.emptyPlan}>
            The optimizer opens stores one at a time by revenue added per dollar, counting sales pulled from our own
            stores and supply caps. Purchases join the scenario.
          </p>
        )}
      </div>
    </div>
  );
}

function PlanResult({ plan, labels, onJumpToWorstMeter }: { plan: SitePlan; labels: Record<string, string>; onJumpToWorstMeter: () => void }) {
  const maxRevenue = Math.max(1, ...plan.picks.map((k) => k.storeRevenue));
  const note = remainderNote(plan);
  const capacityFix = remainderIsCapacity(plan);
  return (
    <>
      <p className={styles.verdict}>
        {money(plan.spent)} opens {plan.picks.length} stores and lifts revenue {money(plan.baseline.ourRevenue)} → {money(plan.after.ourRevenue)} a year.
      </p>
      {plan.picks.length > 0 && (
        <ul className={w.keys}>
          <li><span className={w.keySwatch} style={{ ["--k" as string]: "var(--fill)" }} />this store keeps</li>
          <li><span className={w.keySwatch} style={{ ["--k" as string]: "var(--fill-soft)" }} />pulled from our own stores</li>
        </ul>
      )}
      <ol className={styles.picks}>
        {plan.picks.map((k) => (
          <li key={k.step} className={styles.pick}>
            <span className={styles.pickHead}>
              <span className={styles.pickWhere} title={`${k.store.name} — ${k.tractName}, ${k.place}, ${k.county} County`}>
                {k.store.type}
                {k.store.segments.length ? ` (${k.store.segments.map((g) => labels[g] ?? g).join(", ")})` : ""} near {k.tractName}
              </span>
              {/* gain is net of cannibalization AND caps, so it is not a
                  segment of the bar beside it — it is printed as its own number. */}
              <span className={styles.pickGain}>+{money(k.gain)}/yr</span>
            </span>
            <span className={w.pickBar} aria-hidden>
              <span style={{ width: `${(Math.max(k.storeRevenue - k.cannibalized, 0) / maxRevenue) * 100}%` }} />
              <span style={{ width: `${(Math.max(k.cannibalized, 0) / maxRevenue) * 100}%` }} />
            </span>
          </li>
        ))}
      </ol>
      {plan.remaining > 0 && plan.picks.length > 0 && (
        <p className={styles.note}>
          {money(plan.remaining)} left:{" "}
          {capacityFix ? (
            <button type="button" className={styles.noteLink} onClick={onJumpToWorstMeter}>{note}</button>
          ) : (
            note
          )}
        </p>
      )}
    </>
  );
}
