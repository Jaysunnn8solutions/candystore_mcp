"use client";

import { useEffect, useRef, useState } from "react";
import type { MarketResult, ScenarioParams, Store } from "@/lib/model/types";
import { money, pct } from "../scales";
import { PARAM_FIELDS, changedParamCount } from "./params-fields";
import type { PopoverId } from "./types";
import styles from "./OutcomeBar.module.css";
import w from "./Widgets.module.css";

interface Props {
  result: MarketResult | null;
  baseline: MarketResult | null;
  resultIsScenario: boolean;
  scenarioActive: boolean;
  busy: boolean;
  scenario: Store[];
  closed: string[];
  capacityScale: Array<{ dc: string; category: string; factor: number }>;
  params: ScenarioParams;
  onClearScenario: () => void;
  onCopy: (kind: "link" | "settings") => Promise<{ text: string; copied: boolean }>;
  onExport: () => void;
  ready: boolean;
  boardOpen: boolean;
  onBoard: () => void;
  focusMode: boolean;
  onFocus: () => void;
  onJumpToWorstMeter: () => void;
  popover: PopoverId;
  onPopover: (p: PopoverId) => void;
  narrow: boolean;
}

/**
 * The same words at two lengths. Below 1101px a tile is about 80px wide and the
 * long form ellipsises; a sublabel that reads "raise capacit…" has lost exactly
 * the part that made it a next action, so a shorter true phrase beats a clipped
 * long one. Swapped by media query rather than by JS, so nothing re-renders on
 * a resize and the hidden half never reaches the accessibility tree.
 */
function Tight({ long, short }: { long: string; short: string }) {
  return (
    <>
      <span className={styles.atWidth}>{long}</span>
      <span className={styles.whenTight}>{short}</span>
    </>
  );
}

/** What the scenario changed, in one phrasing the chip and the ribbon share. */
function scenarioParts(scenario: Store[], closed: string[], capacityScale: Array<unknown>): string[] {
  return [
    scenario.length > 0 ? `▲${scenario.length} added` : null,
    closed.length > 0 ? `⊘${closed.length} closed` : null,
    capacityScale.length > 0 ? `×${capacityScale.length} caps` : null,
  ].filter((x): x is string => x !== null);
}

/**
 * The three summary tiles, the lost-to-caps sentence and the share buttons, all
 * of which used to live in a scrolling column and vanish whenever a tract was
 * selected. Here they are permanent, and the decomposition is drawn rather than
 * left to be inferred: marketDemand = ourRevenue + lostToCaps + everything the
 * split gave to someone else is an exact identity in the model, so a stacked
 * bar is the honest form.
 */
