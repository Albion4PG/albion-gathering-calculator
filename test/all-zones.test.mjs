// Smoke test across every zone currently in ZONES (11 as of writing:
// 6 Royal, 4 Outlands x Q1-Q6, 1 Roads x T4/T6/T8) plus the universal
// buffs multiplier. Unlike z7q3.test.mjs, there's no independently
// hand-derived reference for all of these -- this instead checks
// structural invariants that must hold for *any* zone under the model's
// own formula (docs/spec.md Section 1), catching the class of bug where
// a new/changed zone entry produces NaN, a negative rate, an empty sweep,
// or a threshold list that isn't the zone's own real values.

import { ZONES, CATEGORY_DEFAULTS, ROAD_TYPES, defaultBuffs, combinedBuffMultiplier, toolCanHarvest, toolTimeFactor } from '../src/data.mjs';
import { computeZoneSweep } from '../src/model.mjs';

const QUALITIES = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'];
const ROAD_TYPE_WEIGHTS = Object.fromEntries(ROAD_TYPES.map((t) => [t.id, t.nodeWeights]));

// Every (zone, variant) combination the UI can actually produce: one entry
// per zone normally, or one per quality/road-type for zones that require it.
function allVariants() {
  const variants = [];
  for (const [id, def] of Object.entries(ZONES)) {
    if (def.requiresQuality) {
      for (const q of QUALITIES) variants.push({ id, def, quality: q, label: `${id} ${q}` });
    } else if (def.requiresRoadType) {
      for (const t of def.roadTypes) {
        const resolvedDef = { ...def, nodeWeights: ROAD_TYPE_WEIGHTS[t.id] };
        variants.push({ id, def: resolvedDef, quality: undefined, label: `${id} ${t.label}` });
      }
    } else {
      variants.push({ id, def, quality: undefined, label: id });
    }
  }
  return variants;
}

let failures = 0;
function check(condition, message) {
  if (!condition) {
    failures++;
    console.log(`  FAIL: ${message}`);
  }
}

const variants = allVariants();
console.log(`Checking ${variants.length} zone/variant combinations...`);

for (const { def, quality, label } of variants) {
  const assumptions = CATEGORY_DEFAULTS[def.group];
  const sweep = computeZoneSweep(def, quality, assumptions);

  check(sweep.length > 0, `${label}: empty sweep (zone has no gatherable T4+ states)`);

  const taus = sweep.map((p) => p.tau);
  const sorted = [...taus].sort((a, b) => a - b);
  check(JSON.stringify(taus) === JSON.stringify(sorted), `${label}: thresholds not ascending`);
  check(new Set(taus).size === taus.length, `${label}: duplicate threshold values`);

  for (const p of sweep) {
    check(Number.isFinite(p.famePerHour), `${label}: non-finite famePerHour at τ=${p.tau}`);
    check(p.famePerHour > 0, `${label}: non-positive famePerHour (${p.famePerHour}) at τ=${p.tau}`);
    check(Number.isFinite(p.famePerEncounter) && p.famePerEncounter > 0, `${label}: bad famePerEncounter at τ=${p.tau}`);
    check(Number.isFinite(p.timePerEncounter) && p.timePerEncounter > assumptions.search_time, `${label}: timePerEncounter not > search_time at τ=${p.tau}`);
    check(typeof p.label === 'string' && p.label.length > 0, `${label}: empty label at τ=${p.tau}`);
    check(/^T[4-8]$/.test(p.tier), `${label}: unexpected tier "${p.tier}" at τ=${p.tau} (out of T4-T8 scope)`);
  }

  // The highest threshold's qualifying set is a single (tier, enchant) state
  // (or a tie), so its famePerHour must equal that state's own fame_amount /
  // its own blended_time (scaled to /hour) -- i.e. the sweep's last point
  // is internally consistent, not just "some positive number".
  const last = sweep[sweep.length - 1];
  const impliedFame = (last.famePerEncounter / last.timePerEncounter) * 3600;
  check(Math.abs(impliedFame - last.famePerHour) < 1e-6, `${label}: famePerHour doesn't match famePerEncounter/timePerEncounter at τ=${last.tau}`);
}

// Buffs: default (all off) must be a true no-op, and each buff must
// strictly increase fame/hour when enabled (they're all >1x multipliers).
{
  const def = ZONES.OUT_Z7;
  const assumptions = CATEGORY_DEFAULTS.outlands;
  const baseline = computeZoneSweep(def, 'Q3', assumptions);
  const baselineMult = combinedBuffMultiplier(defaultBuffs());
  check(baselineMult === 1, `default buffs multiplier is ${baselineMult}, expected 1 (all off)`);

  const withDefaultMult = computeZoneSweep(def, 'Q3', assumptions, baselineMult);
  check(
    JSON.stringify(baseline.map((p) => p.famePerHour)) === JSON.stringify(withDefaultMult.map((p) => p.famePerHour)),
    'explicit buffMultiplier=1 (from defaultBuffs) changes results vs. omitting it'
  );

  const allOn = { porkPie: { enabled: true, tier: 'T7.3' }, premium: { enabled: true }, learningPoints: { enabled: true, nodes: 5 } };
  const boosted = computeZoneSweep(def, 'Q3', assumptions, combinedBuffMultiplier(allOn));
  const allIncreased = boosted.every((p, i) => p.famePerHour > baseline[i].famePerHour);
  check(allIncreased, 'enabling all buffs did not strictly increase fame/hour at every threshold');
}

