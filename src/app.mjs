// Minimal single-zone UI increment: Z7 only, to validate the interactive
// pieces (quality select, assumption sliders, live chart) before wiring up
// the full multi-zone checkbox UI from spec Section 4.

import { ZONES, CATEGORY_DEFAULTS } from './data.mjs';
import { computeZoneSweep } from './model.mjs';
import { renderLineChart, SERIES_COLORS } from './chart.mjs';

const zoneDef = ZONES.OUT_Z7;
const defaults = CATEGORY_DEFAULTS.outlands;

const state = {
  quality: 'Q3',
  assumptions: { ...defaults },
};

const els = {
  quality: document.getElementById('quality'),
  searchTime: document.getElementById('search_time'),
  mobProportion: document.getElementById('mob_proportion'),
  chargeFraction: document.getElementById('charge_fraction_enchanted'),
  killTime: document.getElementById('kill_time'),
  searchTimeVal: document.getElementById('search_time_val'),
  mobProportionVal: document.getElementById('mob_proportion_val'),
  chargeFractionVal: document.getElementById('charge_fraction_enchanted_val'),
  killTimeVal: document.getElementById('kill_time_val'),
  reset: document.getElementById('reset'),
  chart: document.getElementById('chart'),
  table: document.getElementById('table'),
};

function readInputs() {
  state.quality = els.quality.value;
  state.assumptions.search_time = Number(els.searchTime.value);
  state.assumptions.mob_proportion = Number(els.mobProportion.value) / 100;
  state.assumptions.charge_fraction_enchanted = Number(els.chargeFraction.value) / 100;
  state.assumptions.kill_time = Number(els.killTime.value);
}

function syncReadouts() {
  els.searchTimeVal.textContent = `${els.searchTime.value}s`;
  els.mobProportionVal.textContent = `${els.mobProportion.value}%`;
  els.chargeFractionVal.textContent = `${els.chargeFraction.value}%`;
  els.killTimeVal.textContent = `${els.killTime.value}s`;
}

function render() {
  readInputs();
  syncReadouts();

  const sweep = computeZoneSweep(zoneDef, state.quality, state.assumptions);
  renderLineChart(els.chart, [{ name: zoneDef.name, color: SERIES_COLORS[0], sweep }]);

  els.table.innerHTML = `
    <thead><tr><th>Threshold</th><th>Label</th><th>Fame/hour</th></tr></thead>
    <tbody>${sweep.map((p) => `<tr><td>${p.tau}</td><td>${p.label}</td><td>${Math.round(p.famePerHour).toLocaleString()}</td></tr>`).join('')}</tbody>
  `;
}

function resetDefaults() {
  els.searchTime.value = defaults.search_time;
  els.mobProportion.value = defaults.mob_proportion * 100;
  els.chargeFraction.value = defaults.charge_fraction_enchanted * 100;
  els.killTime.value = defaults.kill_time;
  render();
}

[els.quality, els.searchTime, els.mobProportion, els.chargeFraction, els.killTime].forEach((el) =>
  el.addEventListener('input', render)
);
els.reset.addEventListener('click', resetDefaults);

resetDefaults();

// Chromium restores previously-set range/select values on reload/back-forward
// navigation, sometimes after this module has already run and set the real
// defaults. Reassert once more after 'load' to win that race.
window.addEventListener('load', resetDefaults);
window.addEventListener('pageshow', resetDefaults);
