// Pure calculation logic — the formula from docs/spec.md Section 1.
// No DOM/UI code here so it can be unit-tested headlessly (see test/).

import { CHARGES, STATIC_TICK, ELEMENTAL_TICK, famevalue, toolCanHarvest, toolTimeFactor } from './data.mjs';

/**
 * Build the list of (tier, enchant) states for a zone at a given quality,
 * under a given set of tunable assumption parameters.
 *
 * @param {object} zoneDef - one entry from ZONES in data.mjs
 * @param {string|undefined} quality - 'Q1'..'Q6', only used if zoneDef.requiresQuality
 * @param {{search_time:number, mob_proportion:number, charge_fraction_enchanted:number, kill_time:number}} assumptions
 * @param {number} [buffMultiplier=1] - combined Premium/Pork Pie/Learning
 *   Points multiplier (see data.mjs combinedBuffMultiplier). Applies to
 *   fame_amount only, not time -- these are fame buffs, not speed buffs.
 * @param {string} [toolTier] - 'T4'..'T8', omit for no tool-tier modeling
 *   (unlimited access, factor 1 -- the default, so callers that predate
 *   this feature are unaffected). States the tool can't reach at all are
 *   excluded and the remaining weights renormalized to sum to 1, since
 *   those nodes are never part of what you actually gather.
 * @param {{noStaticTierAbove?:boolean, noMobTierAbove?:boolean}} [tierAboveExclusions]
 *   - Independent per-type opt-out from the tool's one-tier-above exception
 *   (only meaningful together with toolTier; no-op otherwise). The tier
 *   directly above the tool is only ever reachable at enchant 0, so these
 *   only affect that one state: refusing a type forces the blend fully
 *   onto the other type (mob_proportion pinned to 1 or 0 for that state
 *   alone); refusing both drops the state entirely, as if unreachable.
 * @returns {Array<{tier:string, enchant:number, famevalue:number, weight:number, fameAmount:number, blendedTime:number}>}
 */
export function buildZoneStates(zoneDef, quality, assumptions, buffMultiplier = 1, toolTier, tierAboveExclusions = {}) {
  const { mob_proportion, charge_fraction_enchanted, kill_time } = assumptions;
  const { noStaticTierAbove = false, noMobTierAbove = false } = tierAboveExclusions;
  const gff = zoneDef.getGff(quality);

  const totalWeight = Object.values(zoneDef.nodeWeights).reduce((a, b) => a + b, 0);
  const toolTierNum = toolTier ? Number(String(toolTier).replace('T', '')) : null;

  const states = [];
  for (const tier of Object.keys(zoneDef.nodeWeights)) {
    const pTier = zoneDef.nodeWeights[tier] / totalWeight;
    const enchantProbs = zoneDef.getEnchantTable(tier, quality);
    const charges = CHARGES[tier];
    const staticTick = STATIC_TICK[tier];
    const elemTick = ELEMENTAL_TICK[tier];
    const timeFactor = toolTimeFactor(tier, toolTier);
    const isTierAbove = toolTierNum !== null && Number(String(tier).replace('T', '')) === toolTierNum + 1;

    for (let e = 0; e < 4; e++) {
      const pEnchant = enchantProbs[e];
      if (!pEnchant) continue; // skip zero-probability states
      if (!toolCanHarvest(tier, e, toolTier)) continue; // tool can't reach this node at all
      if (isTierAbove && noStaticTierAbove && noMobTierAbove) continue; // refused both ways in

      const mult = e > 0 ? charge_fraction_enchanted : 1.0;
      const fv = famevalue(tier, e);

      let effectiveMobProportion = mob_proportion;
      if (isTierAbove && noStaticTierAbove) effectiveMobProportion = 1;
      else if (isTierAbove && noMobTierAbove) effectiveMobProportion = 0;

      const fameAmount = fv * charges * mult * gff * buffMultiplier;
      const staticTime = charges * staticTick * mult * timeFactor;
      const mobTime = kill_time + charges * elemTick * mult * timeFactor;
      const blendedTime = effectiveMobProportion * mobTime + (1 - effectiveMobProportion) * staticTime;

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

  if (toolTier) {
    const totalReachableWeight = states.reduce((sum, s) => sum + s.weight, 0);
    if (totalReachableWeight > 0) {
      for (const s of states) s.weight /= totalReachableWeight;
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
export function computeZoneSweep(zoneDef, quality, assumptions, buffMultiplier = 1, toolTier, tierAboveExclusions) {
  const states = buildZoneStates(zoneDef, quality, assumptions, buffMultiplier, toolTier, tierAboveExclusions);
  return computeThresholdSweep(states, assumptions.search_time);
}