// Tool tier: access rule is "own base tier at any enchant, or the base
// (unenchanted) state of the tier above at a time penalty, nothing else" --
// per the exact matrix worked out with the user, not from harvestables.xml
// (which has no enchant concept in its ToolModifier table at all).
{
  const cases = [
    // [nodeTier, enchant, toolTier, expectHarvestable]
    ['T5', 0, 'T6', true], ['T5', 3, 'T6', true],
    ['T6', 0, 'T6', true], ['T6', 1, 'T6', true], ['T6', 2, 'T6', true], ['T6', 3, 'T6', true],
    ['T7', 0, 'T6', true], // one tier up, unenchanted: reachable
    ['T7', 1, 'T6', false], ['T7', 2, 'T6', false], ['T7', 3, 'T6', false], // one tier up, enchanted: not
    ['T8', 0, 'T6', false], // two tiers up: never reachable
    ['T8', 3, 'T8', true], // max tool tier is never locked out of its own tier
  ];
  for (const [nodeTier, enchant, toolTier, expected] of cases) {
    const got = toolCanHarvest(nodeTier, enchant, toolTier);
    check(got === expected, `toolCanHarvest(${nodeTier}, enchant=${enchant}, tool=${toolTier}) = ${got}, expected ${expected}`);
  }

  check(toolTimeFactor('T6', 'T6') === 1, 'same tier as tool should be 1x time');
  check(toolTimeFactor('T7', 'T6') === 1.5, 'one tier above tool should be 1.5x time (slower)');
  check(toolTimeFactor('T4', 'T8') === 0.25, 'far below tool tier should be fast (0.25x time)');

  // Omitting toolTier entirely must be a true no-op (unlimited access, 1x),
  // so every caller/test that predates this feature is unaffected.
  check(toolCanHarvest('T8', 3, undefined) === true, 'omitted toolTier should never restrict access');
  check(toolTimeFactor('T4', undefined) === 1, 'omitted toolTier should never change time');

  // A restrictive tool tier must actually change computeZoneSweep's output
  // (fewer/cheaper states reachable), not just be accepted and ignored.
  const def = ZONES.ROYAL_RED_T7; // has T4-T7, so a T6 tool meaningfully restricts it
  const assumptions = CATEGORY_DEFAULTS.royal;
  const unrestricted = computeZoneSweep(def, undefined, assumptions, 1);
  const restricted = computeZoneSweep(def, undefined, assumptions, 1, 'T6');
  check(
    restricted.length < unrestricted.length,
    `T6 tool should exclude some threshold rows from a T4-T7 zone (unrestricted=${unrestricted.length}, restricted=${restricted.length})`
  );
}

// Tier-above exclusions: independent per-type opt-out from the tool's
// one-tier-above exception (T6 tool, T7.0 is the only reachable T7 state).
{
  const def = ZONES.ROYAL_RED_T7;
  const assumptions = CATEGORY_DEFAULTS.royal;
  const findT7 = (sweep) => sweep.find((p) => p.label === 'T7.0');

  const neither = computeZoneSweep(def, undefined, assumptions, 1, 'T6', {});
  const skipStatic = computeZoneSweep(def, undefined, assumptions, 1, 'T6', { noStaticTierAbove: true });
  const skipMob = computeZoneSweep(def, undefined, assumptions, 1, 'T6', { noMobTierAbove: true });
  const skipBoth = computeZoneSweep(def, undefined, assumptions, 1, 'T6', { noStaticTierAbove: true, noMobTierAbove: true });

  check(findT7(neither) !== undefined, 'T7.0 should be present with no tier-above exclusions');
  check(findT7(skipStatic) !== undefined, 'T7.0 should still be present when only static is skipped (falls back to mob)');
  check(findT7(skipMob) !== undefined, 'T7.0 should still be present when only mob is skipped (falls back to static)');
  check(findT7(skipBoth) === undefined, 'T7.0 should vanish entirely when both static and mob are skipped');

  // Fame is identical across all three reachable variants -- only time (and
  // therefore fame/hour) should differ by which route is forced.
  const fames = [neither, skipStatic, skipMob].map((s) => findT7(s).famePerEncounter);
  check(fames.every((f) => Math.abs(f - fames[0]) < 1e-9), 'famePerEncounter for T7.0 should be unaffected by which route is forced');

  // Forcing 100% mob route should be faster (shorter time -> higher fame/hr)
  // than forcing 100% static, since mobTime/staticTime differ; the default
  // blend should sit strictly between the two forced extremes.
  const mobOnlyFame = findT7(skipStatic).famePerHour;
  const staticOnlyFame = findT7(skipMob).famePerHour;
  const blendedFame = findT7(neither).famePerHour;
  check(mobOnlyFame !== staticOnlyFame, 'forcing mob-only vs static-only should give different fame/hour');
  const [lo, hi] = [Math.min(mobOnlyFame, staticOnlyFame), Math.max(mobOnlyFame, staticOnlyFame)];
  check(blendedFame > lo && blendedFame < hi, 'default (blended) fame/hour should sit strictly between the two forced extremes');
}

console.log(failures === 0 ? `\nAll ${variants.length} zone/variant combinations passed.` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
