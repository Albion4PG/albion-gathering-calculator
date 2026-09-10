# Raw game data

These are unmodified client data files (provided directly, not redistributed
from any third-party source) used to generate [`src/gamedata.generated.mjs`](../src/gamedata.generated.mjs)
via [`scripts/build_gamedata.py`](../scripts/build_gamedata.py):

| File | Used for |
|---|---|
| `items.xml` | `famevalue` per tier/enchant |
| `harvestables.xml` | `charges`, `static_tick`, `elemental_tick` per tier |
| `rareresourcedistribution.xml` | enchant probability tables, all zone types |
| `gamedata.xml` | `gatheringfamefactor` per zone danger type |
| `resourcedistpresets.xml` | node weights, Royal + Outlands zones |
| `world.xml` | node weights, Roads (Avalonian tunnel) zones — see below |

Regenerate after updating any of these files to a new game patch:

```bash
python scripts/build_gamedata.py
```

The script asserts every value it extracts is internally consistent (e.g.
all 5 resource types give identical `famevalue`/`charges`/tick tables) and
prints any divergence rather than silently picking one. One confirmed,
accepted divergence: `T4_HIDE`'s static harvest time is 3.6s in the raw
data, not the flat 4.0s every other tier/resource combination uses. The
calculator's model blends all 5 resource types into one curve per zone
(no per-resource-type distinction anywhere else in the formula), so this
one cell is left at the shared 4.0s value as a known, minor approximation
rather than restructuring the model to be resource-type-aware for a ~10%
effect on a single cell.

## Roads (Avalonian tunnel) node weights, from `world.xml`

Unlike Royal/Outlands, `resourcedistpresets.xml` has no per-tunnel-type
preset for Roads — node counts are baked per placed cluster instance
directly in `world.xml` (13MB) instead, under
`<cluster rareresourcedistribution="ROADS" type="TUNNEL_...">`'s nested
`<distribution><resource name=.. tier=.. count=.. /></distribution>`.
`extract_roads_node_weights` in `scripts/build_gamedata.py` splits the
file once on a cluster-start lookahead (cheap, linear — a single regex
across the whole 13MB risks catastrophic backtracking given the nesting),
filters to `ROADS` clusters, and averages resource counts (T4+, summed
across all 5 resource types) per cluster `type=`.

There are 12 distinct tunnel `type=` values (`TUNNEL_ROYAL`,
`TUNNEL_ROYAL_RED`, `TUNNEL_LOW/MEDIUM/HIGH`,
`TUNNEL_BLACK_LOW/MEDIUM/HIGH`, `TUNNEL_DEEP`, `TUNNEL_DEEP_RAID`,
`TUNNEL_HIDEOUT`, `TUNNEL_HIDEOUT_DEEP`), each mapping to exactly one
declared tier (verified — zero exceptions across all ~400 clusters) but
with a different enough node-count mix per type to need its own average
rather than being pooled. `TUNNEL_HIDEOUT`/`TUNNEL_HIDEOUT_DEEP` are
guild-owned structures placed inside an otherwise-normal, publicly
gatherable tunnel zone — not a private instance — so they're included
like any other type, not excluded. Sample sizes per type range from 8
(`TUNNEL_HIGH`) to 90 (`TUNNEL_BLACK_LOW`) clusters; the script prints
each type's `n` alongside its average so low-sample entries are visible
rather than presented with the same confidence as well-sampled ones.

Checked for template/placeholder contamination (clusters sharing an
identical, suspiciously duplicated `<distribution>` block) before trusting
a naive per-type average — no type showed the concentrated-duplication
pattern that would indicate a bug (max ~9% share on any single duplicate
distribution within a type), so plain averaging across all clusters
sharing a `type=` is used as-is.

## Things confirmed while building this pipeline

Cross-checked against a hand derivation and an independent second
computation of the same underlying spec (see project history) before
building this extraction:

- `famevalue`, `charges`, `static_tick`, `elemental_tick`: exact match
  across all 5 resource types (WOOD/ORE/FIBER/HIDE/ROCK), except the
  HIDE T4 static-tick note above.
- `gatheringfamefactor`: exact match for Royal (1.0), Outlands Q1-Q6
  (1.25-1.50), and Roads (1.0, `type="tunnel"` in the source).
- Royal + Outlands node weights: exact match for every zone checked
  (Blue, Yellow, Red-T7-declared, Z5, Z6, Z7, Z8) against
  `T{declared_tier}_FR_{ROY,OUT}_WLD[_Q#]` presets in
  `resourcedistpresets.xml`, summed across `<high>`/`<medium>`/`<low>`
  bands. Outlands node counts confirmed identical across Q1-Q6 (quality
  only changes `gatheringfamefactor` and the enchant table).
- Found and fixed three real bugs in the previous hand-transcribed enchant
  table wiring: Royal Blue's T4 rate was assumed to fall back to the Royal
  default (93.8/5/1/0.2) — the source has an explicit, richer T4 rate
  (90.08/8/1.6/0.32) via the `SAFE` distribution. Royal Red and Red2 were
  both applying their T5-specific enchant rate to T4 as well as T5 — T4
  should use the same shared explicit rate as Yellow (85.12/12/2.4/0.48);
  only T5 gets the color-specific rate.
