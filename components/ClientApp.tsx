"use client";

import dynamic from "next/dynamic";
import styles from "./Dashboard.module.css";

/**
 * The dashboard reads the URL hash for its initial state and Leaflet
 * touches `window` on import, so the whole thing renders client-side only.
 */
const Dashboard = dynamic(() => import("./Dashboard").then((m) => m.Dashboard), {
  ssr: false,
  loading: () => <div className={styles.mapLoading}>Loading…</div>,
});

export function ClientApp() {
  return <Dashboard />;
}
