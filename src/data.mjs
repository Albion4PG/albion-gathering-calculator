// Fixed game-data constants. NOT user-editable anywhere in the UI.
//
// Sourced programmatically from the raw client XML files in gamedata/ via
// scripts/build_gamedata.py -> src/gamedata.generated.mjs. See
// docs/spec.md and gamedata/README.md for provenance notes.

import { GAMEDATA } from './gamedata.generated.mjs';

export const FAMEVALUE_BASE = GAMEDATA.FAMEVALUE_BASE;

export function famevalue(tier, enchant) {
  return FAMEVALUE_BASE[tier] * Math.pow(2, enchant);
}

export const CHARGES = GAMEDATA.CHARGES;
export const STATIC_TICK = GAMEDATA.STATIC_TICK;
export const ELEMENTAL_TICK = GAMEDATA.ELEMENTAL_TICK;

// --- Tool tier -------------------------------------------------------------
// From harvestables.xml <ToolModifier> (identical across all 5 resource
// types): a tool gets faster the more it out-tiers a node's *base* tier
// (e.g. a T8 tool on a T4 node is 0.25x time), and can reach one base tier
// above itself at a 1.5x time penalty.
//
// Access rule (confirmed with the user, not itself in harvestables.xml --
// enchant isn't part of that table at all): a tool can harvest any enchant
// level of its own base tier or below, but only the *unenchanted* state of
// the one tier above it -- an enchanted node one tier up needs a tool that
// actually matches that tier. Nothing 2+ base tiers above the tool is
// reachable at any enchant level.
export const TOOL_TIME_FACTOR = GAMEDATA.TOOL_TIME_FACTOR;
export const TOOL_TIERS = ['T4', 'T5', 'T6', 'T7', 'T8'];

function tierNum(tier) {
  return Number(String(tier).replace('T', ''));
}

// null/undefined toolTier means "no tool-tier modeling" (unlimited access,
// factor 1 always) -- the default when the parameter is omitted entirely,
// so existing callers/tests that predate this feature are unaffected.
export function toolCanHarvest(baseTier, enchant, toolTier) {
  if (!toolTier) return true;
  const base = tierNum(baseTier);
  const tool = tierNum(toolTier);
  if (base <= tool) return true;
  return base === tool + 1 && enchant === 0;
}

export function toolTimeFactor(baseTier, toolTier) {
  if (!toolTier) return 1;
  const diff = Math.max(-1, Math.min(7, tierNum(toolTier) - tierNum(baseTier)));
  return TOOL_TIME_FACTOR[String(diff)];
}

export const GATHERING_FAME_FACTOR = {
  royal: GAMEDATA.GATHERING_FAME_FACTOR.safe, // safe/yellow/orange/red all 1.0 in source
  outlands: {
    Q1: GAMEDATA.GATHERING_FAME_FACTOR.black1,
    Q2: GAMEDATA.GATHERING_FAME_FACTOR.black2,
    Q3: GAMEDATA.GATHERING_FAME_FACTOR.black3,
    Q4: GAMEDATA.GATHERING_FAME_FACTOR.black4,
    Q5: GAMEDATA.GATHERING_FAME_FACTOR.black5,
    Q6: GAMEDATA.GATHERING_FAME_FACTOR.black6,
  },
  roads: GAMEDATA.GATHERING_FAME_FACTOR.tunnel,
  // Mists is defined here for completeness but not wired into any zone
  // definition below — out of scope for v1 (see docs/spec.md).
  mists: GAMEDATA.GATHERING_FAME_FACTOR.mistsyellow,
};

// --- Enchant probability tables -------------------------------------------
// GAMEDATA.ENCHANT_TABLES entries are [{tier: N | null, probs: [p0,p1,p2,p3]}, ...]
// per RareResourceDistribution block, tier:null being the catch-all applied
// to every tier not explicitly listed. resolveEnchant looks up a specific
// tier and falls back to that catch-all, matching the client's own logic.

function resolveEnchant(tableName, tier) {
  const entries = GAMEDATA.ENCHANT_TABLES[tableName];
  const tierNum = Number(String(tier).replace('T', ''));
  const explicit = entries.find((e) => e.tier === tierNum);
  const fallback = entries.find((e) => e.tier === null);
  return (explicit || fallback).probs;
}

