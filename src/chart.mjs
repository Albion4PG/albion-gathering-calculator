// Minimal dependency-free SVG line chart for the fame/hour-vs-threshold plot.
// Categorical x-axis: each distinct famevalue across all series gets one
// slot, in ascending order. A series only draws through the slots that
// belong to its own zone's real threshold range — no padding/interpolation
// into slots it has no data for (per spec Section 1/4).

const MARGIN = { top: 20, right: 24, bottom: 76, left: 84 };

// One entry per zone (11 total) so each zone gets a fixed, unique color
// regardless of which other zones are checked -- not reassigned by
// check-order, so a zone's color stays recognizable across sessions. Used
// for the connecting line (zone identity) and the legend swatch.
export const SERIES_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#4f46e5', '#ea580c',
  '#0d9488',
];

// Marker fill = Albion's own tier-color convention. Marker edge = zone
// category (Outlands/Roads called out explicitly; Royal gets a neutral
// edge so T8's white fill still shows up against the white chart background).
const TIER_FILL = { T4: '#4887B0', T5: '#B73C38', T6: '#E48435', T7: '#E5BF3B', T8: '#FFFFFF' };
const GROUP_EDGE = { outlands: '#000000', roads: '#808080', royal: '#94a3b8' };

// Marker shape = which "add" of the same zone this series is (1st, 2nd, ...),
// so two entries for the same zone (e.g. compared under different
// assumptions) stay visually distinguishable even though they share a color.
export const MARKER_SHAPES = ['circle', 'square', 'triangle', 'diamond'];

/** SVG markup for one point marker of the given shape, centered at (cx, cy). */
export function shapeMarkup(shape, cx, cy, r, fill, stroke, strokeWidth, titleText) {
  const title = titleText ? `<title>${titleText}</title>` : '';
  switch (shape) {
    case 'square': {
      const half = r * 0.85;
      return `<rect x="${cx - half}" y="${cy - half}" width="${half * 2}" height="${half * 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}">${title}</rect>`;
    }
    case 'triangle': {
      const rr = r * 1.15;
      const pts = [0, 120, 240]
        .map((deg) => {
          const rad = (Math.PI / 180) * (deg - 90);
          return `${cx + rr * Math.cos(rad)},${cy + rr * Math.sin(rad)}`;
        })
        .join(' ');
      return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}">${title}</polygon>`;
    }
    case 'diamond': {
      const pts = [`${cx},${cy - r}`, `${cx + r},${cy}`, `${cx},${cy + r}`, `${cx - r},${cy}`].join(' ');
      return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}">${title}</polygon>`;
    }
    case 'circle':
    default:
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}">${title}</circle>`;
  }
}

/** Small standalone <svg> icon of one shape, for use in legends/lists outside the main chart. */
export function markerIconSvg(shape, fill, stroke = '#333', size = 14) {
  const r = size * 0.32;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex:none">${shapeMarkup(shape, size / 2, size / 2, r, fill, stroke, 1.5)}</svg>`;
}

/**
 * @param {SVGSVGElement} svgEl - target <svg>, must already have width/height set via viewBox
 * @param {Array<{name:string, color:string, group:string, sweep:Array<{tau:number,label:string,tier:string,famePerHour:number}>}>} seriesList
 */
export function renderLineChart(svgEl, seriesList) {
  const vb = svgEl.viewBox.baseVal;
  const width = vb.width || 800;
  const height = vb.height || 420;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;

  if (seriesList.length === 0 || seriesList.every((s) => s.sweep.length === 0)) {
    svgEl.innerHTML = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#888">No zones selected</text>`;
    return;
  }

  // Union of distinct taus across all series, ascending -> categorical slots.
  const tauLabel = new Map();
  seriesList.forEach((s) => s.sweep.forEach((p) => {
    if (!tauLabel.has(p.tau)) tauLabel.set(p.tau, p.label);
  }));
  const taus = [...tauLabel.keys()].sort((a, b) => a - b);
  const xSlot = new Map(taus.map((t, i) => [t, i]));
  const xFor = (tau) => MARGIN.left + (taus.length === 1 ? plotW / 2 : (xSlot.get(tau) / (taus.length - 1)) * plotW);

  const maxFame = Math.max(...seriesList.flatMap((s) => s.sweep.map((p) => p.famePerHour)), 1);
  const yMax = niceCeil(maxFame * 1.08);
  const yFor = (fame) => MARGIN.top + plotH - (fame / yMax) * plotH;

  const yTicks = 5;
  const gridLines = [];
  const yLabels = [];
  for (let i = 0; i <= yTicks; i++) {
    const val = (yMax / yTicks) * i;
    const y = yFor(val);
    gridLines.push(`<line x1="${MARGIN.left}" y1="${y}" x2="${width - MARGIN.right}" y2="${y}" class="gridline" />`);
    yLabels.push(`<text x="${MARGIN.left - 8}" y="${y + 4}" text-anchor="end" class="axis-label">${formatFame(val)}</text>`);
  }

  const xLabels = taus.map((tau) => {
    const x = xFor(tau);
    return `<text x="${x}" y="${height - MARGIN.bottom + 16}" text-anchor="end" class="axis-label" transform="rotate(-40 ${x} ${height - MARGIN.bottom + 16})">${escapeXml(tauLabel.get(tau))}</text>`;
  });

  const seriesSvg = seriesList.map((s, i) => {
    if (s.sweep.length === 0) return '';
    const color = s.color || SERIES_COLORS[i % SERIES_COLORS.length];
    const edge = GROUP_EDGE[s.group] || '#333';
    const shape = s.shape || 'circle';
    const pts = s.sweep.map((p) => `${xFor(p.tau)},${yFor(p.famePerHour)}`).join(' ');
    const dots = s.sweep
      .map((p) => {
        const fill = TIER_FILL[p.tier] || color;
        const title = `${escapeXml(s.name)} — ${escapeXml(p.label)}: ${Math.round(p.famePerHour).toLocaleString()} fame/hr`;
        return shapeMarkup(shape, xFor(p.tau), yFor(p.famePerHour), 6, fill, edge, 2, title);
      })
      .join('');
    // "preview" series (a not-yet-added zone being configured) render dashed
    // and faded so they read as tentative, distinct from committed entries.
    const dash = s.preview ? ' stroke-dasharray="7 5"' : '';
    const groupOpacity = s.preview ? ' opacity="0.55"' : '';
    return `<g${groupOpacity}><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3.5"${dash} />${dots}</g>`;
  }).join('');

  svgEl.innerHTML = `
    <g>${gridLines.join('')}</g>
    <line x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${height - MARGIN.bottom}" class="axis-line" />
    <line x1="${MARGIN.left}" y1="${height - MARGIN.bottom}" x2="${width - MARGIN.right}" y2="${height - MARGIN.bottom}" class="axis-line" />
    <g>${yLabels.join('')}</g>
    <g>${xLabels.join('')}</g>
    <text x="${MARGIN.left - 56}" y="${MARGIN.top + plotH / 2}" text-anchor="middle" class="axis-title" transform="rotate(-90 ${MARGIN.left - 56} ${MARGIN.top + plotH / 2})">Fame / hour</text>
    <text x="${MARGIN.left + plotW / 2}" y="${height - 4}" text-anchor="middle" class="axis-title">Filter threshold (tier.enchant)</text>
    ${seriesSvg}
  `;
}

function niceCeil(v) {
  if (v <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / magnitude;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return niceNorm * magnitude;
}

function formatFame(v) {
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return Math.round(v).toString();
}

function escapeXml(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
