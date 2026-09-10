// Single-zone-at-a-time config UI: pick one zone (radio selector, grouped
// Royal/Outlands/Roads) to open its config panel. Its sweep previews live
// on the chart (dashed, faded) as the four assumption sliders move; clicking
// "Add to plot" snapshots that config as a permanent entry. Entries are
// listed under "On chart" with an X to remove them individually — the same
// zone can be added more than once (e.g. to compare assumptions), in which
// case repeat entries cycle through different marker shapes so they stay
// visually distinguishable. See docs/spec.md Section 4.

import {
  ZONES, CATEGORY_DEFAULTS, ROAD_TYPES,
  PORK_PIE_TIERS, PORK_PIE_MULTIPLIER, LEARNING_POINTS_MAX_NODES,
  defaultBuffs, combinedBuffMultiplier,
} from './data.mjs';
import { computeZoneSweep } from './model.mjs';
import { renderLineChart, SERIES_COLORS, MARKER_SHAPES, markerIconSvg } from './chart.mjs';

const ROAD_TYPE_LABEL = Object.fromEntries(ROAD_TYPES.map((t) => [t.id, t.label]));
const ROAD_TYPE_WEIGHTS = Object.fromEntries(ROAD_TYPES.map((t) => [t.id, t.nodeWeights]));

const GROUP_LABELS = { royal: 'Royal', outlands: 'Outlands', roads: 'Roads' };
const GROUP_ORDER = ['royal', 'outlands', 'roads'];
const QUALITIES = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'];
const TIER_FILL = { T4: '#4887B0', T5: '#B73C38', T6: '#E48435', T7: '#E5BF3B', T8: '#FFFFFF' };

const zoneIds = Object.keys(ZONES);

// Fixed per-zone color, keyed by each zone's position in the full 11-zone
// list -- not by selection/add-order, so a zone's color stays the same
// regardless of what else is selected/added. SERIES_COLORS has exactly one
// entry per zone, so this never collides.
function colorOf(zoneId) {
  const idx = zoneIds.indexOf(zoneId);
  return idx === -1 ? '#999' : SERIES_COLORS[idx % SERIES_COLORS.length];
}

// Per-zone draft config, seeded with category defaults. This is the "staging"
// state the currently-selected zone's panel edits; clicking Add to plot
// snapshots it. Kept per-zone (not reset on selection change) so switching
// zones and back doesn't lose tweaks.
const zoneState = {};
for (const id of zoneIds) {
  const def = ZONES[id];
  zoneState[id] = {
    quality: def.requiresQuality ? 'Q3' : undefined,
    roadType: def.requiresRoadType ? def.roadTypes[0].id : undefined,
    assumptions: { ...CATEGORY_DEFAULTS[def.group] },
  };
}

// Zones with a road-type dropdown don't have a static nodeWeights -- resolve
// it from the currently-selected road type before handing the zone def to
// computeZoneSweep (which reads zoneDef.nodeWeights directly).
function resolvedZoneDef(id, state) {
  const def = ZONES[id];
  if (!def.requiresRoadType) return def;
  return { ...def, nodeWeights: ROAD_TYPE_WEIGHTS[state.roadType] };
}

function variantSuffix(def, state) {
  if (def.requiresQuality) return ` (${state.quality})`;
  if (def.requiresRoadType) return ` — ${ROAD_TYPE_LABEL[state.roadType]}`;
  return '';
}

// Hover/focus "?" tooltip icon for a field label. tabindex makes it
// reachable (and its :focus-triggered tooltip visible) via keyboard too.
function infoIcon(text) {
  return `<span class="info-icon" tabindex="0">?<span class="tooltip-text">${text}</span></span>`;
}

const PARAM_HELP = {
  search_time: 'Seconds spent walking to and finding the next node before you can start harvesting it.',
  mob_proportion: 'Share of nodes that are elemental resource mobs (must be killed first) rather than static ground nodes.',
  charge_fraction_enchanted: "Fraction of a node's full charge count still present when you find it, for enchanted (higher-tier) nodes.",
  kill_time: 'Flat seconds to kill a resource mob before you can start harvesting it -- added once per mob, not per charge.',
};

