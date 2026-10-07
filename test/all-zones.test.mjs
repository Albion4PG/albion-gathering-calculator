// Smoke test across every zone currently in ZONES (11 as of writing:
// 6 Royal, 4 Outlands x Q1-Q6, 1 Roads x T4/T6/T8) plus the universal
// buffs multiplier. Unlike z7q3.test.mjs, there's no independently
// hand-derived reference for all of these -- this instead checks
// structural invariants that must hold for *any* zone under the model's
// own formula (docs/spec.md Section 1), catching the class of bug where
// a new/changed zone entry produces NaN, a negative rate, an empty sweep,
// or a threshold list that isn't the zone's own real values.

import { ZONES, CATEGORY_DEFAULTS, ROAD_TYPES, defaultBuffs, combinedBuffMultiplier, toolCanHarvest, toolTimeFactor, yieldBonusByTier, GEAR_PIECES, GATHERING_YIELD, PORK_PIE_YIELD } from '../src/data.mjs';
import { computeZoneSweep, buildZoneStates } from '../src/model.mjs';

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

// Buffs: default (all off) must be a true no-op, and the tier-independent
// fame multipliers (Premium x Learning Points) must scale fame/hour exactly.
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

  // Premium 1.5x and 5 Learning Points 5x multiply: 7.5x fame, time untouched.
  // (Pork Pie is deliberately absent -- it's yield, covered further down.)
  const allOn = { ...defaultBuffs(), premium: { enabled: true }, learningPoints: { enabled: true, nodes: 5 } };
  check(Math.abs(combinedBuffMultiplier(allOn) - 7.5) < 1e-9, `Premium x 5 LP multiplier should be 7.5, got ${combinedBuffMultiplier(allOn)}`);
  const boosted = computeZoneSweep(def, 'Q3', assumptions, combinedBuffMultiplier(allOn));
  check(
    boosted.every((p, i) => Math.abs(p.famePerHour / baseline[i].famePerHour - 7.5) < 1e-9),
    'Premium x Learning Points should scale fame/hour by exactly 7.5x at every threshold'
  );
  check(
    combinedBuffMultiplier({ ...defaultBuffs(), porkPie: { enabled: true, tier: 'T7.3' } }) === 1,
    'Pork Pie is a yield buff and must not feed combinedBuffMultiplier'
  );
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

  // Tool tier is never optional -- there's no gathering without a tool --
  // so computeZoneSweep defaults it to 'T8' when the caller omits it.
  check(toolCanHarvest('T8', 3, undefined) === false, "toolTier is mandatory now -- an omitted/undefined tool shouldn't parse as reaching anything");

  // A restrictive tool tier must actually change computeZoneSweep's output
  // (fewer/cheaper states reachable), not just be accepted and ignored. T8
  // (the default) is the one tier that never excludes anything, so it's
  // the right baseline to compare a real restriction against.
  const def = ZONES.ROYAL_RED_T7; // has T4-T7, so a T6 tool meaningfully restricts it
  const assumptions = CATEGORY_DEFAULTS.royal;
  const unrestricted = computeZoneSweep(def, undefined, assumptions, 1, 'T8');
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