// --- Zone definitions -------------------------------------------------
// nodeWeights: modeled tiers only (T4+). Sourced from
// GAMEDATA.ROYAL_NODE_WEIGHTS_BY_DECLARED_TIER /
// OUTLANDS_NODE_WEIGHTS_BY_DECLARED_TIER (resourcedistpresets.xml, Forest
// biome, summed across high/medium/low bands). Z5's source data also lists
// T2/T3 node counts, but T3-and-below is out of project scope (spec
// Section 5) — dropped entirely rather than folded into the denominator.
//
// Royal node weights don't depend on color, only on which "declared tier"
// preset a color draws from — confirmed by summing each T{n}_FR_ROY_WLD
// preset and matching exactly against every color's previously-known
// weights. Each color actually spans two declared tiers in world.xml, not
// one, so each color is modeled as two zone entries:
//   Blue: T4 (majority, 17/24 in-scope clusters) / T5 (7/24)
//   Yellow: T5 (majority, 30/44) / T6 (14/44)
//   Red: T6 / T7 (both declared tiers are common, no majority/minority split)
//
// A second T6 red-danger enchant table ("RED2") also exists in the raw
// data and was briefly exposed as its own zone ("Royal — Red2"), but only
// 8 of the 63 T6/T7 red-danger clusters in world.xml reference it (vs. 55
// on "RED") — a small enough minority that it was dropped in favor of just
// the one representative Red entry per declared tier.

const ROYAL_W = GAMEDATA.ROYAL_NODE_WEIGHTS_BY_DECLARED_TIER;
const OUT_W = GAMEDATA.OUTLANDS_NODE_WEIGHTS_BY_DECLARED_TIER;
const ROAD_W = GAMEDATA.ROADS_NODE_WEIGHTS_BY_TYPE;

// world.xml has 12 distinct tunnel `type=` values, but within a declared
// tier they're near-identical in modeled outcome -- fame/hour across all
// T6 types, for instance, spans only ~22.4k-22.9k (~2%). So rather than
// exposing all 12, one representative per declared tier is picked (the
// most-prevalent type by cluster count, ties broken arbitrarily -- none
// occurred here):
//   T4: TUNNEL_LOW (52 clusters) over TUNNEL_ROYAL (44)
//   T6: TUNNEL_BLACK_LOW (90) over the other 7 T6 types (8-72 each)
//   T8: TUNNEL_DEEP_RAID (20) over TUNNEL_DEEP (10)
export const ROAD_TYPES = [
  { id: 'TUNNEL_LOW', label: 'T4', nodeWeights: ROAD_W.TUNNEL_LOW },
  { id: 'TUNNEL_BLACK_LOW', label: 'T6', nodeWeights: ROAD_W.TUNNEL_BLACK_LOW },
  { id: 'TUNNEL_DEEP_RAID', label: 'T8', nodeWeights: ROAD_W.TUNNEL_DEEP_RAID },
];

export const ZONES = {
  ROYAL_BLUE_T4: {
    id: 'ROYAL_BLUE_T4',
    name: 'Royal — Blue (T4)',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: ROYAL_W[4],
    getGff: () => GATHERING_FAME_FACTOR.royal,
    // SAFE distribution: explicit T4 rate, default (Royal DEFAULT) for T5+
    getEnchantTable: (tier) => resolveEnchant('SAFE', tier),
  },
  ROYAL_BLUE_T5: {
    id: 'ROYAL_BLUE_T5',
    name: 'Royal — Blue (T5)',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: ROYAL_W[5],
    getGff: () => GATHERING_FAME_FACTOR.royal,
    getEnchantTable: (tier) => resolveEnchant('SAFE', tier),
  },
  ROYAL_YELLOW_T5: {
    id: 'ROYAL_YELLOW_T5',
    name: 'Royal — Yellow (T5)',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: ROYAL_W[5],
    getGff: () => GATHERING_FAME_FACTOR.royal,
    getEnchantTable: (tier) => resolveEnchant('YELLOW', tier),
  },
  ROYAL_YELLOW_T6: {
    id: 'ROYAL_YELLOW_T6',
    name: 'Royal — Yellow (T6)',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: ROYAL_W[6],
    getGff: () => GATHERING_FAME_FACTOR.royal,
    getEnchantTable: (tier) => resolveEnchant('YELLOW', tier),
  },
  ROYAL_RED_T6: {
    id: 'ROYAL_RED_T6',
    name: 'Royal — Red (T6)',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: ROYAL_W[6],
    getGff: () => GATHERING_FAME_FACTOR.royal,
    getEnchantTable: (tier) => resolveEnchant('RED', tier),
  },
  ROYAL_RED_T7: {
    id: 'ROYAL_RED_T7',
    name: 'Royal — Red (T7)',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: ROYAL_W[7],
    getGff: () => GATHERING_FAME_FACTOR.royal,
    getEnchantTable: (tier) => resolveEnchant('RED', tier),
  },

  OUT_Z5: {
    id: 'OUT_Z5',
    name: 'Outlands — Z5',
    group: 'outlands',
    requiresQuality: true,
    nodeWeights: OUT_W[5],
    getGff: (q) => GATHERING_FAME_FACTOR.outlands[q],
    getEnchantTable: (tier, q) => resolveEnchant(`OUT_${q}`, tier),
  },
  OUT_Z6: {
    id: 'OUT_Z6',
    name: 'Outlands — Z6',
    group: 'outlands',
    requiresQuality: true,
    nodeWeights: OUT_W[6],
    getGff: (q) => GATHERING_FAME_FACTOR.outlands[q],
    getEnchantTable: (tier, q) => resolveEnchant(`OUT_${q}`, tier),
  },
  OUT_Z7: {
    id: 'OUT_Z7',
    name: 'Outlands — Z7',
    group: 'outlands',
    requiresQuality: true,
    nodeWeights: OUT_W[7],
    getGff: (q) => GATHERING_FAME_FACTOR.outlands[q],
    getEnchantTable: (tier, q) => resolveEnchant(`OUT_${q}`, tier),
  },
  OUT_Z8: {
    id: 'OUT_Z8',
    name: 'Outlands — Z8',
    group: 'outlands',
    requiresQuality: true,
    nodeWeights: OUT_W[8],
    getGff: (q) => GATHERING_FAME_FACTOR.outlands[q],
    getEnchantTable: (tier, q) => resolveEnchant(`OUT_${q}`, tier),
  },

  // Roads node weights are sourced from gamedata/world.xml (13MB, no
  // per-tunnel-type preset like Royal/Outlands -- averaged per-cluster
  // across each of the 12 distinct tunnel `type=` values instead; see
  // scripts/build_gamedata.py extract_roads_node_weights). Each type maps
  // to exactly one declared tier (verified, zero exceptions), but the
  // node-count mix differs enough per type that they aren't interchangeable
  // -- modeled as one zone with a type dropdown, mirroring Outlands' Q1-Q6.
  ROADS: {
    id: 'ROADS',
    name: 'Roads of Avalon',
    group: 'roads',
    requiresQuality: false,
    requiresRoadType: true,
    roadTypes: ROAD_TYPES,
    getGff: () => GATHERING_FAME_FACTOR.roads,
    getEnchantTable: (tier) => resolveEnchant('ROADS', tier),
  },
};

