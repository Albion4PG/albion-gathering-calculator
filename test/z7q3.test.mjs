// Sanity test: Outlands Z7, Q3, category-default assumptions.
// Expected values are the hand calculation worked through in chat before
// any code existed, so this validates the implementation against that
// independently-derived reference rather than against itself.

import { ZONES, CATEGORY_DEFAULTS } from '../src/data.mjs';
import { computeZoneSweep } from '../src/model.mjs';

const EXPECTED = [
  { label: 'T5.0', famePerHour: 30688 },
  { label: 'T5.1/T6.0', famePerHour: 32046 },
  { label: 'T7.0', famePerHour: 32866 },
  { label: 'T5.2/T6.1', famePerHour: 21433 },
  { label: 'T7.1', famePerHour: 17934 },
  { label: 'T5.3/T6.2', famePerHour: 9581 },
  { label: 'T7.2', famePerHour: 7190 },
  { label: 'T6.3', famePerHour: 2838 },
  { label: 'T7.3', famePerHour: 1833 },
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
