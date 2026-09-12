"use client";

import type { CSSProperties } from "react";
import { paramDefault, type ParamField } from "../params-fields";
import styles from "../Widgets.module.css";

/**
 * One calibration parameter. The native range stays: restyling a track
 * cross-browser is where slider accessibility goes wrong, and the native
 * element already answers Arrow, PageUp/Down, Home and End. Only the wrapper,
 * the default tick and the track gradient are ours.
 */
export function Dial({ field, value, onChange }: { field: ParamField; value: number; onChange: (v: number) => void }) {
  const dflt = paramDefault(field);
  const show = field.fmt ? field.fmt(value) : String(value);
  const span = field.max - field.min;
  const style = {
    "--tick": `${((dflt - field.min) / span) * 100}%`,
    "--pct": `${((value - field.min) / span) * 100}%`,
  } as CSSProperties;

  return (
    <label className={styles.dial} data-changed={value !== dflt ? "true" : undefined} title={`${field.label} — ${field.hint}`} style={style}>
      <span className={styles.dialTop}>
        <span className={styles.dialLabel}>{field.short}</span>
        <span className={styles.dialValue}>{show}</span>
      </span>
      <span className={styles.dialTrack}>
        <span className={styles.dialTick} aria-hidden />
        <input
          className={styles.dialRange}
          type="range"
          min={field.min}
          max={field.max}
          step={field.step}
          value={value}
          // The short form first, because it is the text on screen and a name
          // that does not contain it is unsayable by speech input (SC 2.5.3):
          // "Spend / hh" is not a substring of "Spend per household".
          aria-label={`${field.short} — ${field.label}`}
          aria-valuetext={`${show} (range ${field.fmt ? field.fmt(field.min) : field.min} to ${field.fmt ? field.fmt(field.max) : field.max}) — default ${field.fmt ? field.fmt(dflt) : dflt}`}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </span>
    </label>
  );
}
