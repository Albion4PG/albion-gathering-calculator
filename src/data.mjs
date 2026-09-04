// Fixed game-data constants. NOT user-editable anywhere in the UI.
// See docs/spec.md for provenance/derivation notes.

export const FAMEVALUE_BASE = { T4: 7.5, T5: 22.5, T6: 45, T7: 75, T8: 150 };

export function famevalue(tier, enchant) {
  return FAMEVALUE_BASE[tier] * Math.pow(2, enchant);
}

export const CHARGES = { T4: 3, T5: 5, T6: 5, T7: 9, T8: 11 };
export const STATIC_TICK = { T4: 4, T5: 6, T6: 8, T7: 10, T8: 15 };
export const ELEMENTAL_TICK = { T4: 3, T5: 3, T6: 3, T7: 5, T8: 5 };

export const GATHERING_FAME_FACTOR = {
  royal: 1.0,
  outlands: { Q1: 1.25, Q2: 1.30, Q3: 1.35, Q4: 1.40, Q5: 1.45, Q6: 1.50 },
  roads: 1.0,
  // Mists is defined here for completeness but not wired into any zone
  // definition below — out of scope for v1 (see docs/spec.md).
  mists: 1.0,
};

// --- Enchant probability tables -------------------------------------------
// All stored as fractions (0-1), state order [e0, e1, e2, e3].

export const ROYAL_ENCHANT = {
  T4_YRR2: [0.8512, 0.12, 0.024, 0.0048], // Yellow/Red/Red2 T4
  T5_YELLOW: [0.8512, 0.12, 0.024, 0.0048], // same as T4
  T5_RED: [0.7024, 0.24, 0.048, 0.0096],
  T5_RED2: [0.5536, 0.36, 0.072, 0.0144],
  // Royal default: Blue (T4 & T5), and any T6+ in Yellow/Red/Red2
  DEFAULT: [0.938, 0.05, 0.01, 0.002],
};

export const OUTLANDS_ENCHANT = {
  T4T5_EXPLICIT: {
    Q1: [0.876, 0.10, 0.02, 0.004],
    Q2: [0.8884, 0.09, 0.018, 0.0036],
    Q3: [0.9008, 0.08, 0.016, 0.0032],
    Q4: [0.9132, 0.07, 0.014, 0.0028],
    Q5: [0.9256, 0.06, 0.012, 0.0024],
    Q6: [0.938, 0.05, 0.01, 0.002],
  },
  T6T7T8_DEFAULT: {
    Q1: [0.9008, 0.08, 0.016, 0.0032],
    Q2: [0.876, 0.10, 0.02, 0.004],
    Q3: [0.8512, 0.12, 0.024, 0.0048],
    Q4: [0.8264, 0.14, 0.028, 0.0056],
    Q5: [0.7892, 0.17, 0.034, 0.0068],
    Q6: [0.752, 0.20, 0.04, 0.008],
  },
};

export const ROADS_ENCHANT = {
  T4_EXPLICIT: [0.752, 0.20, 0.04, 0.008],
  T5_EXPLICIT: [0.8512, 0.12, 0.024, 0.0048],
  T6PLUS_DEFAULT: [0.938, 0.05, 0.01, 0.002],
};

// Mists enchant tables — defined for completeness, unused in v1 (no zones
// reference these; Mists has no UI entry and no node-weight data yet).
export const MISTS_ENCHANT_DEFAULT = {
  E0: [0.938, 0.05, 0.01, 0.002],
  E1: [0.876, 0.10, 0.02, 0.004],
  E2: [0.814, 0.15, 0.03, 0.006],
  E3: [0.752, 0.20, 0.04, 0.008],
  E4: [0.690, 0.25, 0.05, 0.010],
};

// --- Zone definitions -------------------------------------------------
// nodeWeights: modeled tiers only (T4+). Z5's source data also lists T2/T3
// node counts (140/240), but T3-and-below is out of project scope (spec
// Section 5) -- they're dropped entirely rather than folded into the
// denominator, so P(tier) for Z5 normalizes over its T4/T5 weights alone.

