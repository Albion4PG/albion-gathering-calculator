// Multi-zone UI: checkbox zone selector (grouped Royal/Outlands/Roads),
// per-zone expandable config panel (4 assumption sliders + reset), one
// chart line per checked zone. See docs/spec.md Section 4.

import { ZONES, CATEGORY_DEFAULTS } from './data.mjs';
import { computeZoneSweep } from './model.mjs';
import { renderLineChart, SERIES_COLORS } from './chart.mjs';

const GROUP_LABELS = { royal: 'Royal', outlands: 'Outlands', roads: 'Roads' };
const GROUP_ORDER = ['royal', 'outlands', 'roads'];
const QUALITIES = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'];

const zoneIds = Object.keys(ZONES);

function checkedZoneIds() {
  return zoneIds.filter((id) => zoneState[id].checked);
}

// Fixed per-zone color, keyed by each zone's position in the full 13-zone
// list -- not by check-order, so a zone's color stays the same regardless
// of what else is checked. SERIES_COLORS has exactly one entry per zone,
// so this never collides.
function colorOf(zoneId) {
  const idx = zoneIds.indexOf(zoneId);
  return idx === -1 ? '#999' : SERIES_COLORS[idx % SERIES_COLORS.length];
}

// Per-zone UI state, seeded with category defaults. Persists across
// check/uncheck so toggling a zone off and back on doesn't lose tweaks.
const zoneState = {};
for (const id of zoneIds) {
  const def = ZONES[id];
  zoneState[id] = {
    checked: false,
    expanded: true,
    quality: def.requiresQuality ? 'Q3' : undefined,
    assumptions: { ...CATEGORY_DEFAULTS[def.group] },
  };
}

const els = {
  zoneList: document.getElementById('zoneList'),
  zonePanels: document.getElementById('zonePanels'),
  chart: document.getElementById('chart'),
  legend: document.getElementById('legend'),
};

// --- zone selector -----------------------------------------------------

function renderZoneList() {
  const checkedIds = checkedZoneIds();
  els.zoneList.innerHTML = GROUP_ORDER.map((group) => {
    const ids = zoneIds.filter((id) => ZONES[id].group === group);
    const rows = ids.map((id) => {
      const def = ZONES[id];
      const s = zoneState[id];
      const qualitySelect = def.requiresQuality
        ? `<select class="quality-select" data-zone="${id}" data-role="quality" autocomplete="off">
            ${QUALITIES.map((q) => `<option value="${q}" ${q === s.quality ? 'selected' : ''}>${q}</option>`).join('')}
          </select>`
        : '';
      return `
        <div class="zone-row ${s.checked ? 'checked' : ''}">
          <span class="swatch" style="background:${colorOf(id)}"></span>
          <label>
            <input type="checkbox" data-zone="${id}" data-role="check" ${s.checked ? 'checked' : ''} autocomplete="off" />
            ${def.name}
          </label>
          ${qualitySelect}
        </div>`;
    }).join('');
    return `<div class="zone-group"><h3 class="zone-group-title">${GROUP_LABELS[group]}</h3>${rows}</div>`;
  }).join('');
}

els.zoneList.addEventListener('change', (e) => {
  const zoneId = e.target.dataset.zone;
  if (!zoneId) return;
  if (e.target.dataset.role === 'check') {
    zoneState[zoneId].checked = e.target.checked;
    if (e.target.checked) zoneState[zoneId].expanded = true;
    renderAll();
  } else if (e.target.dataset.role === 'quality') {
    zoneState[zoneId].quality = e.target.value;
    renderAll();
  }
});

// --- per-zone config panels ---------------------------------------------

