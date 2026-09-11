import type { StoreType } from "./types";

/** Mock capital cost per store type, dollars. Client-safe (no solver import). */
export const DEFAULT_STORE_COSTS: Record<StoreType, number> = { general: 1_500_000, specialty: 1_000_000 };