export const ZONES = {
  ROYAL_BLUE: {
    id: 'ROYAL_BLUE',
    name: 'Royal — Blue',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: { T4: 399, T5: 399 },
    getGff: () => GATHERING_FAME_FACTOR.royal,
    getEnchantTable: (tier) =>
      tier === 'T4' ? ROYAL_ENCHANT.DEFAULT : ROYAL_ENCHANT.DEFAULT,
  },
  ROYAL_YELLOW: {
    id: 'ROYAL_YELLOW',
    name: 'Royal — Yellow',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: { T4: 399, T5: 399, T6: 399 },
    getGff: () => GATHERING_FAME_FACTOR.royal,
    getEnchantTable: (tier) =>
      tier === 'T4' || tier === 'T5' ? ROYAL_ENCHANT.T5_YELLOW : ROYAL_ENCHANT.DEFAULT,
  },
  ROYAL_RED_T6: {
    id: 'ROYAL_RED_T6',
    name: 'Royal — Red (T6-declared)',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: { T4: 399, T5: 399, T6: 399 },
    getGff: () => GATHERING_FAME_FACTOR.royal,
    getEnchantTable: (tier) =>
      tier === 'T4' || tier === 'T5' ? ROYAL_ENCHANT.T5_RED : ROYAL_ENCHANT.DEFAULT,
  },
  ROYAL_RED_T7: {
    id: 'ROYAL_RED_T7',
    name: 'Royal — Red (T7-declared)',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: { T4: 342, T5: 400, T6: 285, T7: 171 },
    getGff: () => GATHERING_FAME_FACTOR.royal,
    getEnchantTable: (tier) =>
      tier === 'T4' || tier === 'T5' ? ROYAL_ENCHANT.T5_RED : ROYAL_ENCHANT.DEFAULT,
  },
  ROYAL_RED2: {
    id: 'ROYAL_RED2',
    name: 'Royal — Red2',
    group: 'royal',
    requiresQuality: false,
    nodeWeights: { T4: 399, T5: 399, T6: 399 },
    getGff: () => GATHERING_FAME_FACTOR.royal,
    getEnchantTable: (tier) =>
      tier === 'T4' || tier === 'T5' ? ROYAL_ENCHANT.T5_RED2 : ROYAL_ENCHANT.DEFAULT,
  },

  OUT_Z5: {
    id: 'OUT_Z5',
    name: 'Outlands — Z5',
    group: 'outlands',
    requiresQuality: true,
    nodeWeights: { T4: 360, T5: 480 }, // T2/T3 (140/240) dropped -- out of scope
    getGff: (q) => GATHERING_FAME_FACTOR.outlands[q],
    getEnchantTable: (tier, q) => OUTLANDS_ENCHANT.T4T5_EXPLICIT[q],
  },
  OUT_Z6: {
    id: 'OUT_Z6',
    name: 'Outlands — Z6',
    group: 'outlands',
    requiresQuality: true,
    nodeWeights: { T4: 180, T5: 360, T6: 560 },
    getGff: (q) => GATHERING_FAME_FACTOR.outlands[q],
    getEnchantTable: (tier, q) =>
      tier === 'T4' || tier === 'T5'
        ? OUTLANDS_ENCHANT.T4T5_EXPLICIT[q]
        : OUTLANDS_ENCHANT.T6T7T8_DEFAULT[q],
  },
  OUT_Z7: {
    id: 'OUT_Z7',
    name: 'Outlands — Z7',
    group: 'outlands',
    requiresQuality: true,
    nodeWeights: { T5: 180, T6: 400, T7: 240 },
    getGff: (q) => GATHERING_FAME_FACTOR.outlands[q],
    getEnchantTable: (tier, q) =>
      tier === 'T5' ? OUTLANDS_ENCHANT.T4T5_EXPLICIT[q] : OUTLANDS_ENCHANT.T6T7T8_DEFAULT[q],
  },
  OUT_Z8: {
    id: 'OUT_Z8',
    name: 'Outlands — Z8',
    group: 'outlands',
    requiresQuality: true,
    nodeWeights: { T6: 460, T7: 140, T8: 120 },
    getGff: (q) => GATHERING_FAME_FACTOR.outlands[q],
    getEnchantTable: (tier, q) => OUTLANDS_ENCHANT.T6T7T8_DEFAULT[q],
  },

  ROADS_TUNNEL_LOW: {
    id: 'ROADS_TUNNEL_LOW',
    name: 'Roads — Tunnel (Low, T4-6)',
    group: 'roads',
    requiresQuality: false,
    nodeWeights: { T4: 28.12, T5: 17.23, T6: 15.11 },
    getGff: () => GATHERING_FAME_FACTOR.roads,
    getEnchantTable: (tier) =>
      tier === 'T4'
        ? ROADS_ENCHANT.T4_EXPLICIT
        : tier === 'T5'
        ? ROADS_ENCHANT.T5_EXPLICIT
        : ROADS_ENCHANT.T6PLUS_DEFAULT,
  },
  ROADS_TUNNEL_BLACK_LOW: {
    id: 'ROADS_TUNNEL_BLACK_LOW',
    name: 'Roads — Tunnel (Black Low, T5-7)',
    group: 'roads',
    requiresQuality: false,
    nodeWeights: { T5: 20.85, T6: 21.49, T7: 16.09 },
    getGff: () => GATHERING_FAME_FACTOR.roads,
    getEnchantTable: (tier) =>
      tier === 'T5' ? ROADS_ENCHANT.T5_EXPLICIT : ROADS_ENCHANT.T6PLUS_DEFAULT,
  },
  ROADS_TUNNEL_DEEP: {
    id: 'ROADS_TUNNEL_DEEP',
    name: 'Roads — Tunnel (Deep, T6-8)',
    group: 'roads',
    requiresQuality: false,
    nodeWeights: { T6: 8.00, T7: 15.80, T8: 24.80 },
    getGff: () => GATHERING_FAME_FACTOR.roads,
    getEnchantTable: () => ROADS_ENCHANT.T6PLUS_DEFAULT,
  },
  ROADS_TUNNEL_DEEP_RAID: {
    id: 'ROADS_TUNNEL_DEEP_RAID',
    name: 'Roads — Tunnel (Deep Raid, T6-8)',
    group: 'roads',
    requiresQuality: false,
    nodeWeights: { T6: 7.80, T7: 15.80, T8: 25.10 },
    getGff: () => GATHERING_FAME_FACTOR.roads,
    getEnchantTable: () => ROADS_ENCHANT.T6PLUS_DEFAULT,
  },
};

// --- Per-zone-category assumption defaults (user-tunable, see model.mjs) --
export const CATEGORY_DEFAULTS = {
  royal: { search_time: 10, mob_proportion: 0.25, charge_fraction_enchanted: 0.5, kill_time: 10 },
  outlands: { search_time: 10, mob_proportion: 0.25, charge_fraction_enchanted: 0.5, kill_time: 10 },
  roads: { search_time: 10, mob_proportion: 0.50, charge_fraction_enchanted: 0.5, kill_time: 10 },
};
