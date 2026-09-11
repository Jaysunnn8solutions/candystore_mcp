import path from "node:path";

/** Study area: the ten-county Atlanta Regional Commission region. */
export const COUNTIES: Array<{ fips: string; name: string }> = [
  { fips: "057", name: "Cherokee" },
  { fips: "063", name: "Clayton" },
  { fips: "067", name: "Cobb" },
  { fips: "089", name: "DeKalb" },
  { fips: "097", name: "Douglas" },
  { fips: "113", name: "Fayette" },
  { fips: "121", name: "Fulton" },
  { fips: "135", name: "Gwinnett" },
  { fips: "151", name: "Henry" },
  { fips: "247", name: "Rockdale" },
];
export const STATE_FIPS = "13";

export const BOUNDARY_VINTAGE = 2024;
export const ACS_VINTAGE = 2024;
/** Prior vintage. 2015–2019 and 2020–2024 do not overlap, per Census guidance. */
export const ACS_PRIOR_VINTAGE = 2019;

export const ROOT = path.resolve(import.meta.dirname, "..");
export const CACHE_DIR = path.join(ROOT, "pipeline", "cache");
export const DATA_DIR = path.join(ROOT, "data");

export const TRACT_SHAPE_URL = `https://www2.census.gov/geo/tiger/GENZ${BOUNDARY_VINTAGE}/shp/cb_${BOUNDARY_VINTAGE}_${STATE_FIPS}_tract_500k.zip`;
export const PLACE_SHAPE_URL = `https://www2.census.gov/geo/tiger/GENZ${BOUNDARY_VINTAGE}/shp/cb_${BOUNDARY_VINTAGE}_${STATE_FIPS}_place_500k.zip`;
export const TRACT_RELATIONSHIP_URL = `https://www2.census.gov/geo/docs/maps-data/data/rel2020/tract/tab20_tract20_tract10_st${STATE_FIPS}.txt`;
export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/**
 * ACS detailed-table variables. Every code exists unchanged in both
 * vintages. The foreign-born place-of-birth codes (B05006) are resolved
 * by label at run time from the table's group definition, because the
 * cell numbers shift between vintages when countries are added.
 */
export const ACS_VARIABLES = {
  pop: "B01003_001E",
  households: "B08201_001E",
  noVehicle: "B08201_002E",
  medianIncome: "B19013_001E",
  under18: "B09001_001E",
  foreignBorn: "B05006_001E",
} as const;

/**
 * Heritage segments and the B05006 region labels that make them up.
 * Labels are matched against the group definition (e.g. "Asia:!!Eastern
 * Asia:") so the mapping survives cell renumbering.
 */
export const HERITAGE_SEGMENTS: Array<{ id: string; label: string; regions: string[] }> = [
  { id: "latam", label: "Latin American", regions: ["Latin America:!!Central America:", "Latin America:!!South America:"] },
  { id: "caribbean", label: "Caribbean", regions: ["Latin America:!!Caribbean:"] },
  { id: "eastasia", label: "East and Southeast Asian", regions: ["Asia:!!Eastern Asia:", "Asia:!!South Eastern Asia:"] },
  { id: "southasia", label: "South Asian", regions: ["Asia:!!South Central Asia:"] },
  { id: "mideast", label: "Middle Eastern and North African", regions: ["Asia:!!Western Asia:", "Africa:!!Northern Africa:"] },
  { id: "africa", label: "Sub-Saharan African", regions: ["Africa:!!Eastern Africa:", "Africa:!!Middle Africa:", "Africa:!!Southern Africa:", "Africa:!!Western Africa:"] },
  { id: "easteurope", label: "Eastern European", regions: ["Europe:!!Eastern Europe:"] },
];
