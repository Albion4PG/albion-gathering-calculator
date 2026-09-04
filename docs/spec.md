# Albion Online Gathering Fame Calculator — Spec

A static, client-side calculator that plots fame/hour vs. minimum-value
filter threshold, one line per selected zone, using a fixed model built
from real game data plus a small set of explicitly-labeled assumptions
the user can tune. No game-data values are editable — only the
assumption parameters listed in Section 3.

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

See `src/data.mjs` `ZONES`. Royal Red is split into two selectable
zone entries (`ROYAL_RED_T6` / `ROYAL_RED_T7`) rather than picking one
of the two nodeweight variants that were both observed in source data.

Outlands Z5 includes T2/T3 node-count mass as `outOfScopeWeight` — it
dilutes `P(tier)` for the modeled T4/T5 tiers (representing real
node encounters you'd skip) without ever appearing as a qualifying
state, since T2/T3 have no famevalue/enchant data.

## 3. User-Tunable Assumption Parameters (per zone)

| Parameter | What it represents | Category default |
|---|---|---|
| `search_time` | Seconds to move/find the next node | Royal/Outlands/Roads: **10s** |
| `mob_proportion` | Fraction of encounters that are elemental/mob-type vs. static | Royal/Outlands: **25%** · Roads: **50%** |
| `charge_fraction_enchanted` | Fraction of full charge count present on an enchanted node | All zones: **50%** |
| `kill_time` | Flat seconds to kill a resource mob before harvesting (added once, not scaled by charges) | All zones: **10s** |

## 4. UI Structure

- Zone selector: checkboxes grouped Royal / Outlands / Roads (Outlands
  zones carry a Q1–Q6 selector).
- Per-zone config panel: the 4 assumption controls above, pre-filled
  with category defaults, with a reset action.
- Single chart, one line per checked zone, live-updating.
- No editing of Section 2 constants anywhere in the UI.

**Current dev-build status**: only one zone (Outlands Z7) is wired into
`index.html` so far, to validate the interactive pieces before building
the full multi-zone selector.

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
