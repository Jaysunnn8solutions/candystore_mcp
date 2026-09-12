# candystore_mcp

**Candy store planning for metro Atlanta.** Where candy demand is, which heritage segments want the candy they grew up with, what our stores capture, where to open next under a budget, and what to tell suppliers to expect, week by week, with outages. A map, a JSON API, and an [MCP](https://modelcontextprotocol.io) server, over the same engine and the same committed data. Ten counties, 1,200 census tracts.

**Live map:** `https://candystore-mcp.vercel.app`
**Remote MCP endpoint:** `https://candystore-mcp.vercel.app/mcp`
**Local MCP server:** `npm run mcp:stdio` (adds `render_map`, which writes the map to an HTML file)

This is the third project in a portfolio sequence: [census-mcp](https://github.com/Jaysunnn8solutions/census-mcp) (a stateless tool server), [atl-mcp](https://github.com/Jaysunnn8solutions/atl-mcp) (an application with a spatial engine and scenarios), and this one, which adds a market model with competition, a supply chain with capacity and outages, a stochastic forecast, and a second transport that can act on the local machine.

The company is fictional. The demographics, boundaries and competitors are real.

---

## The business question

A chain runs four general candy stores and one specialty store on Buford Highway. It has capital to expand, two distribution centers, and suppliers who ship plenty of traditional candy but only a little of the imported kinds. Where should the next stores go, should they be general or specialty, and what should the buyers order for the next six months?

Two kinds of store matter because two kinds of customer do. Neighborhoods with a large foreign-born population from one region want candy familiar from home, and a general store stocked for the average American shopper doesn't serve them. Putting both ranges in one store dilutes each; the model treats them as separate layers that can sit near each other.

---

## What the map shows

- **Demand**: annual candy spend per tract, from households, income and children.
- **Specialty**: demand for one segment's familiar candy, where that segment has critical mass. Segments come from ACS table B05006, foreign-born by region of birth: Latin American, Caribbean, East and Southeast Asian, South Asian, Middle Eastern and North African, Sub-Saharan African, Eastern European.
- **Our share**: how much of each tract's spend our stores capture, after competitors.
- **Uncaptured**: spend we don't reach, which is where a new store would draw from.
- **Trade areas**: which of our stores each tract mostly shops at.

Four regions frame the map. The outcome bar across the top keeps the demand funnel — what the market spends, what our stores capture, and where the rest goes — beside the scenario chip and the share buttons. The lens rail on the left picks the layer and the heritage segment, and searches for a place. The decision rail on the right holds the store roster and the expansion plan. The supply deck along the bottom holds each center's capacity meters and the forecast, over a strip carrying the nine model assumptions. Clicking a tract opens a card over the map; nothing else moves.

Stores, distribution centers and competitors are markers. Press "Add general" or "Add specialty" and click the map to open a store; the power button on a store's row closes or reopens it; a center's capacity is a × factor per category in the deck; "Plan the expansion" runs the optimizer against a budget; "Run forecast" fills the supplier chart and the weekly table. On a wide screen "⊞ All" takes the map's place to show every capacity category and that table at once, and the ⛶ button collapses the rails and the deck to a one-line ribbon over the map. The URL carries the layer, the assumptions and the scenario; "Copy for Claude" puts the same state on the clipboard as tool arguments, and `load_view` reads it back on the server.

---

## Method

**Demand.** Spend per tract = households × base spend × (income ÷ regional median)^elasticity × (1 + child boost × relative child share). A tract is a specialty market for a segment when the segment's share of population is at or above the critical mass (default 8%); share × affinity of the spend becomes that segment's specialty category, the rest is traditional.

**Capture.** A Huff gravity model: outlet attraction = size^α ÷ distance^β within a reach radius, and each tract's category spend splits among the outlets carrying that category in proportion to attraction, with a constant outside option for grocery and online. General stores carry traditional; specialty stores carry their segments; OpenStreetMap candy shops are competitors. Two of our stores near one tract split it, so cannibalization is in the numbers, not a footnote.

**Supply.** Each store draws from its nearest distribution center. Weekly demand per center and category — annual capture divided by 52, so an average week — is compared with capacity; the fill rate scales every member store's revenue for that category. Specialty caps are tight, traditional loose. An average week is not the worst week: at baseline every category clears its cap, so the market reports nothing lost, while a calm 52-week forecast still loses $114,579 in the Halloween and Christmas weeks, when demand runs past a cap the average week clears. `forecast_orders` is where a seasonal peak shows up.

**Site selection.** Greedy by revenue gain per dollar of capital over tract-centroid candidates of each store type. Each step screens candidates by uncaptured demand in reach that their center can still ship, fully re-runs the market for a shortlist per type, and keeps the best gain per dollar that clears a minimum. With default costs and capacities that comes out as four general stores — by which point both centers are routed more traditional candy than they can ship (fill rates 0.94 and 0.96) and a fifth general store adds nothing — and then specialty stores carrying the strongest local segments, which is the two-layer go-to-market falling out of the arithmetic.

Two bounds keep a run finite: at most 40 picks, and eight seconds of wall clock so the hosted endpoint answers inside its timeout. Either one truncates the plan rather than reporting a finished one, and when a truncated plan leaves capital unspent `find_sites` says which bound stopped it.

**Forecast.** Monte Carlo over weeks. The seasonal index is a ratio against an ordinary week — 2.4× in Halloween week 44, 1.6× in the run-up weeks 42–43, 1.9× in Christmas weeks 51–52 and 1.4× in 49–50, 1.7× for Valentine's in weeks 6–7, 1.4× for Easter in weeks 13–15, and 0.7× in week 1, the post-holiday trough — and the simulation divides it by its own 52-week mean, so a horizon redistributes annual demand instead of marking every week up by 14%. Each week a center can go down for one to three weeks; the volume it would have shipped healthy reroutes into the other centers' spare capacity, and what nobody can ship is lost revenue. Fixed seed. Per center and week the forecast reports the mean order and the heaviest week any run produced, plus expected lost revenue: commit the mean, size capacity for the peak. There is no p10–p90 band in the table because at the default 3%-a-week outage rate it is worthless: across a default 26-week run every cell of it came out zero-width, and not one contained the mean.

Everything is implemented from the formulas in `lib/model/` with tests: synthetic tracts for demand and gravity, and integration tests over the committed data for the market, optimizer and simulation.

---

## Tools

Nine tools are registered on both transports. `render_map` is a tenth that exists only on the local stdio server, because a serverless function has nowhere to write a file — so the hosted endpoint lists nine and a local `claude mcp` connection lists ten.

| Tool | Purpose |
|---|---|
| `describe_market` | Method, data, segments, stores, centers, baseline. Call first. |
| `load_view` | Turn a pasted map link or settings block into tool arguments. |
| `get_tract` | Demographics, heritage shares, demand by category, our capture, nearest stores. |
| `search_place` | Geocode a place and list the tracts around it with demand. |
| `segment_markets` | Where a segment has critical mass, what we capture, the biggest uncaptured pockets. |
| `store_performance` | Revenue by store and category; center utilization. |
| `find_sites` | Budget-constrained expansion: which stores, where, of which type, net of cannibalization and caps. |
| `what_if` | Baseline versus a scenario of added or closed stores and scaled capacity. |
| `forecast_orders` | Weekly supplier orders per center: the mean week and the heaviest week, horizon totals by category, expected losses. |
| `render_map` | **Local (stdio) only.** Writes a self-contained HTML map of the scenario. |

Every tool that runs the market accepts the same optional model parameters and scenario (`add`, `remove`, `capacityScale`), so a conversation can chain "find sites, test them, forecast the orders" with one set of assumptions. The two that don't are `describe_market`, which takes no arguments, and `load_view`, which takes only the link. Three prompts package those chains: `expansion_plan`, `segment_brief`, `supplier_forecast`. Resources expose the manifest and the method.

### Remote

```bash
claude mcp add --transport http candy https://candystore-mcp.vercel.app/mcp
```

### Local, with the HTML renderer

```bash
git clone https://github.com/Jaysunnn8solutions/candystore_mcp.git
cd candystore_mcp && npm install
claude mcp add candy-local -- npx tsx /absolute/path/to/candystore_mcp/mcp/stdio.ts
```

Then ask: *"Plan a $10M expansion, forecast the orders, and render the map."* The `render_map` tool writes `candy-map-<timestamp>.html` in the working directory: Leaflet inlined, data embedded, layer buttons, no server needed. The remote server does not register it, because a serverless function has nowhere to write.

---

## Data

| Source | Used for | License |
|---|---|---|
| Census cartographic boundaries 2024 | Tracts, and the place covering most of each tract | Public domain |
| ACS 5-year 2024 | Population, households, income, children, foreign-born by region (B05006) | Public domain |
| ACS 5-year 2019 + tract relationship file | Population change on 2020 tracts, apportioned by land area | Public domain |
| OpenStreetMap via Overpass | Competing candy and confectionery shops | ODbL |
| Nominatim, Census geocoder | Place search at request time | ODbL / public domain |
| Esri gray canvas | Map tiles | Free with attribution |

Mock inputs, meant to be edited: five stores and two distribution centers with weekly capacity per category in `data/`, and the model's own defaults in `lib/model/` — $120 base spend per household, $1.5M for a general store, $1.0M for a specialty store.

The B05006 region cells are resolved by label from the table definition at pipeline time, because their numbering shifts between vintages.

---

## Architecture

```
pipeline/         tracts + places, ACS with heritage segments and the 2010→2020 crosswalk, competitors
data/             committed outputs plus mock stores and distribution centers
lib/spatial/      haversine distance, seeded PRNG, small stats helpers
lib/model/        demand, gravity, market, optimizer, simulate, params
lib/tools/        MCP tools, prompts, resources, one registration for both transports
lib/render/       the self-contained HTML map
lib/view-state    URL hash encoding shared by browser and server
app/api/          tracts, static, market, sites, forecast, geocode
app/mcp/          remote MCP endpoint (mcp-handler)
mcp/stdio.ts      local MCP server (StdioServerTransport) + render_map
components/       Leaflet map, legend, map overlays, color scales, the dashboard that owns the state
components/frame/ the four regions — outcome bar, lens rail, decision rail, supply deck — and their widgets
```

---

## Running locally

```bash
npm install
npm run dev          # http://localhost:3000
npm test
npm run type-check && npm run lint
npm run pipeline     # rebuild data; needs CENSUS_API_KEY in .env.local
npm run test:client -- http://localhost:3000   # every tool over HTTP
npm run test:client -- stdio                   # every tool over stdio, plus render_map
```

---

## Limitations

- Straight-line distance; a real gravity model would use drive times.
- Heritage is foreign-born only. Second-generation communities that keep their candy preferences are invisible to it, and the segments are broad by design.
- OpenStreetMap has about twenty candy shops for the region; real competition includes every grocery and pharmacy, which the outside option stands in for.
- The optimizer is greedy: one store per step, no revisiting an earlier pick, and it gives up at 40 picks or eight seconds of wall clock, so a large budget can come back with a truncated plan rather than the best one; when that happens with capital left over, `find_sites` names the bound that stopped it. The forecast is a simple reroute between the two centers. Both are heuristics.
- Population change since 2019 is approximate for most tracts. The 2010→2020 re-delineation split nearly every growing tract, so a 2020 tract's 2019 population is apportioned from its donor tracts by land area, which assumes each donor's residents were spread evenly across it. Only 250 of the 1,200 tracts have a single unchanged donor; `pop2019Basis` on each tract marks which. The region-wide +5.2% holds, but an individual tract's swing can be an artifact of the split rather than anything that happened.
- Spend, costs and capacities are placeholders.