// Universal buffs (Pork Pie / Premium / Learning Points): one global on/off
// state applied to every entry's fame_amount, current and future -- not
// snapshotted per zone/entry, so toggling one instantly re-scales the whole
// chart. All default off per spec Section 5 (previously out of scope).
let buffs = defaultBuffs();
function currentBuffMultiplier() {
  return combinedBuffMultiplier(buffs);
}

// Only one zone can be staged/previewed at a time.
let selectedZoneId = null;

// Entries actually plotted on the chart: { id, zoneId, quality, assumptions, shape }.
let entries = [];
let nextEntryId = 1;

function entriesFor(zoneId) {
  return entries.filter((e) => e.zoneId === zoneId);
}

const els = {
  zoneList: document.getElementById('zoneList'),
  zonePanels: document.getElementById('zonePanels'),
  addedList: document.getElementById('addedList'),
  chart: document.getElementById('chart'),
  legend: document.getElementById('legend'),
  markerKey: document.getElementById('markerKey'),
  buffsPanel: document.getElementById('buffsPanel'),
};

function entryLabel(entry) {
  const def = ZONES[entry.zoneId];
  const base = `${def.name}${variantSuffix(def, entry)}`;
  const siblings = entriesFor(entry.zoneId);
  if (siblings.length <= 1) return base;
  const ordinal = siblings.findIndex((e) => e.id === entry.id) + 1;
  return `${base} #${ordinal}`;
}

// --- zone selector -----------------------------------------------------

function renderZoneList() {
  els.zoneList.innerHTML = GROUP_ORDER.map((group) => {
    const ids = zoneIds.filter((id) => ZONES[id].group === group);
    const rows = ids.map((id) => {
      const def = ZONES[id];
      const s = zoneState[id];
      const isSelected = id === selectedZoneId;
      const qualitySelect = def.requiresQuality
        ? `<select class="quality-select" data-zone="${id}" data-role="quality" autocomplete="off">
            ${QUALITIES.map((q) => `<option value="${q}" ${q === s.quality ? 'selected' : ''}>${q}</option>`).join('')}
          </select>`
        : '';
      const roadTypeSelect = def.requiresRoadType
        ? `<select class="road-type-select" data-zone="${id}" data-role="roadType" autocomplete="off">
            ${def.roadTypes.map((t) => `<option value="${t.id}" ${t.id === s.roadType ? 'selected' : ''}>${t.label}</option>`).join('')}
          </select>`
        : '';
      return `
        <div class="zone-row ${isSelected ? 'checked' : ''}">
          <span class="swatch" style="background:${colorOf(id)}"></span>
          <label>
            <input type="checkbox" data-zone="${id}" data-role="select" ${isSelected ? 'checked' : ''} autocomplete="off" />
            ${def.name}
          </label>
          ${qualitySelect}${roadTypeSelect}
        </div>`;
    }).join('');
    return `<div class="zone-group"><h3 class="zone-group-title">${GROUP_LABELS[group]}</h3>${rows}</div>`;
  }).join('');
}

// Checkboxes here behave like a single-select toggle group (only one zone
// staged at a time), not independent checkboxes: checking one stages that
// zone (and un-checks whichever was staged before, on re-render); unchecking
// the currently-staged one clears staging/preview entirely.
els.zoneList.addEventListener('change', (e) => {
  const zoneId = e.target.dataset.zone;
  if (!zoneId) return;
  if (e.target.dataset.role === 'select') {
    selectedZoneId = e.target.checked ? zoneId : null;
    renderAll();
  } else if (e.target.dataset.role === 'quality') {
    zoneState[zoneId].quality = e.target.value;
    renderAll();
  } else if (e.target.dataset.role === 'roadType') {
    zoneState[zoneId].roadType = e.target.value;
    renderAll();
  }
});

