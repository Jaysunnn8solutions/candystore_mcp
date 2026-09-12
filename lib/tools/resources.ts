import { loadManifest } from "../data/load";

export const METHOD_MARKDOWN = `# Candy store planning — method

**Units.** 2020 census tracts across the ten-county Atlanta region; tract centroids stand in for shoppers.

**Demand.** Annual candy spend per tract = households × base spend × (income / regional median)^elasticity × (1 + childBoost × relative child share). Heritage segments come from ACS B05006 (foreign-born by region of birth), grouped into Latin American, Caribbean, East and Southeast Asian, South Asian, Middle Eastern and North African, Sub-Saharan African, and Eastern European. Where a segment's population share is at or above the critical mass, share × affinity of the tract's spend becomes that segment's specialty category; the rest is traditional.

**Capture.** Huff gravity: outlet attraction = size^alpha / distance^beta within maxKm; a tract's category spend is split among outlets carrying that category in proportion to attraction, with a constant outside option. General stores carry traditional; specialty stores carry their segments' categories; OpenStreetMap candy shops are competitors carrying traditional at size 0.8.

**Supply.** Each store draws from its nearest distribution center. Weekly demand per center and category is compared with capacity; the fill rate scales every member store's revenue for that category. Caps are per center and hard: demand past one center's weekly capacity is lost, and no other center covers for it. The forecast applies the same rule.

**Site selection.** Greedy by revenue gain per dollar of capital over tract-centroid candidates of each store type. Each step screens candidates by uncaptured demand in reach that the candidate's own distribution center can still ship, fully re-runs the market for a shortlist per type, and keeps the best gain-per-dollar that clears a minimum gain. Specialty candidates carry the strongest local segments. Two bounds keep a run finite: at most 40 picks and eight seconds of wall clock. Either one truncates the plan rather than finishing it, and \`find_sites\` names the bound that stopped it when a truncated plan leaves capital unspent.

**Forecast.** Monte Carlo over weeks: seasonal index relative to an ordinary week (Halloween week 2.4×, Christmas up to 1.9×, Valentine's 1.7×, Easter 1.4×), divided by its own 52-week mean so a horizon redistributes the annual total rather than marking every week up by 14%; random center outages; fixed seed. When a center goes down, the volume it could have shipped healthy reroutes into the other centers' spare capacity — only that much, and only from a center that is actually out. What nobody can ship is lost revenue, including a seasonal week that runs past a healthy center's own weekly capacity. Per center and week the tool reports the mean order and the heaviest week any run produced, from a per-center weekly total summed across categories inside each run, so the peak is a total that actually occurred rather than a sum of separate per-category quantiles. Also expected lost revenue, and horizon totals by center and category.

**Mock inputs.** Base spend, store costs, distribution centers and their capacities, and the chain itself with its five existing stores are placeholders. Demographics, boundaries and competitors are real.
`;

export const manifestResource = {
  name: "manifest",
  uri: "candy://data/manifest",
  config: { title: "Data manifest", description: "Vintages, counties, segments and counts of the committed data.", mimeType: "application/json" },
  handler: (uri: URL) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(loadManifest(), null, 2) }] }),
};

export const methodResource = {
  name: "method",
  uri: "candy://method",
  config: { title: "Method", description: "How demand, capture, supply, site selection and the forecast are computed.", mimeType: "text/markdown" },
  handler: (uri: URL) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: METHOD_MARKDOWN }] }),
};