// --- Per-zone-category assumption defaults (user-tunable, see model.mjs) --
export const CATEGORY_DEFAULTS = {
  royal: { search_time: 10, mob_proportion: 0.25, charge_fraction_enchanted: 0.5, kill_time: 10 },
  outlands: { search_time: 10, mob_proportion: 0.25, charge_fraction_enchanted: 0.5, kill_time: 10 },
  roads: { search_time: 10, mob_proportion: 0.50, charge_fraction_enchanted: 0.5, kill_time: 10 },
};

// --- Optional fame buffs (user-tunable, all default OFF) -------------------
// Each is a flat multiplier on fame_amount only -- they don't change
// gathering speed/time, matching their real in-game behavior. Combine
// multiplicatively with each other and with gatheringfamefactor.

export const PORK_PIE_TIERS = ['T7', 'T7.1', 'T7.2', 'T7.3'];
export const PORK_PIE_MULTIPLIER = { T7: 1.15, 'T7.1': 1.175, 'T7.2': 1.2, 'T7.3': 1.225 };
export const PREMIUM_MULTIPLIER = 1.5;
export const LEARNING_POINTS_MAX_NODES = 5;

// Effect is linear from 1x (0 nodes) to 5x (5 nodes) -- each node is an
// equal additive slice (4x total range / 5 nodes = 0.8x) of the full bonus.
export function learningPointsMultiplier(nodes) {
  return 1 + (4 / LEARNING_POINTS_MAX_NODES) * nodes;
}

export function defaultBuffs() {
  return {
    porkPie: { enabled: false, tier: 'T7' },
    premium: { enabled: false },
    learningPoints: { enabled: false, nodes: LEARNING_POINTS_MAX_NODES },
    // Not a fame multiplier like the three above -- affects node access and
    // harvest speed instead, via toolCanHarvest/toolTimeFactor. Always
    // "on" (no enabled flag) since some tool is always in use; T8 is both
    // the default and the one tier that never excludes anything.
    toolTier: 'T8',
    // Independent per-type opt-out from the tool's one-tier-above exception
    // (see model.mjs buildZoneStates) -- a strategic choice, not a hard
    // game-mechanic gate, so both default reflecting typical play: skip the
    // slower one-tier-up static node, but still take the mob.
    noStaticTierAbove: true,
    noMobTierAbove: false,
  };
}

export function combinedBuffMultiplier(buffs) {
  let mult = 1;
  if (buffs.porkPie.enabled) mult *= PORK_PIE_MULTIPLIER[buffs.porkPie.tier];
  if (buffs.premium.enabled) mult *= PREMIUM_MULTIPLIER;
  if (buffs.learningPoints.enabled) mult *= learningPointsMultiplier(buffs.learningPoints.nodes);
  return mult;
}
