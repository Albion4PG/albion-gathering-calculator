// Pure calculation logic — the formula from docs/spec.md Section 1.
// No DOM/UI code here so it can be unit-tested headlessly (see test/).

import { CHARGES, STATIC_TICK, ELEMENTAL_TICK, famevalue } from './data.mjs';

/**
 * Build the list of (tier, enchant) states for a zone at a given quality,
 * under a given set of tunable assumption parameters.
 *
 * @param {object} zoneDef - one entry from ZONES in data.mjs
 * @param {string|undefined} quality - 'Q1'..'Q6', only used if zoneDef.requiresQuality
 * @param {{search_time:number, mob_proportion:number, charge_fraction_enchanted:number, kill_time:number}} assumptions
 * @returns {Array<{tier:string, enchant:number, famevalue:number, weight:number, fameAmount:number, blendedTime:number}>}
 */
export function buildZoneStates(zoneDef, quality, assumptions) {
  const { mob_proportion, charge_fraction_enchanted, kill_time } = assumptions;
  const gff = zoneDef.getGff(quality);

  const totalWeight = Object.values(zoneDef.nodeWeights).reduce((a, b) => a + b, 0);

  const states = [];
  for (const tier of Object.keys(zoneDef.nodeWeights)) {
    const pTier = zoneDef.nodeWeights[tier] / totalWeight;
    const enchantProbs = zoneDef.getEnchantTable(tier, quality);
    const charges = CHARGES[tier];
    const staticTick = STATIC_TICK[tier];
    const elemTick = ELEMENTAL_TICK[tier];

    for (let e = 0; e < 4; e++) {
      const pEnchant = enchantProbs[e];
      if (!pEnchant) continue; // skip zero-probability states

      const mult = e > 0 ? charge_fraction_enchanted : 1.0;
      const fv = famevalue(tier, e);

      const fameAmount = fv * charges * mult * gff;
      const staticTime = charges * staticTick * mult;
      const mobTime = kill_time + charges * elemTick * mult;
      const blendedTime = mob_proportion * mobTime + (1 - mob_proportion) * staticTime;

      states.push({
        tier,
        enchant: e,
        famevalue: fv,
        weight: pTier * pEnchant,
        fameAmount,
        blendedTime,
      });
    }
  }
  return states;
}

/**
 * Sweep every distinct famevalue present in `states` as the filter
 * threshold, and compute fame/hour for each.
 *
 * @param {Array} states - from buildZoneStates
 * @param {number} search_time
 * @returns {Array<{tau:number, label:string, famePerHour:number, famePerEncounter:number, timePerEncounter:number}>}
 */
export function computeThresholdSweep(states, search_time) {
  const distinctTaus = [...new Set(states.map((s) => s.famevalue))].sort((a, b) => a - b);

  return distinctTaus.map((tau) => {
    const qualifying = states.filter((s) => s.famevalue >= tau);
    const atTau = states.filter((s) => s.famevalue === tau);

    const famePerEncounter = qualifying.reduce((sum, s) => sum + s.weight * s.fameAmount, 0);
    const timePerEncounter =
      search_time + qualifying.reduce((sum, s) => sum + s.weight * s.blendedTime, 0);
    const famePerHour = (famePerEncounter / timePerEncounter) * 3600;

    const sortedAtTau = atTau.slice().sort((a, b) => a.tier.localeCompare(b.tier));
    const label = sortedAtTau.map((s) => `${s.tier}.${s.enchant}`).join('/');
    // Lowest tier among ties, for marker-fill color when a threshold has
    // more than one state tied on famevalue (e.g. "T5.1/T6.0").
    const tier = sortedAtTau[0].tier;

    return { tau, label, tier, famePerHour, famePerEncounter, timePerEncounter };
  });
}

/** Convenience: zone + quality + assumptions -> sweep, in one call. */
export function computeZoneSweep(zoneDef, quality, assumptions) {
  const states = buildZoneStates(zoneDef, quality, assumptions);
  return computeThresholdSweep(states, assumptions.search_time);
}