// --- on-chart list (added entries) --------------------------------------

function renderAddedList() {
  if (entries.length === 0) {
    els.addedList.innerHTML = '<div class="empty-hint">Nothing on the chart yet. Configure a zone below and click "Add to plot".</div>';
    return;
  }
  els.addedList.innerHTML = entries.map((entry) => `
    <div class="added-row">
      ${markerIconSvg(entry.shape, colorOf(entry.zoneId))}
      <span class="name">${entryLabel(entry)}</span>
      <button type="button" class="remove-btn" data-role="remove" data-entry="${entry.id}" title="Remove from chart">&times;</button>
    </div>`).join('');
}

els.addedList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-role="remove"]');
  if (!btn) return;
  const entryId = Number(btn.dataset.entry);
  entries = entries.filter((e) => e.id !== entryId);
  renderAll();
});

// --- selected zone's config panel (staging + live preview) ---------------

function renderZonePanels() {
  if (!selectedZoneId) {
    els.zonePanels.innerHTML = '<div class="empty-hint">Select a zone on the left to configure it and preview it on the chart, then click "+ Add to plot" to save it there.</div>';
    return;
  }

  const id = selectedZoneId;
  const def = ZONES[id];
  const s = zoneState[id];
  const a = s.assumptions;
  const sweep = computeZoneSweep(resolvedZoneDef(id, s), s.quality, a, currentBuffMultiplier());

  els.zonePanels.innerHTML = `
    <div class="zone-card" data-zone="${id}">
      <div class="zone-card-header">
        <span class="swatch" style="background:${colorOf(id)}"></span>
        <span class="name">${def.name}${variantSuffix(def, s)}</span>
        <button type="button" class="zone-card-reset" data-role="reset" data-zone="${id}">Reset defaults</button>
      </div>
      <div class="zone-card-body">
        <div class="zone-card-grid">
          <div class="field">
            <label><span class="label-text">Search time ${infoIcon(PARAM_HELP.search_time)}</span><span class="val" data-readout="search_time">${a.search_time}s</span></label>
            <input type="range" min="0" max="60" step="1" value="${a.search_time}" data-zone="${id}" data-param="search_time" autocomplete="off" />
          </div>
          <div class="field">
            <label><span class="label-text">Mob proportion ${infoIcon(PARAM_HELP.mob_proportion)}</span><span class="val" data-readout="mob_proportion">${Math.round(a.mob_proportion * 100)}%</span></label>
            <input type="range" min="0" max="100" step="1" value="${Math.round(a.mob_proportion * 100)}" data-zone="${id}" data-param="mob_proportion" autocomplete="off" />
          </div>
          <div class="field">
            <label><span class="label-text">Charge fraction (enchanted) ${infoIcon(PARAM_HELP.charge_fraction_enchanted)}</span><span class="val" data-readout="charge_fraction_enchanted">${Math.round(a.charge_fraction_enchanted * 100)}%</span></label>
            <input type="range" min="0" max="100" step="1" value="${Math.round(a.charge_fraction_enchanted * 100)}" data-zone="${id}" data-param="charge_fraction_enchanted" autocomplete="off" />
          </div>
          <div class="field">
            <label><span class="label-text">Kill time ${infoIcon(PARAM_HELP.kill_time)}</span><span class="val" data-readout="kill_time">${a.kill_time}s</span></label>
            <input type="range" min="0" max="60" step="1" value="${a.kill_time}" data-zone="${id}" data-param="kill_time" autocomplete="off" />
          </div>
        </div>
        <p class="preview-hint">Previewing on chart (dashed) — not yet added.</p>
        <table class="mini">
          <thead><tr><th>Threshold</th><th>Label</th><th>Fame/hour</th></tr></thead>
          <tbody>${sweep.map((p) => `<tr><td>${p.tau}</td><td>${p.label}</td><td>${Math.round(p.famePerHour).toLocaleString()}</td></tr>`).join('')}</tbody>
        </table>
        <button type="button" class="add-btn" data-role="add" data-zone="${id}">+ Add to plot</button>
      </div>
    </div>`;
}

