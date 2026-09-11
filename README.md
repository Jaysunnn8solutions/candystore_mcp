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

Two kinds of store matter because two kinds of customer do. Neighbourhoods with a large foreign-born population from one region want candy familiar from home, and a general store stocked for the average American shopper doesn't serve them. Putting both ranges in one store dilutes each; the model treats them as separate layers that can sit near each other.

---

## What the map shows

- **Demand**: annual candy spend per tract, from households, income and children.
- **Specialty**: demand for one segment's familiar candy, where that segment has critical mass. Segments come from ACS table B05006, foreign-born by region of birth: Latin American, Caribbean, East and Southeast Asian, South Asian, Middle Eastern and North African, Sub-Saharan African, Eastern European.
- **Our share**: how much of each tract's spend our stores capture, after competitors.
- **Uncaptured**: spend we don't reach, which is where a new store would draw from.
- **Trade areas**: which of our stores each tract mostly shops at.

Stores, distribution centers and competitors are markers. Pick a store type and click the map to open one; tick an existing store to close it; scale a center's capacity; press "Plan the expansion" with a budget; press "Forecast orders" for the supplier table. The URL carries all of it, "Copy settings for Claude" puts it on the clipboard as tool arguments, and `load_view` reads it back on the server.

---

## Method

**Demand.** Spend per tract = households × base spend × (income ÷ regional median)^elasticity × (1 + child boost × relative child share). A tract is a specialty market for a segment when the segment's share of population is at or above the critical mass (default 8%); share × affinity of the spend becomes that segment's specialty category, the rest is traditional.

**Capture.** A Huff gravity model: outlet attraction = size^α ÷ distance^β within a reach radius, and each tract's category spend splits among the outlets carrying that category in proportion to attraction, with a constant outside option for grocery and online. General stores carry traditional; specialty stores carry their segments; OpenStreetMap candy shops are competitors. Two of our stores near one tract split it, so cannibalization is in the numbers, not a footnote.

**Supply.** Each store draws from its nearest distribution center. Weekly demand per center and category is compared with capacity; the fill rate scales every member store's revenue for that category. Specialty caps are tight, traditional loose.

**Site selection.** Greedy by revenue gain per dollar of capital over tract-centroid candidates of each store type. Each step screens candidates by uncaptured demand in reach, fully re-runs the market for a shortlist per type, and keeps the best gain per dollar that clears a minimum. With default costs the optimizer opens general stores until the traditional caps bind, then switches to specialty stores carrying the strongest local segments, which is the two-layer go-to-market falling out of the arithmetic.

**Forecast.** Monte Carlo over weeks with a seasonal index (Halloween week 2.4×, Christmas up to 1.9×, Valentine's 1.7×, Easter 1.4×) and random center outages that reroute to spare capacity elsewhere. Fixed seed. Reports mean and p10/p90 orders per center and category and expected lost revenue, so a buyer can commit the mean and plan for the p90.

Everything is implemented from the formulas in `lib/model/` with tests: synthetic tracts for demand and gravity, and integration tests over the committed data for the market, optimizer and simulation.

---

## Tools

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
| `forecast_orders` | Weekly supplier orders per center and category with p10/p90 and expected losses. |
| `render_map` | **Local only.** Writes a self-contained HTML map of the scenario. |

Every tool accepts the same optional model parameters and scenario (`add`, `remove`, `capacityScale`), so a conversation can chain "find sites, test them, forecast the orders" with one set of assumptions. Three prompts package those chains: `expansion_plan`, `segment_brief`, `supplier_forecast`. Resources expose the manifest and the method.

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

| Source | Used for | Licence |
|---|---|---|
| Census cartographic boundaries 2024 | Tracts and places | Public domain |
| ACS 5-year 2024 | Population, households, income, children, foreign-born by region (B05006) | Public domain |
| ACS 5-year 2019 + tract relationship file | Population growth on 2020 tracts | Public domain |
| OpenStreetMap via Overpass | Competing candy and confectionery shops | ODbL |
| Nominatim, Census geocoder | Place search at request time | ODbL / public domain |
| Esri gray canvas | Map tiles | Free with attribution |

Mock inputs, all in `data/` and meant to be edited: five stores, two distribution centers with weekly capacity per category, $120 base spend per household, $1.5M for a general store and $1.0M for a specialty store.

The B05006 region cells are resolved by label from the table definition at pipeline time, because their numbering shifts between vintages.

---

## Architecture

```
pipeline/        tracts + places, ACS with heritage segments and the 2010→2020 crosswalk, competitors
data/            committed outputs plus mock stores and distribution centers
lib/spatial/     haversine, stats, TSP, Moran (shared with atl-mcp)
lib/model/       demand, gravity, market, optimizer, simulate, params
lib/tools/       MCP tools, prompts, resources, one registration for both transports
lib/render/      the self-contained HTML map
lib/view-state   URL hash encoding shared by browser and server
app/api/         tracts, static, market, sites, forecast, geocode
app/mcp/         remote MCP endpoint (mcp-handler)
mcp/stdio.ts     local MCP server (StdioServerTransport) + render_map
components/      Leaflet map, sidebar, legend
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
- The optimizer is greedy; the forecast is a simple two-center reroute. Both are honest about being heuristics.
- Spend, costs and capacities are placeholders.
