import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../config";

/** Load .env.local for local runs. CI supplies the variable directly. */
export function loadEnv(): void {
  const file = path.join(ROOT, ".env.local");
  if (process.env.CENSUS_API_KEY || !existsSync(file)) return;
  process.loadEnvFile(file);
}

export function censusApiKey(): string {
  loadEnv();
  const key = process.env.CENSUS_API_KEY;
  if (!key) {
    throw new Error(
      "CENSUS_API_KEY is not set. Put it in .env.local or the environment."
    );
  }
  return key;
}
