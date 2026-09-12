"use client";

import { useEffect } from "react";
import type { Map as LeafletMap } from "leaflet";

/**
 * Leaflet only listens for `window resize`, and focus mode changes the map
 * container on both axes without one. Left unfixed that misdraws tiles and,
 * worse, mis-maps click-to-latlng, so placing a store lands in the wrong tract.
 * Watching the element covers every cause; the transitionend hook makes the
 * fix land on the frame's 180ms track animation rather than 60ms into it.
 */
export function useMapResize(map: LeafletMap): void {
  useEffect(() => {
    const el = map.getContainer();
    let debounce: number | undefined;
    // pan: true keeps the map's centre where it was. With pan: false Leaflet
    // holds the top-left corner instead, so growing the container — which is
    // exactly what focus mode does — pushed the whole tract cluster into the
    // top-left quadrant and filled the rest with empty Georgia. The gesture
    // asks for more room around the subject, not more room beside it.
    const fire = () => {
      map.stop();
      map.invalidateSize({ pan: true });
    };
    const ro = new ResizeObserver(() => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(fire, 60);
    });
    ro.observe(el);

    const onEnd = (e: Event) => {
      const t = e as TransitionEvent;
      if (t.propertyName === "grid-template-columns" || t.propertyName === "grid-template-rows") fire();
    };
    const app = el.closest("[data-app-frame]");
    app?.addEventListener("transitionend", onEnd);
    // transitionend never fires under prefers-reduced-motion, where the frame
    // has no transition at all.
    const fallback = window.setTimeout(fire, 300);

    return () => {
      ro.disconnect();
      app?.removeEventListener("transitionend", onEnd);
      window.clearTimeout(debounce);
      window.clearTimeout(fallback);
    };
  }, [map]);
}
