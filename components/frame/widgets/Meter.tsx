"use client";

import { meterLevel, money, pct } from "../../scales";
import styles from "../Widgets.module.css";

const WORDS = { ok: "", tight: "approaching capacity", over: "over capacity" } as const;
const PILLS = { ok: null, tight: "TIGHT", over: "CAPPED" } as const;

/**
 * Demand against a weekly capacity. Severity carries three signals at once —
 * fill colour, a mark, and a word — because a hairline alone fails on a dark
 * recessed surface and colour alone fails for anyone who cannot see it.
 */
export function Meter({ name, demand, capacity, id }: { name: string; demand: number; capacity: number; id?: string }) {
  const level = meterLevel(demand, capacity);
  const used = capacity > 0 ? demand / capacity : 1;
  const clamped = Math.min(1, used);
  const word = WORDS[level];
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
        aria-valuemax={capacity}
        aria-valuenow={Math.round(demand)}
        aria-valuetext={`${money(demand)} of ${money(capacity)} shipped, ${pct(used)} used${word ? `, ${word}` : ""}`}
      >
        <span className={styles.meterFill} style={{ width: `${clamped * 100}%` }} data-gap={clamped > 0 && clamped < 1 ? "true" : undefined} />
        {level !== "ok" && <span className={styles.meterThreshold} aria-hidden />}
        {level === "over" && <span className={styles.meterOver} aria-hidden />}
      </span>
      <span className={styles.meterFig}>
        {pct(used)}
        {pill && <em className={`${styles.flag} ${level === "over" ? styles.flagPriority : styles.flagWatch}`}>{pill}</em>}
      </span>
    </li>
  );
}
