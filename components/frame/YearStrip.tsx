"use client";

import { useRef } from "react";
import { MONTH_LABELS, MONTH_START_WEEK, SEASON_PEAKS } from "../scales";
import styles from "./SupplyDeck.module.css";

/**
 * Where in the year the forecast window sits. The 52-week art behind the cells
 * is decoration and hidden from the reader; the 12 month buttons are the
 * control, because a real radiogroup beats a pointer-only SVG. The steppers
 * beside it stay the source of truth for an exact week.
 *
 * The season marks are drawn in --text-secondary, not orange: #eb6834 is
 * STORE_SLOTS[0], already a named store's identity in Trade areas.
 */
export function YearStrip({ startWeek, weeks, onStartWeek, readOnly }: { startWeek: number; weeks: number; onStartWeek?: (w: number) => void; readOnly?: boolean }) {
  const cells = useRef<HTMLDivElement>(null);
  const x = (week: number) => ((week - 1) / 52) * 520;
  const selectedMonth = MONTH_START_WEEK.reduce((best, w, i) => (w <= startWeek ? i : best), 0);

  /*
   * One handler on the group, computing from the checked month and then moving
   * DOM focus — the same contract as the lens rail's tablist and Segmented.
   * Per-button handlers each closed over their own index and never moved focus,
   * so focus stayed on the first button pressed and every further arrow
   * recomputed from that same index: the strip advanced one month and stuck,
   * leaving Nov and Dec unreachable from the keyboard.
   */
  const move = (to: number) => {
    const i = Math.min(11, Math.max(0, to));
    onStartWeek?.(MONTH_START_WEEK[i]);
    cells.current?.querySelectorAll<HTMLButtonElement>("button")[i]?.focus();
  };
  // The window can run past week 52 into the next year, so it draws as two
  // brackets rather than one that would stretch backwards.
  const end = startWeek + weeks - 1;
  const spans = end <= 52 ? [[startWeek, end]] : [[startWeek, 52], [1, ((end - 1) % 52) + 1]];
  // The label reads the same spans the brackets draw. It used to print the raw
  // `startWeek + weeks - 1`, so the default 26 weeks from week 36 announced
  // "weeks 36 to 61" — a week no calendar has, and no sign that the window
  // wraps into the next year, which is the one thing two brackets are for.
  const inWindow = spans.map(([a, b]) => `weeks ${a} to ${b}`).join(" and ");

  return (
    <div className={`${styles.ruler} ${readOnly ? styles.rulerWide : ""}`}>
      <svg
        className={styles.rulerArt}
        viewBox="0 0 520 26"
        preserveAspectRatio="none"
        aria-hidden={readOnly ? undefined : "true"}
        role={readOnly ? "img" : undefined}
        aria-label={readOnly ? `The forecast year: ${inWindow} are in the window, and weeks 42 to 44 and 49 to 52 are the Halloween and Christmas peaks.` : undefined}
      >
        {SEASON_PEAKS.map((s) => (
          <rect key={s.label} x={x(s.from)} y={0} width={x(s.to + 1) - x(s.from)} height={18} fill="var(--hover)" stroke="var(--grid)" strokeWidth={1} />
        ))}
        {Array.from({ length: 52 }, (_, i) => i + 1).map((wk) => {
          const peak = SEASON_PEAKS.some((s) => wk >= s.from && wk <= s.to);
          // --border rather than --grid: a 1px tick stretched across a recessed
          // dark surface disappears entirely at --grid.
          return <rect key={wk} x={x(wk)} y={peak ? 2 : 8} width={1} height={peak ? 14 : 8} fill={peak ? "var(--text-secondary)" : "var(--border)"} />;
        })}
        {spans.map(([a, b], i) => (
          <rect key={i} x={x(a)} y={19} width={Math.max(2, x(b + 1) - x(a))} height={2} fill="var(--fill)" />
        ))}
      </svg>
      {!readOnly && onStartWeek && (
        <div
          ref={cells}
          className={styles.rulerCells}
          role="radiogroup"
          aria-label="Forecast start month"
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(selectedMonth - 1);
            else if (e.key === "ArrowRight" || e.key === "ArrowDown") move(selectedMonth + 1);
            else if (e.key === "Home") move(0);
            else if (e.key === "End") move(11);
            else return;
            e.preventDefault();
          }}
        >
          {MONTH_LABELS.map((m, i) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={i === selectedMonth}
              tabIndex={i === selectedMonth ? 0 : -1}
              // The glyph is one letter and three months share a J, so the
              // name has to come from the label rather than the content.
              aria-label={`${m} — start at week ${MONTH_START_WEEK[i]}`}
              title={`${m} — start at week ${MONTH_START_WEEK[i]}`}
              onClick={() => onStartWeek(MONTH_START_WEEK[i])}
            >
              {/* The glyph carries its own ground. The ticks are drawn behind
                  these buttons, and the tall season ticks land on exactly the
                  months a candy buyer reads first — O, N and D sat with a
                  bright 14px rule through them. The chip is only as wide as the
                  letter, so the ruler still reads as a ruler between them. */}
              <span>{m[0]}</span>
            </button>
          ))}
        </div>
      )}
      {readOnly && (
        <div className={styles.rulerKeys} aria-hidden>
          {SEASON_PEAKS.map((s) => (
            <span key={s.label} style={{ left: `${(x(s.to + 1) / 520) * 100}%` }}>{s.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}