function renderZonePanels() {
  const checkedIds = checkedZoneIds();

  if (checkedIds.length === 0) {
    els.zonePanels.innerHTML = '<div class="empty-hint">Check a zone on the left to configure it and see it on the chart.</div>';
    return;
  }

  els.zonePanels.innerHTML = checkedIds.map((id) => {
    const def = ZONES[id];
    const s = zoneState[id];
    const a = s.assumptions;
    const sweep = computeZoneSweep(def, s.quality, a);

    return `
      <div class="zone-card ${s.expanded ? '' : 'collapsed'}" data-zone="${id}">
        <div class="zone-card-header" data-role="toggle" data-zone="${id}">
          <span class="swatch" style="background:${colorOf(id)}"></span>
          <span class="name">${def.name}${def.requiresQuality ? ` (${s.quality})` : ''}</span>
          <button type="button" class="zone-card-reset" data-role="reset" data-zone="${id}">Reset defaults</button>
          <span class="chevron">&#9660;</span>
        </div>
        <div class="zone-card-body">
          <div class="zone-card-grid">
            <div class="field">
              <label>Search time <span class="val" data-readout="search_time">${a.search_time}s</span></label>
              <input type="range" min="0" max="60" step="1" value="${a.search_time}" data-zone="${id}" data-param="search_time" autocomplete="off" />
            </div>
            <div class="field">
              <label>Mob proportion <span class="val" data-readout="mob_proportion">${Math.round(a.mob_proportion * 100)}%</span></label>
              <input type="range" min="0" max="100" step="1" value="${Math.round(a.mob_proportion * 100)}" data-zone="${id}" data-param="mob_proportion" autocomplete="off" />
            </div>
            <div class="field">
              <label>Charge fraction (enchanted) <span class="val" data-readout="charge_fraction_enchanted">${Math.round(a.charge_fraction_enchanted * 100)}%</span></label>
              <input type="range" min="0" max="100" step="1" value="${Math.round(a.charge_fraction_enchanted * 100)}" data-zone="${id}" data-param="charge_fraction_enchanted" autocomplete="off" />
            </div>
            <div class="field">
              <label>Kill time <span class="val" data-readout="kill_time">${a.kill_time}s</span></label>
              <input type="range" min="0" max="60" step="1" value="${a.kill_time}" data-zone="${id}" data-param="kill_time" autocomplete="off" />
            </div>
          </div>
          <table class="mini">
            <thead><tr><th>Threshold</th><th>Label</th><th>Fame/hour</th></tr></thead>
            <tbody>${sweep.map((p) => `<tr><td>${p.tau}</td><td>${p.label}</td><td>${Math.round(p.famePerHour).toLocaleString()}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}

els.zonePanels.addEventListener('input', (e) => {
  const zoneId = e.target.dataset.zone;
  const param = e.target.dataset.param;
  if (!zoneId || !param) return;

  const raw = Number(e.target.value);
  const value = param === 'mob_proportion' || param === 'charge_fraction_enchanted' ? raw / 100 : raw;
  zoneState[zoneId].assumptions[param] = value;

  // Live-update just this card's readout/table and the chart, without a
  // full re-render (avoids fighting focus/scroll on the slider being dragged).
  const card = els.zonePanels.querySelector(`.zone-card[data-zone="${zoneId}"]`);
  const readout = card.querySelector(`[data-readout="${param}"]`);
  readout.textContent = param === 'mob_proportion' || param === 'charge_fraction_enchanted' ? `${raw}%` : `${raw}s`;
  const def = ZONES[zoneId];
  const s = zoneState[zoneId];
  const sweep = computeZoneSweep(def, s.quality, s.assumptions);
  card.querySelector('table.mini tbody').innerHTML = sweep
    .map((p) => `<tr><td>${p.tau}</td><td>${p.label}</td><td>${Math.round(p.famePerHour).toLocaleString()}</td></tr>`)
    .join('');

  renderChart();
});

els.zonePanels.addEventListener('click', (e) => {
  const role = e.target.dataset.role;
  const zoneId = e.target.dataset.zone;
  if (!zoneId) return;

  if (role === 'reset') {
    const def = ZONES[zoneId];
    zoneState[zoneId].assumptions = { ...CATEGORY_DEFAULTS[def.group] };
    renderAll();
  } else if (role === 'toggle') {
    zoneState[zoneId].expanded = !zoneState[zoneId].expanded;
    renderAll();
  }
});

// --- chart ---------------------------------------------------------------

function renderChart() {
  const checkedIds = checkedZoneIds();
  const seriesList = checkedIds.map((id) => {
    const def = ZONES[id];
    const s = zoneState[id];
    return {
      name: `${def.name}${def.requiresQuality ? ` (${s.quality})` : ''}`,
      color: colorOf(id),
      group: def.group,
      sweep: computeZoneSweep(def, s.quality, s.assumptions),
    };
  });
  renderLineChart(els.chart, seriesList);

  els.legend.innerHTML = seriesList
    .map((s) => `<span class="legend-item"><span class="legend-swatch" style="background:${s.color}"></span>${s.name}</span>`)
    .join('');
}

// --- top-level render ------------------------------------------------------

function renderAll() {
  renderZoneList();
  renderZonePanels();
  renderChart();
}

renderAll();

// Chromium restores checkbox/select state left over from a prior load on
// reload/back-forward, sometimes after this module has already run. Since
// our own state object is the source of truth here (not the DOM), just
// re-render from it once more after load to override any such restoration.
window.addEventListener('load', renderAll);
window.addEventListener('pageshow', renderAll);
