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
  PORK_PIE_TIERS, PORK_PIE_YIELD, LEARNING_POINTS_MAX_NODES, TOOL_TIERS,
  GATHERING_YIELD, GEAR_TIERS, GEAR_PIECES, NODE_TIERS,
  defaultBuffs, combinedBuffMultiplier, yieldBonusByTier,
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

// Universal buffs (Pork Pie / Premium / Learning Points, plus the Avalonian
// tool and gathering gear): one global state applied to every entry's
// fame_amount, current and future -- not snapshotted per zone/entry, so
// toggling one instantly re-scales the whole chart. Pork Pie, tool and gear
// are summed gathering yield (per node tier); Premium and Learning Points
// are tier-independent multipliers. All default off.
let buffs = defaultBuffs();
function currentBuffMultiplier() {
  return combinedBuffMultiplier(buffs);
}
function currentYieldBonus() {
  return yieldBonusByTier(buffs);
}
function tierAboveExclusions() {
  return { noStaticTierAbove: buffs.noStaticTierAbove, noMobTierAbove: buffs.noMobTierAbove };
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
        <div class="zone-row ${isSelected ? 'checked' : ''}" data-zone="${id}" data-role="select" role="button" tabindex="0" aria-pressed="${isSelected}">
          <span class="swatch" style="background:${colorOf(id)}"></span>
          <span class="name">${def.name}</span>
          ${qualitySelect}${roadTypeSelect}
        </div>`;
    }).join('');
    return `<div class="zone-group"><h3 class="zone-group-title">${GROUP_LABELS[group]}</h3>${rows}</div>`;
  }).join('');
}

// Each zone row is itself a single-select toggle (only one zone staged at a
// time): clicking an unselected row stages it (and un-stages whichever was
// staged before, on re-render); clicking the already-selected row clears
// staging/preview entirely. No checkbox involved -- the row's own
// highlighted state (.checked) is the only "on" indicator.
function toggleZoneSelection(zoneId) {
  selectedZoneId = selectedZoneId === zoneId ? null : zoneId;
  renderAll();
}

els.zoneList.addEventListener('click', (e) => {
  if (e.target.closest('select')) return; // let the quality/road-type dropdown handle its own click
  const row = e.target.closest('[data-role="select"]');
  if (!row) return;
  toggleZoneSelection(row.dataset.zone);
});

els.zoneList.addEventListener('keydown', (e) => {
  if (e.target.closest('select')) return;
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('[data-role="select"]');
  if (!row) return;
  e.preventDefault(); // stop the page from scrolling on Space
  toggleZoneSelection(row.dataset.zone);
});

els.zoneList.addEventListener('change', (e) => {
  const zoneId = e.target.dataset.zone;
  if (!zoneId) return;
  if (e.target.dataset.role === 'quality') {
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
  const sweep = computeZoneSweep(resolvedZoneDef(id, s), s.quality, a, currentBuffMultiplier(), buffs.toolTier, tierAboveExclusions(), currentYieldBonus());

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
  const sweep = computeZoneSweep(resolvedZoneDef(zoneId, s), s.quality, s.assumptions, currentBuffMultiplier(), buffs.toolTier, tierAboveExclusions(), currentYieldBonus());
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
  const equippedGear = GEAR_PIECES.filter((piece) => buffs.gatheringGear.equipped[piece]);
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
    tool_tier: buffs.toolTier,
    no_static_tier_above: buffs.noStaticTierAbove,
    no_mob_tier_above: buffs.noMobTierAbove,
    avalonian_tool: buffs.avalonianTool,
    gear_tier: equippedGear.length ? buffs.gatheringGear.tier : 'off',
    gear_pieces: equippedGear.length ? equippedGear.join('+') : 'none',
  });
}

// --- universal buffs -------------------------------------------------------

function renderBuffsPanel() {
  els.buffsPanel.innerHTML = `
    <div class="buff-item">
      <label>
        <input type="checkbox" data-role="buff-toggle" data-buff="porkPie" ${buffs.porkPie.enabled ? 'checked' : ''} autocomplete="off" />
        Pork Pie ${infoIcon('Counts as gathering yield on every node tier: it adds to your Avalonian tool and gear bonuses (see “Yield bonus” below) rather than multiplying fame separately.')}
      </label>
      <select data-role="buff-option" data-buff="porkPie" ${buffs.porkPie.enabled ? '' : 'disabled'} autocomplete="off">
        ${PORK_PIE_TIERS.map((t) => `<option value="${t}" ${t === buffs.porkPie.tier ? 'selected' : ''}>${t} (+${formatPercent(PORK_PIE_YIELD[t])})</option>`).join('')}
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
    <div class="buff-item tool-tier-item">
      <label class="label-text">Tool tier ${infoIcon("Your gathering tool's tier. You can harvest any enchant level of your tool's own tier (or lower), plus the unenchanted version of the tier above it, at reduced speed. Anything higher is out of reach.")}</label>
      <select data-role="tool-tier" autocomplete="off">
        ${TOOL_TIERS.map((t) => `<option value="${t}" ${t === buffs.toolTier ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="buff-item">
      <label>
        <input type="checkbox" data-role="avalonian-toggle" ${buffs.avalonianTool ? 'checked' : ''} autocomplete="off" />
        Avalonian tool ${infoIcon('Makes your tool an Avalonian one: a flat resource-yield bonus (scaling with the tool tier above) on nodes up to that tier. Yield means more resources per node, and each extra resource earns its own fame.')}
      </label>
    </div>
    <div class="buff-item">
      <label>
        <input type="checkbox" data-role="tier-above-toggle" data-which="noStaticTierAbove" ${buffs.noStaticTierAbove ? 'checked' : ''} autocomplete="off" />
        Skip static nodes one tier above ${infoIcon('If your tool can reach the tier above (unenchanted only), this refuses the static version of it -- you’ll only take it if it’s a resource mob instead.')}
      </label>
    </div>
    <div class="buff-item">
      <label>
        <input type="checkbox" data-role="tier-above-toggle" data-which="noMobTierAbove" ${buffs.noMobTierAbove ? 'checked' : ''} autocomplete="off" />
        Skip mobs one tier above ${infoIcon('If your tool can reach the tier above (unenchanted only), this refuses the resource-mob version of it -- you’ll only take it if it’s a static node instead. Checking both boxes drops that tier entirely.')}
      </label>
    </div>
    <div class="buff-item tool-tier-item">
      <label class="label-text">Gathering gear ${infoIcon(`Tier of your gathering head/chest/feet. Each equipped piece adds a resource-yield bonus on nodes up to its tier, stacking once every ${GATHERING_YIELD.GEAR_PULSE_SECONDS}s up to ${GATHERING_YIELD.GEAR_MAX_STACKS} stacks. Modeled fully stacked (${GATHERING_YIELD.GEAR_MAX_STACKS * GATHERING_YIELD.GEAR_PULSE_SECONDS / 60} min of gathering). Yield means more resources per node, and each extra resource earns its own fame.`)}</label>
      <select data-role="gear-tier" autocomplete="off">
        ${GEAR_TIERS.map((t) => `<option value="${t}" ${t === buffs.gatheringGear.tier ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="gear-pieces">
      ${GEAR_PIECES.map((piece) => `
        <label>
          <input type="checkbox" data-role="gear-piece" data-piece="${piece}" ${buffs.gatheringGear.equipped[piece] ? 'checked' : ''} autocomplete="off" />
          ${GEAR_PIECE_LABEL[piece]}
        </label>`).join('')}
    </div>
    ${renderYieldReadout()}
  `;
}

const GEAR_PIECE_LABEL = { HEAD: 'Head', CHEST: 'Chest', FEET: 'Feet' };

// 0.175 -> "17.5%", 0.9 -> "90%": trims float noise (0.0175 * 10 = 0.17500000000000002).
function formatPercent(fraction) {
  return `${Number((fraction * 100).toFixed(2))}%`;
}

function renderYieldReadout() {
  const bonus = yieldBonusByTier(buffs);
  return `
    <div class="yield-readout">
      <div class="yield-readout-title">Yield bonus ${infoIcon('Total gathering yield by node tier: Pork Pie + Avalonian tool + gear, added together. Each extra resource earns its own fame, so fame scales by 1 + this; Premium and Learning Points multiply on top.')}</div>
      <div class="yield-grid">
        ${NODE_TIERS.map((t) => `<span class="tier">${t}</span>`).join('')}
        ${NODE_TIERS.map((t) => `<span class="val ${bonus[t] ? '' : 'zero'}">${bonus[t] ? formatPercent(bonus[t]) : '—'}</span>`).join('')}
      </div>
    </div>`;
}

els.buffsPanel.addEventListener('change', (e) => {
  if (e.target.dataset.role === 'tool-tier') {
    buffs.toolTier = e.target.value;
    renderAll();
    return;
  }
  if (e.target.dataset.role === 'tier-above-toggle') {
    buffs[e.target.dataset.which] = e.target.checked;
    renderAll();
    return;
  }
  if (e.target.dataset.role === 'avalonian-toggle') {
    buffs.avalonianTool = e.target.checked;
    renderAll();
    return;
  }
  if (e.target.dataset.role === 'gear-tier') {
    buffs.gatheringGear.tier = e.target.value;
    renderAll();
    return;
  }
  if (e.target.dataset.role === 'gear-piece') {
    buffs.gatheringGear.equipped[e.target.dataset.piece] = e.target.checked;
    renderAll();
    return;
  }

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
      sweep: computeZoneSweep(resolvedZoneDef(entry.zoneId, entry), entry.quality, entry.assumptions, currentBuffMultiplier(), buffs.toolTier, tierAboveExclusions(), currentYieldBonus()),
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
      sweep: computeZoneSweep(resolvedZoneDef(selectedZoneId, s), s.quality, s.assumptions, currentBuffMultiplier(), buffs.toolTier, tierAboveExclusions(), currentYieldBonus()),
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

// --- theme switch (auto/light/dark) ---------------------------------------
// A tiny inline script in index.html's <head> already applies any saved
// choice before first paint (avoids a flash); this just wires up the
// buttons and keeps their pressed-state in sync with the current choice.

function renderThemeSwitch() {
  const current = document.documentElement.getAttribute('data-theme') || 'auto';
  document.querySelectorAll('#themeSwitch button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.themeChoice === current));
  });
}

document.getElementById('themeSwitch').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const choice = btn.dataset.themeChoice;
  if (choice === 'auto') {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem('theme');
  } else {
    document.documentElement.setAttribute('data-theme', choice);
    localStorage.setItem('theme', choice);
  }
  renderThemeSwitch();
});

renderThemeSwitch();
