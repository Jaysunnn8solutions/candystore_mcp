"use client";

import { meterLevel, money, pct, utilization } from "../../scales";
import styles from "../Widgets.module.css";

const WORDS = { ok: "", tight: "approaching capacity", over: "over capacity" } as const;
const PILLS = { ok: null, tight: "TIGHT", over: "CAPPED" } as const;

/**
 * The figure a meter prints. Demand against no capacity is not a utilization,
 * so that state gets a word rather than a number — utilization() in scales.ts
 * is the same rule in the sentence a screen reader hears. Exported because the
 * disclosure that folds meters away summarizes its worst row, and the two must
 * not describe one row differently.
 */
export function meterFigure(demand: number, capacity: number): string {
  return capacity > 0 ? pct(demand / capacity) : "no cap";
}

/**
 * Demand against a weekly capacity. Severity carries three signals at once —
 * fill color, a mark, and a word — because a hairline alone fails on a dark
 * recessed surface and color alone fails for anyone who cannot see it.
 */
export function Meter({ name, demand, capacity, id }: { name: string; demand: number; capacity: number; id?: string }) {
  const level = meterLevel(demand, capacity);
  // The ratio was `capacity > 0 ? demand / capacity : 1`, so a center stepped
  // down to ×0 printed exactly "100%" with a full bar — the fully-used reading
  // of the one state where nothing ships at all, and the opposite of what the
  // map tooltip says about the same center. No capacity, no ratio: the bar is
  // empty and the figure is a word.
  const has = capacity > 0;
  const used = has ? demand / capacity : 0;
  const clamped = Math.min(1, used);
  // "no capacity" already says everything is lost, so the word would repeat it.
  const word = has ? WORDS[level] : "";
  const pill = PILLS[level];

  return (
    // An id and a tab stop only on the one row the funnel and the plan note
    // jump to, so focus lands on the remedy they name.
    <li className={styles.meterRow} data-level={level} id={id} tabIndex={id ? -1 : undefined}>
      <span className={styles.meterName} title={name}>{name}</span>
      <span
        className={styles.meterTrack}
        role="meter"
        aria-label={name}
        aria-valuemin={0}
        // Demand routinely stands above capacity, and sometimes against none at
        // all, so the range has to hold valuenow: it used to report six figures
        // of demand against a max of 0, which is not a meter anything can read.
        aria-valuemax={Math.max(capacity, Math.round(demand))}
        aria-valuenow={Math.round(demand)}
        aria-valuetext={`${money(demand)} of ${money(capacity)} shipped, ${utilization(demand, capacity)}${word ? `, ${word}` : ""}`}
      >
        <span className={styles.meterFill} style={{ width: `${clamped * 100}%` }} data-gap={clamped > 0 && clamped < 1 ? "true" : undefined} />
        {level !== "ok" && <span className={styles.meterThreshold} aria-hidden />}
        {level === "over" && <span className={styles.meterOver} aria-hidden />}
      </span>
      <span className={styles.meterFig}>
        {meterFigure(demand, capacity)}
        {pill && <em className={`${styles.flag} ${level === "over" ? styles.flagPriority : styles.flagWatch}`}>{pill}</em>}
      </span>
    </li>
  );
}