els.zonePanels.addEventListener('input', (e) => {
  const zoneId = e.target.dataset.zone;
  const param = e.target.dataset.param;
  if (!zoneId || !param) return;

  const raw = Number(e.target.value);
  const value = param === 'mob_proportion' || param === 'charge_fraction_enchanted' ? raw / 100 : raw;
  zoneState[zoneId].assumptions[param] = value;

  // Live-update just this card's readout/table, without a full re-render
  // (avoids fighting focus/scroll on the slider being dragged). The chart
  // preview is cheap to redraw wholesale, so that one does refresh live.
  const card = els.zonePanels.querySelector(`.zone-card[data-zone="${zoneId}"]`);
  const readout = card.querySelector(`[data-readout="${param}"]`);
  readout.textContent = param === 'mob_proportion' || param === 'charge_fraction_enchanted' ? `${raw}%` : `${raw}s`;
  const s = zoneState[zoneId];
  const sweep = computeZoneSweep(resolvedZoneDef(zoneId, s), s.quality, s.assumptions, currentBuffMultiplier());
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
  } else if (role === 'add') {
    const s = zoneState[zoneId];
    const shape = MARKER_SHAPES[entriesFor(zoneId).length % MARKER_SHAPES.length];
    entries.push({
      id: nextEntryId++,
      zoneId,
      quality: s.quality,
      roadType: s.roadType,
      assumptions: { ...s.assumptions },
      shape,
    });
    trackAddToPlot(zoneId, s);
    selectedZoneId = null;
    renderAll();
  }
});

// --- analytics --------------------------------------------------------
// Fire-and-forget GA4 custom event, guarded so an ad-blocker (gtag simply
// undefined) or missing analytics script never breaks the actual feature.
function trackAddToPlot(zoneId, s) {
  if (typeof gtag !== 'function') return;
  gtag('event', 'add_to_plot', {
    zone_id: zoneId,
    zone_name: ZONES[zoneId].name,
    quality: s.quality || '(n/a)',
    road_type: s.roadType || '(n/a)',
    search_time: s.assumptions.search_time,
    mob_proportion: s.assumptions.mob_proportion,
    charge_fraction_enchanted: s.assumptions.charge_fraction_enchanted,
    kill_time: s.assumptions.kill_time,
    pork_pie: buffs.porkPie.enabled ? buffs.porkPie.tier : 'off',
    premium: buffs.premium.enabled,
    learning_points: buffs.learningPoints.enabled ? buffs.learningPoints.nodes : 0,
  });
}

// --- universal buffs -------------------------------------------------------

function renderBuffsPanel() {
  els.buffsPanel.innerHTML = `
    <div class="buff-item">
      <label>
        <input type="checkbox" data-role="buff-toggle" data-buff="porkPie" ${buffs.porkPie.enabled ? 'checked' : ''} autocomplete="off" />
        Pork Pie
      </label>
      <select data-role="buff-option" data-buff="porkPie" ${buffs.porkPie.enabled ? '' : 'disabled'} autocomplete="off">
        ${PORK_PIE_TIERS.map((t) => `<option value="${t}" ${t === buffs.porkPie.tier ? 'selected' : ''}>${t} (${PORK_PIE_MULTIPLIER[t]}x)</option>`).join('')}
      </select>
    </div>
    <div class="buff-item">
      <label>
        <input type="checkbox" data-role="buff-toggle" data-buff="premium" ${buffs.premium.enabled ? 'checked' : ''} autocomplete="off" />
        Premium (1.5x)
      </label>
    </div>
    <div class="buff-item">
      <label>
        <input type="checkbox" data-role="buff-toggle" data-buff="learningPoints" ${buffs.learningPoints.enabled ? 'checked' : ''} autocomplete="off" />
        Learning Points
      </label>
      <select data-role="buff-option" data-buff="learningPoints" ${buffs.learningPoints.enabled ? '' : 'disabled'} autocomplete="off">
        ${Array.from({ length: LEARNING_POINTS_MAX_NODES }, (_, i) => i + 1).map((n) => `<option value="${n}" ${n === buffs.learningPoints.nodes ? 'selected' : ''}>${n} node${n > 1 ? 's' : ''}</option>`).join('')}
      </select>
    </div>
  `;
}

