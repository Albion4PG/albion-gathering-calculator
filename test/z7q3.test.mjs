// Sanity test: Outlands Z7, Q3, category-default assumptions, default T8
// tool. Expected values were originally the hand calculation worked
// through in chat before any code existed (no tool-tier concept at the
// time). Once tool tier became mandatory -- always T8 by default, with
// its own real speed factor applied even at default -- those original
// numbers no longer apply. Recomputed independently (script in PR
// description/session history, not by calling buildZoneStates/
// computeThresholdSweep) from the same formula plus the T8-tool
// ToolModifier factor per tier (T5: 0.35x, T6: 0.5x, T7: 0.7x time, from
// harvestables.xml, confirmed identical across all 5 resource types).

import { ZONES, CATEGORY_DEFAULTS } from '../src/data.mjs';
import { computeZoneSweep } from '../src/model.mjs';

const EXPECTED = [
  { label: 'T5.0', famePerHour: 45280 },
  { label: 'T5.1/T6.0', famePerHour: 45180 },
  { label: 'T7.0', famePerHour: 41611 },
  { label: 'T5.2/T6.1', famePerHour: 23487 },
  { label: 'T7.1', famePerHour: 18933 },
  { label: 'T5.3/T6.2', famePerHour: 9787 },
  { label: 'T7.2', famePerHour: 7273 },
  { label: 'T6.3', famePerHour: 2848 },
  { label: 'T7.3', famePerHour: 1836 },
];

const TOLERANCE = 0.005; // 0.5% relative — hand calc was rounded to whole fame/hr

const assumptions = CATEGORY_DEFAULTS.outlands;
const sweep = computeZoneSweep(ZONES.OUT_Z7, 'Q3', assumptions);

console.log('τ\tlabel\t\tfame/hr\t\texpected\tdiff%');
let failures = 0;

sweep.forEach((row, i) => {
  const exp = EXPECTED[i];
  const diffPct = exp ? ((row.famePerHour - exp.famePerHour) / exp.famePerHour) * 100 : NaN;
  const labelMatch = exp ? row.label === exp.label : false;
  const valueMatch = exp ? Math.abs(diffPct) / 100 <= TOLERANCE : false;
  const ok = labelMatch && valueMatch;
  if (!ok) failures++;

  console.log(
    `${row.tau}\t${row.label.padEnd(12)}\t${row.famePerHour.toFixed(1)}\t\t${
      exp ? exp.famePerHour : '—'
    }\t\t${exp ? diffPct.toFixed(2) : '—'}\t${ok ? 'OK' : 'FAIL'}`
  );
});

if (sweep.length !== EXPECTED.length) {
  console.log(`\nFAIL: row count mismatch — got ${sweep.length}, expected ${EXPECTED.length}`);
  failures++;
}

console.log(failures === 0 ? '\nAll rows match within tolerance.' : `\n${failures} row(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
