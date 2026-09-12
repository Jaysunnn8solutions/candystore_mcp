"use client";

import type { CSSProperties } from "react";
import styles from "../Widgets.module.css";

/**
 * A switch whose swatch carries the colour it governs, so the control sits on
 * the meaning it changes. Off is a ring with a transparent centre and no check;
 * on is a filled swatch plus a check glyph. Three channels, never colour alone.
 */
export function ToggleChip({ checked, onToggle, color, label, big }: { checked: boolean; onToggle: (v: boolean) => void; color?: string; label: string; big?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`${styles.chip} ${big ? styles.chipBig : ""}`}
      style={{ ["--dot" as string]: color } as CSSProperties}
      onClick={() => onToggle(!checked)}
    >
      {color && <span className={`${styles.dot} ${checked ? "" : styles.dotRing}`} />}
      {label}
      {checked && <span className={styles.check} aria-hidden>✓</span>}
    </button>
  );
}

/** Arming a placement mode: pressed inversion plus the dot of the type it places. */
export function AddStoreChip({ pressed, onPress, color, label }: { pressed: boolean; onPress: () => void; color: string; label: string }) {
  return (
    <button type="button" aria-pressed={pressed} className={`${styles.chip} ${styles.chipBig}`} style={{ ["--dot" as string]: color } as CSSProperties} onClick={onPress}>
      <span className={styles.dot} />
      {label}
    </button>
  );
}

/**
 * Open/closed for one store. Closed rows also grey out, strike through their
 * name and sort under a divider, so the switch is never the only signal.
 */
export function OpenSwitch({ closed, onToggle, name }: { closed: boolean; onToggle: () => void; name: string }) {
  return (
    <button type="button" aria-pressed={closed} className={styles.powerBtn} title={closed ? `Reopen ${name}` : `Close ${name}`} aria-label={closed ? `Reopen ${name}` : `Close ${name}`} onClick={onToggle}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
        <path d="M8 2.2v4.4" />
        <path d="M4.6 4.1a4.6 4.6 0 1 0 6.8 0" />
      </svg>
    </button>
  );
}
