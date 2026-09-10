#!/usr/bin/env python3
"""
Regenerates src/gamedata.generated.mjs from the raw game-data XML files in
gamedata/. Run this after gamedata/*.xml is updated to a new game patch.

    python scripts/build_gamedata.py

Covers: famevalue (items.xml), charges/tick rates (harvestables.xml),
enchant probability tables (rareresourcedistribution.xml),
gatheringfamefactor (gamedata.xml), Royal + Outlands node weights
(resourcedistpresets.xml), and Roads/Avalonian-tunnel node weights per
tunnel type (world.xml, averaged per-cluster across ~400 tunnel
instances -- see extract_roads_node_weights).
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


def extract_tool_time_factor(harvestables_xml):
    # <ToolModifier> is keyed by tierdifference = tool_tier - node_base_tier
    # and gives a harvest-time multiplier: negative (underpowered tool, node
    # one tier above it) is slower, positive (overpowered tool) is faster.
    # There's no entry below tierdifference=-1 -- a tool 2+ tiers below a
    # node's base tier cannot harvest it at all. Identical across all 5
    # resource types (verified) so extracted once from WOOD's block.
    block = extract_harvestable_block(harvestables_xml, "WOOD")
    modifier_m = re.search(r"<ToolModifier>(.*?)</ToolModifier>", block, re.S)
    assert modifier_m, "ToolModifier block not found"
    factors = {
        tierdiff: float(timefactor)
        for tierdiff, timefactor in re.findall(
            r'<Modifier tierdifference="(-?\d)" timefactor="([0-9.]+)"', modifier_m.group(1)
        )
    }
    assert factors, "no ToolModifier entries parsed"

    # Cross-check every other resource type's table matches WOOD's exactly.
    for resource in RESOURCE_TYPES:
        if resource == "WOOD":
            continue
        other_block = extract_harvestable_block(harvestables_xml, resource)
        other_m = re.search(r"<ToolModifier>(.*?)</ToolModifier>", other_block, re.S)
        other_factors = {
            tierdiff: float(timefactor)
            for tierdiff, timefactor in re.findall(
                r'<Modifier tierdifference="(-?\d)" timefactor="([0-9.]+)"', other_m.group(1)
            )
        }
        assert other_factors == factors, f"{resource}'s ToolModifier table diverges from WOOD's"

    return factors


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
    # uses. Per world.xml, each color actually spans two declared tiers:
    # Blue=T4/T5, Yellow=T5/T6, Red=T6/T7 -- so all of T4-T7 are needed.
    weights = {}
    for declared_tier in [4, 5, 6, 7]:
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


# --- 6. Roads (Avalonian tunnel) node weights (world.xml) ------------------
#
# Unlike Royal/Outlands, Roads tunnels have no shared preset in
# resourcedistpresets.xml -- node counts are baked per placed cluster
# instance directly in world.xml, under <cluster rareresourcedistribution=
# "ROADS" type="TUNNEL_..."><distribution><resource name=.. tier=.. count=..
# /></distribution></cluster>. There are ~400 such clusters across 12
# distinct `type=` values; each type maps to exactly one declared tier
# (verified: zero exceptions across all 400), but the node-count mix
# differs enough per type that each needs its own average.
#
# world.xml is 13MB with deep, repeated nesting, so a single regex over the
# whole file risks catastrophic backtracking. Splitting once on a cluster-
# start lookahead first (cheap, linear) isolates each cluster into its own
# small chunk before any further regex runs against it.

def extract_roads_node_weights(world_xml):
    chunks = re.split(r'(?=<cluster )', world_xml)
    roads_chunks = [c for c in chunks if 'rareresourcedistribution="ROADS"' in c[:400]]
    assert roads_chunks, "no ROADS clusters found in world.xml"

    sums = {}
    counts = {}
    declared_tier_by_type = {}

    for chunk in roads_chunks:
        type_m = re.search(r'type="([A-Z0-9_]+)"', chunk)
        file_m = re.search(r'file="[^"]*_T(\d)_', chunk)
        dist_m = re.search(r'<distribution[^>]*>(.*?)</distribution>', chunk, re.S)
        rtype = type_m.group(1)
        tier = file_m.group(1) if file_m else None

        declared_tier_by_type.setdefault(rtype, set()).add(tier)
        counts[rtype] = counts.get(rtype, 0) + 1

        if dist_m:
            for name, res_tier, cnt in re.findall(
                r'<resource name="(\w+)" tier="(\d)" count="(\d+)"', dist_m.group(1)
            ):
                t = int(res_tier)
                if t < 4:
                    continue  # out of project scope (spec Section 5)
                key = (rtype, f"T{t}")
                sums[key] = sums.get(key, 0) + int(cnt)

    # Sanity check: each type should map to exactly one declared tier --
    # a type spanning more than one would mean two structurally different
    # tunnel kinds got lumped under one `type=`, which would silently
    # corrupt the average.
    for rtype, tiers in declared_tier_by_type.items():
        assert len(tiers) == 1, f"{rtype} spans multiple declared tiers: {tiers}"

    weights = {}
    print("  Roads node weights by type (n = cluster sample size):")
    for rtype in sorted(counts):
        n = counts[rtype]
        by_tier = {}
        for (t, tier_label), total in sums.items():
            if t == rtype:
                by_tier[tier_label] = round(total / n, 2)
        weights[rtype] = by_tier
        print(f"    {rtype:22s} n={n:3d}  {by_tier}")

    return weights


# --- main --------------------------------------------------------------

def main():
    items_xml = read("items.xml")
    harvestables_xml = read("harvestables.xml")
    rrd_xml = read("rareresourcedistribution.xml")
    gamedata_xml = read("gamedata.xml")
    presets_xml = read("resourcedistpresets.xml")
    world_xml = read("world.xml")

    famevalue_base = extract_famevalue(items_xml)
    charges, static_tick, elemental_tick, _divergences = extract_charges_and_ticks(harvestables_xml)
    tool_time_factor = extract_tool_time_factor(harvestables_xml)
    enchant_tables = extract_enchant_tables(rrd_xml)
    gff = extract_gff(gamedata_xml)
    royal_weights = extract_royal_node_weights(presets_xml)
    outlands_weights = extract_outlands_node_weights(presets_xml)
    roads_weights = extract_roads_node_weights(world_xml)

    data = {
        "FAMEVALUE_BASE": famevalue_base,
        "CHARGES": charges,
        "STATIC_TICK": static_tick,
        "ELEMENTAL_TICK": elemental_tick,
        "TOOL_TIME_FACTOR": tool_time_factor,
        "ENCHANT_TABLES": enchant_tables,
        "GATHERING_FAME_FACTOR": gff,
        "ROYAL_NODE_WEIGHTS_BY_DECLARED_TIER": royal_weights,
        "OUTLANDS_NODE_WEIGHTS_BY_DECLARED_TIER": outlands_weights,
        "ROADS_NODE_WEIGHTS_BY_TYPE": roads_weights,
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
