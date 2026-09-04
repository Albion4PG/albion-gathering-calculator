#!/usr/bin/env python3
"""
Regenerates src/gamedata.generated.mjs from the raw game-data XML files in
gamedata/. Run this after gamedata/*.xml is updated to a new game patch.

    python scripts/build_gamedata.py

Covers: famevalue (items.xml), charges/tick rates (harvestables.xml),
enchant probability tables (rareresourcedistribution.xml),
gatheringfamefactor (gamedata.xml), and Royal + Outlands node weights
(resourcedistpresets.xml).

NOT covered: Roads node weights. Those come from averaging per-cluster
resource counts across every Avalonian Roads tunnel instance in world.xml
(13MB, no per-tunnel-type preset -- counts are baked per placed cluster),
which needs its own dedicated pass. Roads weights stay hand-transcribed in
src/data.mjs for now; world.xml is included in gamedata/ for that future
pass.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAMEDATA_DIR = ROOT / "gamedata"
OUT_FILE = ROOT / "src" / "gamedata.generated.mjs"

RESOURCE_TYPES = ["WOOD", "ORE", "FIBER", "HIDE", "ROCK"]
TIERS = [4, 5, 6, 7, 8]


def read(name):
    return (GAMEDATA_DIR / name).read_text(encoding="utf-8")


# --- 1. famevalue (items.xml) ----------------------------------------------

def extract_famevalue(items_xml):
    base = {}
    for resource in RESOURCE_TYPES:
        per_resource = {}
        for tier in TIERS:
            m = re.search(
                rf'uniquename="T{tier}_{resource}"[^>]*famevalue="([0-9.]+)"', items_xml
            )
            assert m, f"famevalue not found for T{tier}_{resource}"
            per_resource[tier] = float(m.group(1))
        base[resource] = per_resource

    # cross-check all 5 resource types give identical base values per tier
    reference = base["ROCK"]
    for resource, values in base.items():
        assert values == reference, f"{resource} famevalue diverges from ROCK: {values} vs {reference}"

    return {f"T{t}": reference[t] for t in TIERS}


# --- 2. charges / tick rates (harvestables.xml) -----------------------------

def extract_harvestable_block(xml, name):
    """Return the raw text of a <Harvestable name="..."> ... </Harvestable> block."""
    m = re.search(rf'<Harvestable name="{re.escape(name)}"[^>]*>(.*?)</Harvestable>', xml, re.S)
    assert m, f"Harvestable block not found: {name}"
    return m.group(1)


def extract_tier_attr(block, tier, attr):
    m = re.search(rf'<Tier tier="{tier}"[^>]*\b{attr}="([0-9.]+)"', block)
    assert m, f"{attr} not found for tier {tier}"
    return float(m.group(1))


def extract_charges_and_ticks(harvestables_xml):
    per_resource = {}
    for resource in RESOURCE_TYPES:
        static_block = extract_harvestable_block(harvestables_xml, resource)
        critter_block = extract_harvestable_block(harvestables_xml, f"{resource}_CRITTER")
        per_resource[resource] = {
            "static": {t: extract_tier_attr(static_block, t, "harvesttimeseconds") for t in TIERS},
            "elemental": {t: extract_tier_attr(critter_block, t, "harvesttimeseconds") for t in TIERS},
            "charges": {t: int(extract_tier_attr(critter_block, t, "startcharges")) for t in TIERS},
        }

    reference = per_resource["ROCK"]
    divergences = []
    for resource, values in per_resource.items():
        for key in ("static", "elemental", "charges"):
            if values[key] != reference[key]:
                divergences.append((resource, key, values[key], reference[key]))
    if divergences:
        for resource, key, got, expected in divergences:
            print(f"  DIVERGENCE: {resource} {key} = {got} (ROCK = {expected})")

    static_tick, elemental_tick, charges = reference["static"], reference["elemental"], reference["charges"]
    return (
        {f"T{t}": charges[t] for t in TIERS},
        {f"T{t}": static_tick[t] for t in TIERS},
        {f"T{t}": elemental_tick[t] for t in TIERS},
        divergences,
    )


# --- 3. enchant probability tables (rareresourcedistribution.xml) ----------

def extract_enchant_tables(rrd_xml):
    tables = {}
    for m in re.finditer(
        r'<RareResourceDistribution name="([^"]+)">(.*?)</RareResourceDistribution>', rrd_xml, re.S
    ):
        name, body = m.group(1), m.group(2)
        entries = []
        for tier_m in re.finditer(r'<Tier(?:\s+value="(\d)")?\s*>(.*?)</Tier>', body, re.S):
            tier_value = tier_m.group(1)
            weights = [int(w) for w in re.findall(r'weight="(\d+)"', tier_m.group(2))]
            assert len(weights) == 4, f"expected 4 weights in {name}"
            total = sum(weights)
            probs = [round(w / total, 6) for w in weights]
            entries.append({"tier": int(tier_value) if tier_value else None, "probs": probs})
        tables[name] = entries
    return tables


# --- 4. gatheringfamefactor (gamedata.xml) ---------------------------------

def extract_gff(gamedata_xml):
    gff = {}
    for m in re.finditer(
        r'<ClusterDangerBonus type="([a-z0-9_]+)"[^>]*gatheringfamefactor="([0-9.]+)"', gamedata_xml
    ):
        gff[m.group(1)] = float(m.group(2))
    return gff


# --- 5. Royal + Outlands node weights (resourcedistpresets.xml) ------------

def extract_preset(presets_xml, name):
    m = re.search(rf'<preset name="{re.escape(name)}"[^>]*>(.*?)</preset>', presets_xml, re.S)
    assert m, f"preset not found: {name}"
    body = m.group(1)
    counts = {}
    for tag, tier, amount in re.findall(
        r'<(wood|rock|ore|fiber|hide)\s+tier="(\d)"\s+amount="(\d+)"', body
    ):
        t = int(tier)
        counts[t] = counts.get(t, 0) + int(amount)
    return counts


def extract_royal_node_weights(presets_xml):
    # Each Royal color zone is a single declared-tier preset (Forest biome);
    # node weights don't depend on color, only which declared tier a color
    # uses. T5=Blue, T6=Yellow/Red-T6-declared/Red2, T7=Red-T7-declared.
    weights = {}
    for declared_tier in [5, 6, 7]:
        counts = extract_preset(presets_xml, f"T{declared_tier}_FR_ROY_WLD")
        weights[declared_tier] = {f"T{t}": amt for t, amt in counts.items() if t >= 4}
    return weights


def extract_outlands_node_weights(presets_xml):
    # Node counts are identical across Q1-Q6 (verified), so any quality
    # works as the source; Q3 used here.
    weights = {}
    for declared_tier in [5, 6, 7, 8]:
        counts = extract_preset(presets_xml, f"T{declared_tier}_FR_OUT_WLD_Q3")
        weights[declared_tier] = {f"T{t}": amt for t, amt in counts.items() if t >= 4}
    return weights


# --- main --------------------------------------------------------------

def main():
    items_xml = read("items.xml")
    harvestables_xml = read("harvestables.xml")
    rrd_xml = read("rareresourcedistribution.xml")
    gamedata_xml = read("gamedata.xml")
    presets_xml = read("resourcedistpresets.xml")

    famevalue_base = extract_famevalue(items_xml)
    charges, static_tick, elemental_tick, _divergences = extract_charges_and_ticks(harvestables_xml)
    enchant_tables = extract_enchant_tables(rrd_xml)
    gff = extract_gff(gamedata_xml)
    royal_weights = extract_royal_node_weights(presets_xml)
    outlands_weights = extract_outlands_node_weights(presets_xml)

    data = {
        "FAMEVALUE_BASE": famevalue_base,
        "CHARGES": charges,
        "STATIC_TICK": static_tick,
        "ELEMENTAL_TICK": elemental_tick,
        "ENCHANT_TABLES": enchant_tables,
        "GATHERING_FAME_FACTOR": gff,
        "ROYAL_NODE_WEIGHTS_BY_DECLARED_TIER": royal_weights,
        "OUTLANDS_NODE_WEIGHTS_BY_DECLARED_TIER": outlands_weights,
    }

    header = (
        "// AUTO-GENERATED by scripts/build_gamedata.py -- do not edit by hand.\n"
        "// Source: gamedata/*.xml. Regenerate with:\n"
        "//   python scripts/build_gamedata.py\n\n"
    )
    body = "export const GAMEDATA = " + json.dumps(data, indent=2) + ";\n"
    OUT_FILE.write_text(header + body, encoding="utf-8")
    print(f"Wrote {OUT_FILE}")


if __name__ == "__main__":
    main()
