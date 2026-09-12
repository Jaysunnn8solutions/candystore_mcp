"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../Widgets.module.css";

interface Props {
  id: string;
  /**
   * Names the −/+ buttons, which have no visible text of their own, and the
   * field itself unless `labelled` says a visible label already does.
   */
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  prefix?: string;
  suffix?: string;
  size?: "md" | "sm";
  /** Big type for the one figure the decision rail leads with. */
  big?: boolean;
  /**
   * A value to snap onto when a step lands within half a step of it. The
   * capacity steppers pass 1: an override is deleted only at exactly 1, so a
   * float-accumulated 0.9999999 would write a phantom capacity change into the
   * URL and into the settings block copied for Claude.
   */
  detent?: number;
  /** True when the value equals its no-op point, so the readout can recede. */
  neutral?: boolean;
  /**
   * Set when the caller's own visible <label for={id}> already names the field
   * and `label` is not a superset of its words. Without it the field takes
   * `label` as its accessible name — which is how the two cost steppers, the
   * only call sites with no visible label at all, ended up announced as their
   * own value ("textbox 1.5"). With it the visible words stay the name, because
   * a name that does not contain them breaks speech input (SC 2.5.3).
   */
  labelled?: boolean;
  disabled?: boolean;
  className?: string;
}

function decimalsOf(step: number): number {
  const s = String(step);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

export function Stepper({ id, label, value, onChange, min, max, step, prefix, suffix, size = "md", big, detent, neutral, labelled, disabled, className }: Props) {
  const decimals = decimalsOf(step);
  // Kept at the step's own precision, so a capacity override reads "x1.0"
  // rather than "x1" and the no-override point is unambiguous.
  const [text, setText] = useState(() => value.toFixed(decimalsOf(step)));
  const [lastValue, setLastValue] = useState(value);
  const held = useRef<{ delay?: number; tick?: number }>({});

  // The committed value is the source of truth; the local text only exists so a
  // field can be cleared and retyped without snapping back on every keystroke.
  // Adjusted during render rather than in an effect, so the input never paints
  // one frame showing the value it just moved away from.
  if (value !== lastValue) {
    setLastValue(value);
    setText(value.toFixed(decimals));
  }

  // A press-and-hold interval outlives the render that started it, so it must
  // read the committed value through a ref: closing over `value` would make it
  // recompute the same single step from a stale base and stall after one bump.
  const live = useRef({ value, onChange });
  useEffect(() => {
    live.current = { value, onChange };
  }, [value, onChange]);

  const clamp = (raw: number) => {
    const stepped = Math.round(raw / step) * step;
    const bounded = Math.min(max, Math.max(min, stepped));
    const snapped = detent != null && Math.abs(bounded - detent) < step / 2 ? detent : bounded;
    return Number(snapped.toFixed(decimals));
  };

  const stopHold = () => {
    window.clearTimeout(held.current.delay);
    window.clearInterval(held.current.tick);
    held.current = {};
  };

  const bump = (dir: 1 | -1) => {
    const next = clamp(live.current.value + dir * step);
    // At the bound the held interval would otherwise spin forever writing the
    // value it already has.
    if (next === live.current.value) return stopHold();
    live.current.onChange(next);
  };

  const startHold = (dir: 1 | -1) => {
    bump(dir);
    held.current.delay = window.setTimeout(() => {
      held.current.tick = window.setInterval(() => bump(dir), 120);
    }, 400);
  };
  useEffect(() => stopHold, []);

  const btn = (dir: 1 | -1) => (
    <button
      type="button"
      className={styles.stepBtn}
      tabIndex={-1}
      disabled={disabled || (dir === 1 ? value >= max : value <= min)}
      aria-label={`${dir === 1 ? "Increase" : "Decrease"} ${label}`}
      aria-controls={id}
      onPointerDown={(e) => {
        e.preventDefault();
        startHold(dir);
      }}
      onPointerUp={stopHold}
      onPointerCancel={stopHold}
      onPointerLeave={stopHold}
      onBlur={stopHold}
    >
      {dir === 1 ? "+" : "−"}
    </button>
  );

  return (
    <div className={`${styles.stepper} ${big ? styles.stepBig : ""} ${className ?? ""}`} data-size={size} data-neutral={neutral ? "true" : undefined} data-disabled={disabled ? "true" : undefined}>
      {btn(-1)}
      {prefix && <span className={styles.affix}>{prefix}</span>}
      <input
        id={id}
        className={styles.stepInput}
        type="number"
        aria-label={labelled ? undefined : label}
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(clamp(n));
        }}
        onBlur={() => setText(value.toFixed(decimals))}
      />
      {suffix && <span className={styles.affix}>{suffix}</span>}
      {btn(1)}
    </div>
  );
}
