// Fixed game-data constants. NOT user-editable anywhere in the UI.
//
// Sourced programmatically from the raw client XML files in gamedata/ via
// scripts/build_gamedata.py -> src/gamedata.generated.mjs. See
// docs/spec.md and gamedata/README.md for provenance notes and what is
// NOT yet sourced this way (Roads node weights).

import { GAMEDATA } from './gamedata.generated.mjs';

export const FAMEVALUE_BASE = GAMEDATA.FAMEVALUE_BASE;

export function famevalue(tier, enchant) {
  return FAMEVALUE_BASE[tier] * Math.pow(2, enchant);
}

export const CHARGES = GAMEDATA.CHARGES;
export const STATIC_TICK = GAMEDATA.STATIC_TICK;
export const ELEMENTAL_TICK = GAMEDATA.ELEMENTAL_TICK;

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
// preset a color draws from: Blue=T5, Yellow/Red(T6-declared)/Red2=T6,
// Red(T7-declared)=T7 — confirmed by summing each T{n}_FR_ROY_WLD preset
// and matching exactly against every color's previously-known weights.

const ROYAL_W = GAMEDATA.ROYAL_NODE_WEIGHTS_BY_DECLARED_TIER;
const OUT_W = GAMEDATA.OUTLANDS_NODE_WEIGHTS_BY_DECLARED_TIER;

export const ZONES = {
  ROYAL_BLUE: {
    id: 'ROYAL_BLUE',
    name: 'Royal — Blue',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: ROYAL_W[5],
    getGff: () => GATHERING_FAME_FACTOR.royal,
    // SAFE distribution: explicit T4 rate, default (Royal DEFAULT) for T5+
    getEnchantTable: (tier) => resolveEnchant('SAFE', tier),
  },
  ROYAL_YELLOW: {
    id: 'ROYAL_YELLOW',
    name: 'Royal — Yellow',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: ROYAL_W[6],
    getGff: () => GATHERING_FAME_FACTOR.royal,
    getEnchantTable: (tier) => resolveEnchant('YELLOW', tier),
  },
  ROYAL_RED_T6: {
    id: 'ROYAL_RED_T6',
    name: 'Royal — Red (T6-declared)',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: ROYAL_W[6],
    getGff: () => GATHERING_FAME_FACTOR.royal,
    getEnchantTable: (tier) => resolveEnchant('RED', tier),
  },
  ROYAL_RED_T7: {
    id: 'ROYAL_RED_T7',
    name: 'Royal — Red (T7-declared)',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: ROYAL_W[7],
    getGff: () => GATHERING_FAME_FACTOR.royal,
    getEnchantTable: (tier) => resolveEnchant('RED', tier),
  },
  ROYAL_RED2: {
    id: 'ROYAL_RED2',
    name: 'Royal — Red2',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: ROYAL_W[6],
    getGff: () => GATHERING_FAME_FACTOR.royal,
    getEnchantTable: (tier) => resolveEnchant('RED2', tier),
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

  // Roads node weights are NOT yet sourced from gamedata/world.xml (13MB,
  // no per-tunnel-type preset -- needs per-cluster averaging). Hand
  // transcribed from the original spec derivation; see gamedata/README.md.
  ROADS_TUNNEL_LOW: {
    id: 'ROADS_TUNNEL_LOW',
    name: 'Roads — Tunnel (Low, T4-6)',
    group: 'roads',
    requiresQuality: false,
    nodeWeights: { T4: 28.12, T5: 17.23, T6: 15.11 },
    getGff: () => GATHERING_FAME_FACTOR.roads,
    getEnchantTable: (tier) => resolveEnchant('ROADS', tier),
  },
  ROADS_TUNNEL_BLACK_LOW: {
    id: 'ROADS_TUNNEL_BLACK_LOW',
    name: 'Roads — Tunnel (Black Low, T5-7)',
    group: 'roads',
    requiresQuality: false,
    nodeWeights: { T5: 20.85, T6: 21.49, T7: 16.09 },
    getGff: () => GATHERING_FAME_FACTOR.roads,
    getEnchantTable: (tier) => resolveEnchant('ROADS', tier),
  },
  ROADS_TUNNEL_DEEP: {
    id: 'ROADS_TUNNEL_DEEP',
    name: 'Roads — Tunnel (Deep, T6-8)',
    group: 'roads',
    requiresQuality: false,
    nodeWeights: { T6: 8.00, T7: 15.80, T8: 24.80 },
    getGff: () => GATHERING_FAME_FACTOR.roads,
    getEnchantTable: (tier) => resolveEnchant('ROADS', tier),
  },
  ROADS_TUNNEL_DEEP_RAID: {
    id: 'ROADS_TUNNEL_DEEP_RAID',
    name: 'Roads — Tunnel (Deep Raid, T6-8)',
    group: 'roads',
    requiresQuality: false,
    nodeWeights: { T6: 7.80, T7: 15.80, T8: 25.10 },
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
