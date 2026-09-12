"use client";

import { useRef } from "react";
import { DEFAULT_PARAMS } from "@/lib/model/params";
import type { ScenarioParams } from "@/lib/model/types";
import { PARAM_FIELDS, changedParamCount, paramValue } from "./params-fields";
import { useOverflowWarn } from "./useOverflowWarn";
import { Dial } from "./widgets/Dial";
import styles from "./SupplyDeck.module.css";
import w from "./Widgets.module.css";

/**
 * All nine model assumptions, permanently visible in 40px at the weakest
 * position on screen. Quiet by type size and position rather than by being
 * hidden, which is what makes "see all the options at once" literally true and
 * what let the invented presets go.
 *
 * A group with an accessible name rather than a fieldset: the first legend of a
 * fieldset is taken out of the content box by the UA, which would push the
 * strip past its 40px.
 */
export function CalibrationStrip({ params, onParams }: { params: ScenarioParams; onParams: (p: ScenarioParams) => void }) {
  const strip = useRef<HTMLDivElement>(null);
  useOverflowWarn(strip, "calibration strip");
  const changed = changedParamCount(params);

  return (
    <div ref={strip} id="cal-strip" className={styles.calStrip} role="group" aria-labelledby="cal-legend">
      <span id="cal-legend" className={styles.calLegend}>
        Model assumptions
        <span className={styles.calChanged}>{changed === 0 ? "at defaults" : `${changed} changed`}</span>
      </span>
      {PARAM_FIELDS.map((f) => (
        <Dial
          key={f.key}
          field={f}
          value={paramValue(params, f)}
          onChange={(v) => onParams({ ...params, [f.group]: { ...params[f.group], [f.key]: v } })}
        />
      ))}
      {changed > 0 ? (
        <button type="button" className={`${w.ghost} ${styles.calReset}`} onClick={() => onParams(DEFAULT_PARAMS)}>↺ Reset</button>
      ) : (
        <span />
      )}
    </div>
  );
}