export function OutcomeBar(p: Props) {
  const t = p.result?.totals;
  const ours = t?.ourRevenue ?? 0;
  const caps = t?.lostToCaps ?? 0;
  /* marketDemand − ourDemand is every dollar the Huff split did not award us:
     competitors, the constant outside option (grocery and online), and tracts
     no outlet of ours reaches. It was called "Not in reach", which asserts a
     cause the model never establishes — at defaults $38.6M of this sits inside
     the 8km reach of an open store, and widening reach to 20km leaves 59% of it
     inside a store's reach. The figure is unchanged; only the name is, so it
     now claims exactly what the arithmetic supports. */
  const elsewhere = Math.max(0, (t?.marketDemand ?? 0) - (t?.ourDemand ?? 0));
  const showDelta = p.scenarioActive && p.resultIsScenario && p.baseline !== null;
  const deltaValue = ours - (p.baseline?.totals.ourRevenue ?? 0);
  const [shareText, setShareText] = useState<{ kind: "link" | "settings"; text: string } | null>(null);
  // The copy confirmation is owned here rather than inside ShareGroup because it
  // is rendered outside the bar's grid — see .status in the stylesheet.
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  /* Both layout states render these. The A key still toggles the about state in
     focus mode (Dashboard's handler is not gated on the layout) and the lens
     rail's own About button is inert there, so a focus-mode branch that
     returned the ribbon alone left the key documented but opening nothing — and
     the Esc meant to leave focus mode was then spent closing a panel that was
     never on screen. */
  const popovers = (
    <>
      {p.popover === "about" && (
        <AboutPopover params={p.params} narrow={p.narrow} focusMode={p.focusMode} onClose={() => p.onPopover(null)} />
      )}
      {p.popover === "share" && shareText && <SharePopover {...shareText} onClose={() => p.onPopover(null)} />}
    </>
  );

  if (p.focusMode) {
    return (
      <>
        <div className={styles.ribbon}>
          <span><strong>{money(t?.marketDemand ?? 0)}</strong> market</span>
          <span><strong>{money(ours)}</strong> ours</span>
          <span><strong>{pct(t?.ourShare ?? 0)}</strong> share</span>
          <span>{p.scenarioActive ? scenarioParts(p.scenario, p.closed, p.capacityScale).join(" · ") : "Baseline"}</span>
          <span className={styles.ribbonSpacer} />
          <button type="button" className={w.ghost} onClick={p.onFocus}>Exit focus map</button>
        </div>
        {popovers}
      </>
    );
  }

  return (
    // The popovers are siblings of the bar, not children: the bar clips its own
    // overflow so the figures ellipsize, and anything that hangs below it would
    // be clipped to a sliver.
    <>
    <div className={styles.bar} data-busy={p.busy ? "true" : undefined}>
      <div className={styles.identity}>
        <h1>Candy store planning</h1>
        <p className={styles.dek}>Ten-county metro Atlanta by census tract: demand, capture, where to open next.</p>
        <button type="button" className={styles.aboutBtn} aria-expanded={p.popover === "about"} onClick={() => p.onPopover(p.popover === "about" ? null : "about")}>
          About the data and the keys
        </button>
      </div>

      <div className={styles.funnel} role="group" aria-label="Demand funnel" aria-busy={p.busy}>
        <div className={styles.figures}>
          <div className={styles.fig}>
            <span className={styles.figLabel}><Tight long="Market demand" short="Market" /></span>
            <span className={styles.figValue}>{money(t?.marketDemand ?? 0)}</span>
            <span className={styles.figSub}><Tight long="candy spend per year" short="spend / yr" /></span>
          </div>
          <div className={styles.fig}>
            <span className={styles.figLabel}>We capture</span>
            <span className={`${styles.figValue} ${styles.figValueHero}`}>{money(ours)}</span>
            <span className={styles.figSub}>
              {pct(t?.ourShare ?? 0)} share
              {showDelta && (
                <span className={styles.delta}> · {deltaValue >= 0 ? "▲" : "▼"} {deltaValue >= 0 ? "+" : "−"}{money(Math.abs(deltaValue))} vs baseline</span>
              )}
            </span>
          </div>
          <button type="button" className={styles.fig} onClick={p.onJumpToWorstMeter} title="Jump to the tightest capacity meter">
            <span className={styles.figLabel}><Tight long="Lost to caps" short="Lost" /></span>
            <span className={styles.figValue}>{money(caps)}</span>
            <span className={styles.figSub}><Tight long="raise capacity ↓" short="raise caps ↓" /></span>
          </button>
          <div className={styles.fig}>
            <span className={styles.figLabel}><Tight long="Goes elsewhere" short="Elsewhere" /></span>
            <span className={styles.figValue}>{money(elsewhere)}</span>
            {/* The sub names the two largest destinations; the bar's accessible
                name below carries the whole list, including the tracts we do
                not reach, because it has the room and this tile does not.

                The short form may not be the long one with a word lopped off.
                At defaults this residual is 78% grocery and online and 22%
                competitors, so "competitors" alone named the smaller half and
                overstated it more than fourfold. "other shops" is shorter than
                the long form and true of all of it. */}
            <span className={styles.figSub}><Tight long="competitors and grocery" short="other shops" /></span>
          </div>
        </div>
        <div className={styles.barRow}>
          <div
            className={styles.track}
            role="img"
            aria-label={`Of ${money(t?.marketDemand ?? 0)} of annual candy spend, we capture ${money(ours)}, ${money(caps)} is lost to distribution caps, and ${money(elsewhere)} goes to competitors, other channels, or tracts our stores do not reach.`}
          >
            {/* A segment is drawn only when it has a quantity. The 2px floor in
                the stylesheet is there so a small-but-real value cannot vanish;
                applied at exactly zero it painted a red sliver under a printed
                "$0" and contradicted it. */}
            {ours > 0 && <span className={styles.segOurs} style={{ flexGrow: ours }} />}
            {caps > 0 && <span className={styles.segCaps} style={{ flexGrow: caps }} />}
            {elsewhere > 0 && <span className={styles.segReach} style={{ flexGrow: elsewhere }} />}
          </div>
        </div>
        {/* --reach is the palette token for this segment and keeps its name; the
            label it was named after was the wrong one. */}
        <ul className={`${w.keys} ${styles.keyCol}`}>
          <li><span className={w.keySwatch} style={{ ["--k" as string]: "var(--fill)" }} />ours</li>
          <li><span className={w.keySwatch} style={{ ["--k" as string]: "var(--over)" }} />lost to caps</li>
          <li><span className={w.keySwatch} style={{ ["--k" as string]: "var(--reach)" }} />goes elsewhere</li>
        </ul>
      </div>

      <div className={styles.actions}>
        <div className={styles.actionRow} aria-live="polite">
          <ScenarioChip
            scenario={p.scenario}
            closed={p.closed}
            capacityScale={p.capacityScale}
            active={p.scenarioActive}
            onClear={p.onClearScenario}
          />
        </div>
        <div className={styles.actionRow}>
          <ShareGroup onCopy={p.onCopy} onExport={p.onExport} ready={p.ready} onFallback={setShareText} onPopover={p.onPopover} onCopied={setCopied} />
          {/* Both collapse desktop regions, and below 1000px the frame is a
              stacked page with nothing to collapse. */}
          {!p.narrow && (
            <>
              <button type="button" className={w.ghost} aria-pressed={p.boardOpen} onClick={p.onBoard} title="Show every control and every row (\)">
                ⊞ All
              </button>
              {/* Icon-only, so the name comes from aria-label rather than from
                  the title, which is a last-resort fallback AT announces
                  inconsistently — and the glyph may not render at all. */}
              <button type="button" className={w.ghost} aria-label="Focus the map" aria-pressed={p.focusMode} onClick={p.onFocus} title="Focus the map (F)">
                ⛶
              </button>
            </>
          )}
        </div>
      </div>

    </div>

    {/* Outside the bar for the same reason the popovers are: in the actions row
        this 69-character line became the min width of an `auto` grid track and
        squeezed the funnel from 648px to 297px for the two seconds it was up. */}
    {copied && <p className={styles.status} role="status">{copied}</p>}

    {popovers}
    </>
  );
}