els.buffsPanel.addEventListener('change', (e) => {
  const buffName = e.target.dataset.buff;
  if (!buffName) return;
  if (e.target.dataset.role === 'buff-toggle') {
    buffs[buffName].enabled = e.target.checked;
    renderAll();
  } else if (e.target.dataset.role === 'buff-option') {
    if (buffName === 'porkPie') buffs.porkPie.tier = e.target.value;
    else if (buffName === 'learningPoints') buffs.learningPoints.nodes = Number(e.target.value);
    renderAll();
  }
});

// --- chart ---------------------------------------------------------------

function renderChart() {
  const seriesList = entries.map((entry) => {
    const def = ZONES[entry.zoneId];
    return {
      name: entryLabel(entry),
      color: colorOf(entry.zoneId),
      group: def.group,
      shape: entry.shape,
      sweep: computeZoneSweep(resolvedZoneDef(entry.zoneId, entry), entry.quality, entry.assumptions, currentBuffMultiplier()),
    };
  });

  if (selectedZoneId) {
    const def = ZONES[selectedZoneId];
    const s = zoneState[selectedZoneId];
    const previewShape = MARKER_SHAPES[entriesFor(selectedZoneId).length % MARKER_SHAPES.length];
    seriesList.push({
      name: `${def.name}${variantSuffix(def, s)} (previewing)`,
      color: colorOf(selectedZoneId),
      group: def.group,
      shape: previewShape,
      preview: true,
      sweep: computeZoneSweep(resolvedZoneDef(selectedZoneId, s), s.quality, s.assumptions, currentBuffMultiplier()),
    });
  }

  renderLineChart(els.chart, seriesList);

  els.legend.innerHTML = seriesList
    .map((s) => `<span class="legend-item${s.preview ? ' preview' : ''}">${markerIconSvg(s.shape, s.color)}${s.name}</span>`)
    .join('');
}

// --- marker/symbol key ----------------------------------------------------

function renderMarkerKey() {
  const tierRow = Object.entries(TIER_FILL)
    .map(([tier, color]) => `<span class="marker-key-item">${markerIconSvg('circle', color, '#999')}${tier}</span>`)
    .join('');
  const shapeRow = MARKER_SHAPES
    .map((shape, i) => `<span class="marker-key-item">${markerIconSvg(shape, '#999')}${i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`} add of a zone</span>`)
    .join('');
  els.markerKey.innerHTML = `
    <h3>Marker key</h3>
    <div class="marker-key-row">${tierRow}</div>
    <div class="marker-key-row">${shapeRow}</div>
    <div class="marker-key-row"><span class="marker-key-item"><svg width="20" height="10"><line x1="0" y1="5" x2="20" y2="5" stroke="#888" stroke-width="2.5" stroke-dasharray="5 4" /></svg>Dashed = previewing, not yet added</span></div>
  `;
}

// --- top-level render ------------------------------------------------------

function renderAll() {
  renderZoneList();
  renderZonePanels();
  renderAddedList();
  renderChart();
  renderMarkerKey();
  renderBuffsPanel();
}

renderAll();

// Chromium restores checkbox/select state left over from a prior load on
// reload/back-forward, sometimes after this module has already run. Since
// our own state object is the source of truth here (not the DOM), just
// re-render from it once more after load to override any such restoration.
window.addEventListener('load', renderAll);
window.addEventListener('pageshow', renderAll);