// --- Gathering yield (Avalonian tool + gathering gear) -------------------------
// Expected values are hand-copied from the per-stack table in the spec (itself
// read from spells.xml), NOT derived from GATHERING_YIELD -- so an extraction
// slip or a formula bug can't silently agree with itself. Yield sources are
// summed per node tier (yieldBonusByTier), and each tier's fame is then scaled
// by (1 + yield) in the model -- both halves are covered below.
{
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const gearOn = (tier, pieces) => ({
    tier,
    equipped: Object.fromEntries(GEAR_PIECES.map((p) => [p, pieces.includes(p)])),
  });
  const buffsWith = (overrides) => ({ ...defaultBuffs(), ...overrides });
  const bonus = (b) => Object.values(yieldBonusByTier(b));

  check(GATHERING_YIELD.GEAR_MAX_STACKS === 10, 'gear should max out at 10 stacks');
  check(GATHERING_YIELD.GEAR_PULSE_SECONDS === 30, 'gear should gain one stack per 30s');

  check(bonus(defaultBuffs()).every((v) => v === 0), 'default buffs should give zero yield bonus on every tier');

  // Full set (head + chest + feet) at 10 stacks, on a node of the gear's own tier.
  const fullSet = { T4: 0.10, T5: 0.20, T6: 0.30, T7: 0.50, T8: 0.70 };
  for (const [tier, expected] of Object.entries(fullSet)) {
    const got = yieldBonusByTier(buffsWith({ gatheringGear: gearOn(tier, ['HEAD', 'CHEST', 'FEET']) }))[tier];
    check(near(got, expected), `full ${tier} gear set on ${tier} nodes should be ${expected}, got ${got}`);
  }

  // Individual T8 pieces: chest 3.5%/stack, head and feet 1.75%/stack, x10.
  const singlePiece = { CHEST: 0.35, HEAD: 0.175, FEET: 0.175 };
  for (const [piece, expected] of Object.entries(singlePiece)) {
    const got = yieldBonusByTier(buffsWith({ gatheringGear: gearOn('T8', [piece]) })).T8;
    check(near(got, expected), `T8 ${piece} alone should be ${expected}, got ${got}`);
  }

  // Avalonian tool: flat, by tool tier, on nodes up to that tier only.
  const avalon = { T4: 0.10, T5: 0.125, T6: 0.15, T7: 0.175, T8: 0.20 };
  for (const [tier, expected] of Object.entries(avalon)) {
    const got = yieldBonusByTier(buffsWith({ toolTier: tier, avalonianTool: true }))[tier];
    check(near(got, expected), `${tier} Avalonian tool on ${tier} nodes should be ${expected}, got ${got}`);
  }
  const t6Tool = yieldBonusByTier(buffsWith({ toolTier: 'T6', avalonianTool: true }));
  check(near(t6Tool.T6, 0.15) && t6Tool.T7 === 0 && t6Tool.T8 === 0, 'a T6 Avalonian tool should give nothing on T7/T8 nodes');

  // Gear tier gates by node tier too, and the two sources add (not multiply).
  const mixed = yieldBonusByTier(buffsWith({ toolTier: 'T8', avalonianTool: true, gatheringGear: gearOn('T6', ['HEAD', 'CHEST', 'FEET']) }));
  const expectedMixed = { T4: 0.50, T5: 0.50, T6: 0.50, T7: 0.20, T8: 0.20 };
  for (const [tier, expected] of Object.entries(expectedMixed)) {
    check(near(mixed[tier], expected), `T8 Avalonian tool + full T6 gear on ${tier} nodes should be ${expected}, got ${mixed[tier]}`);
  }
  const allOn = yieldBonusByTier(buffsWith({ toolTier: 'T8', avalonianTool: true, gatheringGear: gearOn('T8', ['HEAD', 'CHEST', 'FEET']) }));
  check(near(allOn.T8, 0.90), `T8 Avalonian tool + full T8 gear should be 0.90 on T8 nodes, got ${allOn.T8}`);

  // Pork Pie (a yield buff, not fame): +15/17.5/20/22.5% by enchant, and --
  // unlike the tool and gear -- no tier cap, so a T7 pie still counts on T8 nodes.
  const pie = { T7: 0.15, 'T7.1': 0.175, 'T7.2': 0.20, 'T7.3': 0.225 };
  for (const [tier, expected] of Object.entries(pie)) {
    check(near(PORK_PIE_YIELD[tier], expected), `Pork Pie ${tier} should be +${expected}, got ${PORK_PIE_YIELD[tier]}`);
    const b = yieldBonusByTier(buffsWith({ porkPie: { enabled: true, tier } }));
    check(Object.values(b).every((v) => near(v, expected)), `Pork Pie ${tier} should add ${expected} on every node tier, got ${JSON.stringify(b)}`);
  }
  const everything = yieldBonusByTier(buffsWith({
    porkPie: { enabled: true, tier: 'T7' }, toolTier: 'T8', avalonianTool: true, gatheringGear: gearOn('T8', ['HEAD', 'CHEST', 'FEET']),
  }));
  check(near(everything.T8, 1.05), `Pork Pie T7 + T8 Avalonian + full T8 gear should sum to 1.05 on T8 nodes, got ${everything.T8}`);

  // --- Effect on fame (model.mjs) ---
  const def = ZONES.OUT_Z7;
  const assumptions = CATEGORY_DEFAULTS.outlands;
  const baseline = computeZoneSweep(def, 'Q3', assumptions);

  // Uniform yield Y on every tier scales fame/hour by exactly (1 + Y): time is
  // untouched and the threshold filter works on per-unit famevalue (unchanged).
  const uniform = Object.fromEntries(Object.keys(everything).map((t) => [t, 0.35]));
  const uniformSweep = computeZoneSweep(def, 'Q3', assumptions, 1, 'T8', undefined, uniform);
  check(
    uniformSweep.every((p, i) => near(p.famePerHour / baseline[i].famePerHour, 1.35) && near(p.timePerEncounter, baseline[i].timePerEncounter)),
    'a uniform +35% yield should scale fame/hour by exactly 1.35x with time unchanged'
  );

  // Pork Pie T7 (+0.15) + T8 Avalonian tool (+0.20) are summed, then Premium
  // (1.5x) multiplies: 1.5 x 1.35 = 2.025x. The old multiplicative model
  // would have given 1.15 x 1.5 = 1.725x with the tool contributing nothing.
  const buffs = buffsWith({ porkPie: { enabled: true, tier: 'T7' }, premium: { enabled: true }, avalonianTool: true });
  const combined = computeZoneSweep(def, 'Q3', assumptions, combinedBuffMultiplier(buffs), 'T8', undefined, yieldBonusByTier(buffs));
  check(
    combined.every((p, i) => near(p.famePerHour / baseline[i].famePerHour, 2.025)),
    'Pork Pie T7 + T8 Avalonian + Premium should scale fame/hour by 1.5 x (1 + 0.15 + 0.20) = 2.025x'
  );

  // Non-uniform yield: each tier's states scale by their own (1 + yield). Check
  // famePerEncounter against the baseline per-state fame, summed by hand.
  const perTier = { T5: 0.5, T6: 0.2, T7: 0, T8: 0 };
  const baseStates = buildZoneStates(def, 'Q3', assumptions);
  const sweep = computeZoneSweep(def, 'Q3', assumptions, 1, 'T8', undefined, perTier);
  for (const point of sweep) {
    const expected = baseStates
      .filter((s) => s.famevalue >= point.tau)
      .reduce((sum, s) => sum + s.weight * s.fameAmount * (1 + (perTier[s.tier] ?? 0)), 0);
    check(near(point.famePerEncounter, expected), `per-tier yield at τ=${point.tau}: expected ${expected}, got ${point.famePerEncounter}`);
  }
}

console.log(failures === 0 ? `\nAll ${variants.length} zone/variant combinations passed.` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
