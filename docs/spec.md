# Albion Online Gathering Fame Calculator — Spec

A static, client-side calculator that plots fame/hour vs. minimum-value
filter threshold, one line per selected zone, using a fixed model built
from real game data plus a small set of explicitly-labeled assumptions
the user can tune. No game-data values are editable — only the
assumption parameters listed in Section 3.

All game-data constants below are sourced programmatically from raw
client XML files (see [`gamedata/README.md`](../gamedata/README.md)) via
`scripts/build_gamedata.py`, not hand-transcribed.

## 1. The Model (formula)

For a given zone and a given filter threshold `τ` (a per-unit famevalue
cutoff):

```
For each (tier t, enchant e) state with famevalue(t,e) >= τ:
    include it in the "qualifying" set

fame_amount(t, e) = famevalue(t, e) × charges(t) × (charge_fraction_enchanted if e > 0 else 1.0) × gatheringfamefactor(zone)
static_time(t, e)   = charges(t) × static_tick(t)    × (charge_fraction_enchanted if e > 0 else 1.0)
mob_time(t, e)      = kill_time + charges(t) × elemental_tick(t) × (charge_fraction_enchanted if e > 0 else 1.0)
blended_time(t, e)  = mob_proportion × mob_time(t, e) + (1 - mob_proportion) × static_time(t, e)

fame_per_encounter(τ) = Σ over qualifying (t,e) [ P(tier=t) × P(enchant=e | tier=t) × fame_amount(t,e) ]
time_per_encounter(τ) = search_time + Σ over qualifying (t,e) [ P(tier=t) × P(enchant=e | tier=t) × blended_time(t,e) ]

fame_per_hour(τ) = fame_per_encounter(τ) / time_per_encounter(τ) × 3600
```

`P(tier=t)` = that tier's node-count weight ÷ total node-count weight for
the zone (including any out-of-scope tiers below T4 — see Section 2).

`P(enchant=e | tier=t)` comes from the zone's enchant probability table.

**Threshold sweep**: `τ` ranges over every distinct `famevalue(t,e)`
value present in that zone's own tiers (no padding/flat-lining before a
zone's real minimum).

**Chart**: x-axis = filter threshold, labeled by `tier.enchant` (e.g.
"T5.1/T6.0" when two states tie on value); y-axis = fame/hour. One line
per selected zone. Each zone's line only spans its own real threshold
range.

## 2. Fixed Game-Data Constants (NOT user-editable)

### famevalue(tier, enchant)

```
famevalue(t, e) = base(t) × 2^e
base: { T4: 7.5, T5: 22.5, T6: 45, T7: 75, T8: 150 }
```

### charges(tier)

`{ T4: 3, T5: 5, T6: 5, T7: 9, T8: 11 }`

### static_tick(tier) — seconds per charge, static node

`{ T4: 4, T5: 6, T6: 8, T7: 10, T8: 15 }`

### elemental_tick(tier) — seconds per charge, resource-mob variant

`{ T4: 3, T5: 3, T6: 3, T7: 5, T8: 5 }`

### gatheringfamefactor(zone type)

- Royal (all colors): `1.0`
- Outlands Q1–Q6: `1.25, 1.30, 1.35, 1.40, 1.45, 1.50`
- Roads: `1.0`
- Mists: `1.0` (defined but unused in v1 — see Section 5)

### Enchant probability tables

See `src/data.mjs` for the full numeric tables (Royal, Outlands per
quality, Roads) — reproduced there rather than duplicated here to avoid
drift between doc and code.

### Node weights per zone

See `src/data.mjs` `ZONES`. Each Royal color actually spans two declared
tiers in `world.xml` (which sets the Forest-biome node-weight preset it
draws from), so each color is modeled as two selectable zone entries
rather than picking just one: `ROYAL_BLUE_T4`/`ROYAL_BLUE_T5`,
`ROYAL_YELLOW_T5`/`ROYAL_YELLOW_T6`, `ROYAL_RED_T6`/`ROYAL_RED_T7`.

Roads node weights come from averaging per-cluster resource counts across
every Avalonian tunnel instance in `world.xml`, grouped by that cluster's
`type=` (12 distinct tunnel types — see `scripts/build_gamedata.py`
`extract_roads_node_weights` and `gamedata/README.md` for the full
extraction and per-type numbers). Within a declared tier the 12 types are
near-identical in modeled outcome (fame/hour spans only ~2% across all T6
types, for instance), so the calculator exposes one representative type
per declared tier rather than all 12: the most-prevalent type by cluster
count at each of T4/T6/T8 (`TUNNEL_LOW`/`TUNNEL_BLACK_LOW`/
`TUNNEL_DEEP_RAID`). Modeled as one `ROADS` zone entry with a T4/T6/T8
dropdown (`src/data.mjs` `ROAD_TYPES`), mirroring how Outlands zones use
a Q1-Q6 quality dropdown.

Outlands Z5's source data also lists T2/T3 node counts (140/240), but
per Section 5 (T3-and-below out of scope) they're dropped entirely
rather than folded into the P(tier) denominator — `P(tier)` for Z5
normalizes over its T4/T5 weights alone.

## 3. User-Tunable Assumption Parameters (per zone)

| Parameter | What it represents | Category default |
|---|---|---|
| `search_time` | Seconds to move/find the next node | Royal/Outlands/Roads: **10s** |
| `mob_proportion` | Fraction of encounters that are elemental/mob-type vs. static | Royal/Outlands: **25%** · Roads: **50%** |
| `charge_fraction_enchanted` | Fraction of full charge count present on an enchanted node | All zones: **50%** |
| `kill_time` | Flat seconds to kill a resource mob before harvesting (added once, not scaled by charges) | All zones: **10s** |

## 4. UI Structure

- Zone selector: single-select checkboxes grouped Royal / Outlands / Roads
  (Outlands zones carry a Q1–Q6 dropdown; the Roads zone carries a tunnel-
  type dropdown — see Section 2). Selecting a zone opens its config panel;
  only one zone can be configured/staged at a time.
- Per-zone config panel: the 4 assumption controls from Section 3,
  pre-filled with category defaults, with a reset action. The panel's
  sweep previews live on the chart (dashed, faded) as sliders move.
- "Add to plot" snapshots the staged config as a permanent chart entry
  and clears staging. The same zone can be added more than once (e.g. to
  compare assumptions); repeat entries of the same zone cycle through
  different marker shapes to stay visually distinguishable.
- "On chart" list: one row per added entry, each with a remove (×) button.
- Single chart, one line per added entry, live-updating; a marker key
  explains tier-fill colors, marker shapes, and the dashed-preview
  convention.
- No editing of Section 2 constants anywhere in the UI.

## 5. Explicitly Out of Scope (v1)

- Player buffs (Premium, Pork Pie, Quick Learn)
- Tool-tier constraints (assume full-access tools always)
- Treasures
- Off-road-vs-total-area correction for Roads
- T3 and below
- Mists zones (constants present in `src/data.mjs` for completeness,
  not wired into any zone definition — no node-weight data available)

## 6. Known Caveats

- Roads fame/hour figures likely understate reality — node density is
  computed against total zone area rather than the (unknown)
  off-road-only area.
- "Half charge for enchanted nodes" and "10s kill time" are simplifying
  assumptions, not directly sourced from a single confirmed game value.
- Elemental (resource-mob) charge counts were reused from the
  static-node table due to inconsistent raw data; lower confidence than
  the static-node numbers.