/**
 * What a stale or hand-edited link had to throw away. Hung below the bar rather
 * than inside it: the bar has no spare row, and a notice that covers the
 * headline figures is worse than no notice.
 */
export function DroppedNotice({ dropped, onDismiss }: { dropped: string[]; onDismiss: () => void }) {
  if (dropped.length === 0) return null;
  return (
    <div className={styles.dropped} role="status">
      <p>Parts of this link were dropped: {dropped.join("; ")}.</p>
      <button type="button" className={w.iconBtn} aria-label="Dismiss" onClick={onDismiss}>×</button>
    </div>
  );
}

/**
 * Clearing a scenario wipes added stores, closures, capacity overrides and the
 * plan with no undo, so the × asks once.
 */
function ScenarioChip({ scenario, closed, capacityScale, active, onClear }: { scenario: Store[]; closed: string[]; capacityScale: Array<unknown>; active: boolean; onClear: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [wasActive, setWasActive] = useState(active);
  useEffect(() => {
    if (!confirm) return;
    const id = window.setTimeout(() => setConfirm(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirm]);

  // A scenario that goes away and comes back must not arrive already armed to
  // clear itself on one click.
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setConfirm(false);
  }

  if (!active) return <span className={styles.baselineWord}>Baseline</span>;
  const parts = scenarioParts(scenario, closed, capacityScale);
  return (
    <span className={styles.scenarioChip}>
      {parts.join(" · ")}
      <button
        type="button"
        className={w.iconBtn}
        aria-label={confirm ? "Confirm clearing the scenario" : "Clear the scenario"}
        onClick={() => (confirm ? onClear() : setConfirm(true))}
      >
        {confirm ? <span style={{ fontSize: 10 }}>Clear?</span> : "×"}
      </button>
    </span>
  );
}

function ShareGroup({
  onCopy,
  onExport,
  ready,
  onFallback,
  onPopover,
  onCopied,
}: Pick<Props, "onCopy" | "onExport" | "ready" | "onPopover"> & {
  onFallback: (s: { kind: "link" | "settings"; text: string }) => void;
  onCopied: (message: string) => void;
}) {
  const copy = async (kind: "link" | "settings") => {
    const r = await onCopy(kind);
    if (r.copied) {
      onCopied(kind === "settings" ? "Copied. Paste it into a chat with the candystore-mcp server attached." : "Link copied.");
      return;
    }
    onFallback({ kind, text: r.text });
    onPopover("share");
  };

  return (
    <>
      <button type="button" className={w.ghost} onClick={() => copy("link")} disabled={!ready}>Copy link</button>
      <button type="button" className={w.ghost} onClick={() => copy("settings")} disabled={!ready}>Copy for Claude</button>
      <button type="button" className={w.ghost} onClick={onExport} disabled={!ready}>CSV</button>
    </>
  );
}

/**
 * When the clipboard is unavailable this textarea is the only route to the text,
 * so it closes on Esc, on its own ×, or on a pointerdown strictly outside it —
 * never on the selection gesture that makes it usable.
 */
function SharePopover({ kind, text, onClose }: { kind: "link" | "settings"; text: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  // The dialog takes focus and every dismissal path — Esc, the ×, a pointerdown
  // outside — unmounts it, so without this focus fell back to <body> and the
  // next Tab restarted from the top of the document. The textarea is focused
  // here rather than with autoFocus because autoFocus runs before this effect,
  // which would leave the textarea itself as the element recorded to go back to.
  useEffect(() => {
    const from = document.activeElement as HTMLElement | null;
    area.current?.focus();
    return () => from?.focus?.();
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  return (
    <div ref={box} className={`${w.popover} ${styles.sharePop}`} role="dialog" aria-label={kind === "settings" ? "Settings for Claude" : "Map link"}>
      <div className={w.popHead}>
        <strong>{kind === "settings" ? "Settings for Claude" : "Map link"}</strong>
        <span style={{ flex: 1 }} />
        <button type="button" className={w.iconBtn} aria-label="Close" onClick={onClose}>×</button>
      </div>
      <p>The clipboard was not available, so copy it from here.</p>
      <textarea ref={area} className={w.copyBox} readOnly value={text} rows={4} onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}

function AboutPopover({
  params,
  narrow,
  focusMode,
  onClose,
}: {
  params: ScenarioParams;
  narrow: boolean;
  focusMode: boolean;
  onClose: () => void;
}) {
  const changed = changedParamCount(params);
  return (
    <div className={`${w.popover} ${styles.aboutPop}`} role="dialog" aria-label="About this map">
      <div className={w.popHead}>
        <strong>About this map</strong>
        <span style={{ flex: 1 }} />
        <button type="button" className={w.iconBtn} aria-label="Close" onClick={onClose}>×</button>
      </div>
      <div className={w.popBody}>
        <p>
          Where candy demand is, which heritage segments want familiar candy, what our stores capture,
          where to open next, and what to tell suppliers. Ten-county metro Atlanta by census tract.
        </p>
        <h3>Where the numbers come from</h3>
        <p>
          Demographics: ACS 5-year estimates via the Census Bureau, including foreign-born by region of birth.
          Competitors: OpenStreetMap. Spend, costs, stores and capacities are mock assumptions.{" "}
          <a href="https://github.com/Jaysunnn8solutions/candystore_mcp">Source and method</a>.
          The same model is available to AI assistants at <code>/mcp</code>.
        </p>
        <h3>Sharing</h3>
        <p>
          The settings block carries every slider, store and capacity change as the exact arguments the MCP tools
          accept. Running the server locally also lets it write this map to an HTML file.
        </p>
        <h3>Model assumptions{changed > 0 ? ` · ${changed} changed` : ""}</h3>
        <dl>
          {PARAM_FIELDS.map((f) => (
            <div key={f.key} style={{ display: "contents" }}>
              <dt>{f.label}</dt>
              <dd>{f.hint}</dd>
            </div>
          ))}
        </dl>
        {/* The board and the focused map are desktop states: below 1000px the
            frame is a stacked page with nothing to collapse, and the bar hides
            both buttons on the same condition. A key list is help, so it may
            only promise what the current width can actually do.

            Width is the only condition. `\` was also hidden while the map was
            focused, on the reasoning that the board cannot show through a
            focused map — but toggleBoard now leaves focus mode before opening,
            so in that state the key does exactly what it says. Hiding it there
            withheld a live shortcut. */}
        <h3>Keys</h3>
        <dl>
          <div style={{ display: "contents" }}><dt>1–5</dt><dd>map layer</dd></div>
          {!narrow && <div style={{ display: "contents" }}><dt>\</dt><dd>show everything</dd></div>}
          {!narrow && <div style={{ display: "contents" }}><dt>F</dt><dd>{focusMode ? "leave the focused map" : "focus the map"}</dd></div>}
          <div style={{ display: "contents" }}><dt>A</dt><dd>about</dd></div>
          <div style={{ display: "contents" }}><dt>Esc</dt><dd>close, cancel, deselect</dd></div>
        </dl>
      </div>
    </div>
  );
}
