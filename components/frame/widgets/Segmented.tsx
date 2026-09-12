"use client";

import { useRef } from "react";
import styles from "../Widgets.module.css";

export interface SegOption<T extends string> {
  id: T;
  label: string;
  badge?: string;
  title?: string;
}

interface Props<T extends string> {
  label: string;
  options: Array<SegOption<T>>;
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Exclusive choice, one tab stop. Left/Right move and select, which is the
 * radiogroup contract every screen reader already announces.
 */
export function Segmented<T extends string>({ label, options, value, onChange, size = "md", className }: Props<T>) {
  const box = useRef<HTMLDivElement>(null);
  // A roving tabindex must always leave exactly one stop. `value` can be
  // something no option offers — the forecast horizon offers 13/26/39/52 while
  // the stepper beside it sets any week from 4 to 52 — and keying the stop to
  // the checked option alone then gave every button -1 and made the whole group
  // unreachable by Tab.
  const checked = options.findIndex((o) => o.id === value);
  const stop = checked < 0 ? 0 : checked;

  const move = (delta: number) => {
    const next = options[Math.min(options.length - 1, Math.max(0, stop + delta))];
    if (!next) return;
    onChange(next.id);
    box.current?.querySelectorAll<HTMLButtonElement>("button")[options.indexOf(next)]?.focus();
  };

  return (
    <div
      ref={box}
      className={`${styles.segmented} ${className ?? ""}`}
      data-size={size}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(-1);
        else if (e.key === "ArrowRight" || e.key === "ArrowDown") move(1);
        else if (e.key === "Home") move(-options.length);
        else if (e.key === "End") move(options.length);
        else return;
        e.preventDefault();
      }}
    >
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          tabIndex={i === stop ? 0 : -1}
          title={o.title}
          className={o.id === value ? styles.active : ""}
          onClick={() => onChange(o.id)}
        >
          {o.label}
          {o.badge && <span className={styles.segBadge}>{o.badge}</span>}
        </button>
      ))}
    </div>
  );
}
