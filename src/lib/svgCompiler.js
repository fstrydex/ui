export const CANVAS_SIZE_MM = 304.8;
export const HARD_MARGIN_MM = 15.0;
export const MAX_PHOTO_AREA_PCT = 50.0;

export function getOuterDims(obj) {
  if (obj.type === 'photo_mat') {
    return {
      w: Number(obj.photo_width) + 10,
      h: Number(obj.photo_height) + 10,
    };
  }
  if (obj.type === 'washi_tape') {
    return {
      w: Number(obj.width_mm) || 48,
      h: Number(obj.height_mm) || 12,
    };
  }
  return {
    w: Number(obj.width_mm) || 50,
    h: Number(obj.height_mm) || 35,
  };
}

export function clampToMargin(obj) {
  const { w: outerW, h: outerH } = getOuterDims(obj);
  const minX = HARD_MARGIN_MM + outerW / 2;
  const maxX = CANVAS_SIZE_MM - HARD_MARGIN_MM - outerW / 2;
  const minY = HARD_MARGIN_MM + outerH / 2;
  const maxY = CANVAS_SIZE_MM - HARD_MARGIN_MM - outerH / 2;

  const rawX = Number.isFinite(obj.center_x) ? obj.center_x : CANVAS_SIZE_MM / 2;
  const rawY = Number.isFinite(obj.center_y) ? obj.center_y : CANVAS_SIZE_MM / 2;

  const clampedX = minX <= maxX ? Math.min(maxX, Math.max(minX, rawX)) : CANVAS_SIZE_MM / 2;
  const clampedY = minY <= maxY ? Math.min(maxY, Math.max(minY, rawY)) : CANVAS_SIZE_MM / 2;

  obj.center_x = Number(clampedX.toFixed(1));
  obj.center_y = Number(clampedY.toFixed(1));

  return {
    left: obj.center_x - outerW / 2,
    right: obj.center_x + outerW / 2,
    top: obj.center_y - outerH / 2,
    bottom: obj.center_y + outerH / 2,
    w: outerW,
    h: outerH,
  };
}

function escapeXml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildTornTapePath(x, y, w, h) {
  const fmt = (n) => Number(n.toFixed(2));
  return [
    `M ${fmt(x + 0.4)} ${fmt(y)}`,
    `L ${fmt(x + w - 0.3)} ${fmt(y)}`,
    `L ${fmt(x + w - 1.5)} ${fmt(y + h * 0.2)}`,
    `L ${fmt(x + w + 0.7)} ${fmt(y + h * 0.4)}`,
    `L ${fmt(x + w - 1.6)} ${fmt(y + h * 0.6)}`,
    `L ${fmt(x + w + 0.6)} ${fmt(y + h * 0.8)}`,
    `L ${fmt(x + w - 0.7)} ${fmt(y + h)}`,
    `L ${fmt(x + 0.7)} ${fmt(y + h)}`,
    `L ${fmt(x - 0.6)} ${fmt(y + h * 0.8)}`,
    `L ${fmt(x + 1.6)} ${fmt(y + h * 0.6)}`,
    `L ${fmt(x - 0.6)} ${fmt(y + h * 0.4)}`,
    `L ${fmt(x + 1.5)} ${fmt(y + h * 0.2)}`,
    'Z',
  ].join(' ');
}

function buildWashiTapeSvg(obj, x, y, outerW, outerH, cx, cy, safeId, safeLabel) {
  const primary = escapeXml(obj.primary_hex || '#9E222B');
  const secondary = escapeXml(obj.secondary_hex || '#C2B29C');
  const patternType = obj.pattern_type || 'solid';
  const tornPath = buildTornTapePath(x, y, outerW, outerH);
  const clipId = `clip_${safeId}`;
  const patId = `washi_pat_${safeId}`;

  let patternOverlay = '';
  if (patternType === 'plaid') {
    patternOverlay =
      `    <pattern id="${patId}" width="10" height="10" patternUnits="userSpaceOnUse">\n` +
      `      <rect width="10" height="10" fill="transparent" />\n` +
      `      <rect x="0" y="1.5" width="10" height="2.4" fill="${secondary}" opacity="0.58" />\n` +
      `      <rect x="1.5" y="0" width="2.4" height="10" fill="${secondary}" opacity="0.58" />\n` +
      `      <rect x="0" y="6.8" width="10" height="1.1" fill="#2b1815" opacity="0.32" />\n` +
      `      <rect x="6.8" y="0" width="1.1" height="10" fill="#2b1815" opacity="0.32" />\n` +
      `      <rect x="0" y="4.5" width="10" height="0.6" fill="#ffffff" opacity="0.25" />\n` +
      `      <rect x="4.5" y="0" width="0.6" height="10" fill="#ffffff" opacity="0.25" />\n` +
      `    </pattern>\n` +
      `    <rect class="visual-layer" x="${x - 3}" y="${y}" width="${outerW + 6}" height="${outerH}" fill="url(#${patId})" clip-path="url(#${clipId})" />\n`;
  } else if (patternType === 'striped') {
    patternOverlay =
      `    <pattern id="${patId}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">\n` +
      `      <rect x="0" y="0" width="2.5" height="6" fill="${secondary}" opacity="0.55" />\n` +
      `    </pattern>\n` +
      `    <rect class="visual-layer" x="${x - 3}" y="${y}" width="${outerW + 6}" height="${outerH}" fill="url(#${patId})" clip-path="url(#${clipId})" />\n`;
  } else if (patternType === 'speckled' || patternType === 'polka') {
    patternOverlay =
      `    <pattern id="${patId}" width="8" height="8" patternUnits="userSpaceOnUse">\n` +
      `      <circle cx="2" cy="2.5" r="0.9" fill="${secondary}" opacity="0.65" />\n` +
      `      <circle cx="6" cy="6" r="0.7" fill="${secondary}" opacity="0.55" />\n` +
      `    </pattern>\n` +
      `    <rect class="visual-layer" x="${x - 3}" y="${y}" width="${outerW + 6}" height="${outerH}" fill="url(#${patId})" clip-path="url(#${clipId})" />\n`;
  }

  return (
    `    <defs><clipPath id="${clipId}"><path d="${tornPath}" /></clipPath></defs>\n` +
    `    <path class="visual-layer" d="${tornPath}" fill="${primary}" fill-opacity="0.88" filter="url(#dropShadow)" />\n` +
    patternOverlay +
    `    <path class="visual-layer" d="${tornPath}" fill="none" stroke="#ffffff" stroke-opacity="0.24" stroke-width="0.35" />\n` +
    `    <rect class="blueprint-layer" x="${x}" y="${y}" width="${outerW}" height="${outerH}" fill="${primary}26" stroke="#38bdf8" stroke-dasharray="2.5,1.5" stroke-width="0.9" />\n` +
    `    <text class="blueprint-layer" x="${cx}" y="${cy}" fill="#bae6fd" stroke="#000" stroke-width="0.25" font-family="sans-serif" font-size="4.6" font-weight="bold" text-anchor="middle" dominant-baseline="middle">TAPE: ${safeLabel} (${Math.round(outerW)}mm)</text>\n`
  );
}

function buildObjectControlsSvg(safeId, cx, x, y, outerW, outerH, objType) {
  const rx = x + outerW;
  const midY = y + outerH / 2;

  const tapeHandles =
    objType === 'washi_tape'
      ? `      <rect x="${x - 8}" y="${y - 2}" width="11" height="${outerH + 4}" fill="transparent" />\n` +
        `      <rect x="${rx - 3}" y="${y - 2}" width="11" height="${outerH + 4}" fill="transparent" />\n` +
        `      <g data-resize-tape="${safeId}" data-resize-side="left" style="cursor: ew-resize;">\n` +
        `        <rect x="${x - 3.4}" y="${midY - 4.8}" width="6.2" height="9.6" rx="1.8" fill="#18181b" stroke="#fbbf24" stroke-width="1" />\n` +
        `        <path d="M ${x + 0.5} ${midY - 2} L ${x - 1.5} ${midY} L ${x + 0.5} ${midY + 2}" fill="none" stroke="#fde68a" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" />\n` +
        `      </g>\n` +
        `      <g data-resize-tape="${safeId}" data-resize-side="right" style="cursor: ew-resize;">\n` +
        `        <rect x="${rx - 2.8}" y="${midY - 4.8}" width="6.2" height="9.6" rx="1.8" fill="#18181b" stroke="#fbbf24" stroke-width="1" />\n` +
        `        <path d="M ${rx - 0.5} ${midY - 2} L ${rx + 1.5} ${midY} L ${rx - 0.5} ${midY + 2}" fill="none" stroke="#fde68a" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" />\n` +
        `      </g>\n`
      : '';

  return (
    `    <g class="object-controls">\n` +
    `      <rect x="${x - 6}" y="${y - 16}" width="${outerW + 12}" height="17" fill="transparent" />\n` +
    tapeHandles +
    `      <g data-rotate-handle="${safeId}" style="cursor: grab;">\n` +
    `        <line x1="${cx}" y1="${y}" x2="${cx}" y2="${y - 9}" stroke="#60a5fa" stroke-width="1" />\n` +
    `        <circle cx="${cx}" cy="${y - 9}" r="5.5" fill="#18181b" stroke="#60a5fa" stroke-width="1.2" />\n` +
    `        <path d="M ${cx - 2.2} ${y - 9.8} A 2.6 2.6 0 1 1 ${cx - 0.5} ${y - 6.5}" fill="none" stroke="#93c5fd" stroke-width="1.1" stroke-linecap="round" />\n` +
    `        <polygon points="${cx - 2.8},${y - 11.2} ${cx - 3.2},${y - 8.3} ${cx - 0.8},${y - 9.5}" fill="#93c5fd" />\n` +
    `      </g>\n` +
    `      <g data-remove-object="${safeId}" style="cursor: pointer;">\n` +
    `        <circle cx="${rx}" cy="${y}" r="5.5" fill="#dc2626" stroke="#ffffff" stroke-width="1" />\n` +
    `        <path d="M ${rx - 2} ${y - 2} L ${rx + 2} ${y + 2} M ${rx + 2} ${y - 2} L ${rx - 2} ${y + 2}" stroke="#ffffff" stroke-width="1.3" stroke-linecap="round" />\n` +
    `      </g>\n` +
    `    </g>\n`
  );
}

export function compileLayoutToSvg(layout, defaultMatHex = '#F2EFE4') {
  const objects = Array.isArray(layout?.objects) ? layout.objects : [];
  objects.forEach((obj) => clampToMargin(obj));

  const bgHex = layout?.layout?.base_color || '#24344D';
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_SIZE_MM} ${CANVAS_SIZE_MM}" width="100%" height="100%">\n`;
  svg += `  <defs><filter id="dropShadow" x="-15%" y="-15%" width="130%" height="130%"><feDropShadow dx="1.2" dy="1.8" stdDeviation="1.6" flood-opacity="0.45"/></filter></defs>\n`;
  svg += `  <rect id="canvasBaseBg" data-paper-hex="${escapeXml(bgHex)}" x="0" y="0" width="${CANVAS_SIZE_MM}" height="${CANVAS_SIZE_MM}" fill="${bgHex}" stroke="#333" stroke-width="1"/>\n`;
  svg += `  <rect class="blueprint-guide" x="${HARD_MARGIN_MM}" y="${HARD_MARGIN_MM}" width="${CANVAS_SIZE_MM - HARD_MARGIN_MM * 2}" height="${CANVAS_SIZE_MM - HARD_MARGIN_MM * 2}" fill="none" stroke="#ffffff55" stroke-dasharray="4,4" stroke-width="0.6"/>\n`;

  const sortedObjects = [...objects].sort((a, b) => (a.z_index || 1) - (b.z_index || 1));

  sortedObjects.forEach((obj) => {
    const { w: outerW, h: outerH } = getOuterDims(obj);
    const cx = obj.center_x;
    const cy = obj.center_y;
    const rotation = obj.rotation_degrees || 0;
    const x = cx - outerW / 2;
    const y = cy - outerH / 2;
    const safeId = escapeXml(obj.id);
    const safeLabel = escapeXml(obj.label || obj.id);

    svg += `  <g id="${safeId}" data-draggable="true" transform="rotate(${rotation} ${cx} ${cy})" style="cursor: grab;">\n`;

    if (obj.type === 'cut_svg') {
      svg += `    <rect x="${x}" y="${y}" width="${outerW}" height="${outerH}" fill="transparent" />\n`;
      svg += `    <svg x="${x}" y="${y}" width="${outerW}" height="${outerH}" viewBox="0 0 100 100" filter="url(#dropShadow)">__VECTOR_SVG_${obj.id}__</svg>\n`;
      svg += `    <rect class="blueprint-layer" x="${x}" y="${y}" width="${outerW}" height="${outerH}" fill="none" stroke="#ef4444" stroke-dasharray="2,2" stroke-width="0.9"/>\n`;
      svg += `    <text class="blueprint-layer" x="${cx}" y="${y - 3}" fill="#fca5a5" font-family="sans-serif" font-size="5.5" font-weight="bold" text-anchor="middle">CUT SVG: ${safeLabel}</text>\n`;
    } else if (obj.type === 'washi_tape') {
      svg += buildWashiTapeSvg(obj, x, y, outerW, outerH, cx, cy, safeId, safeLabel);
    } else if (obj.type === 'sticker') {
      svg += `    <rect x="${x}" y="${y}" width="${outerW}" height="${outerH}" fill="transparent" />\n`;
      svg += `    <image class="visual-layer" href="__STICKER_DATA_${obj.id}__" x="${x}" y="${y}" width="${outerW}" height="${outerH}" preserveAspectRatio="xMidYMid meet" filter="url(#dropShadow)" />\n`;
      svg += `    <rect class="blueprint-layer" x="${x}" y="${y}" width="${outerW}" height="${outerH}" fill="#f59e0b22" stroke="#f59e0b" stroke-dasharray="3,2" stroke-width="1.2" rx="2"/>\n`;
      svg += `    <text class="blueprint-layer" x="${cx}" y="${cy}" fill="#fef3c7" stroke="#000" stroke-width="0.3" font-family="sans-serif" font-size="6.5" font-weight="bold" text-anchor="middle" dominant-baseline="middle">STICKER: ${safeLabel}</text>\n`;
    } else {
      const innerW = obj.photo_width - 5;
      const innerH = obj.photo_height - 5;
      const innerX = cx - innerW / 2;
      const innerY = cy - innerH / 2;
      const matColor = obj.mat_color || defaultMatHex;

      svg += `    <rect class="photo-mat-rect" data-paper-hex="${escapeXml(matColor)}" x="${x}" y="${y}" width="${outerW}" height="${outerH}" fill="${matColor}" stroke="#ef4444" stroke-width="1.2" filter="url(#dropShadow)" />\n`;
      svg += `    <rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" fill="#18181b" stroke="#22c55e" stroke-width="0.9" />\n`;
      svg += `    <image class="visual-layer" href="__PHOTO_DATA_${obj.id}__" x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" preserveAspectRatio="xMidYMid slice" />\n`;
      svg += `    <circle class="blueprint-layer" cx="${cx}" cy="${cy}" r="9" fill="#000000aa" />\n`;
      svg += `    <text class="blueprint-layer" x="${cx}" y="${cy}" fill="white" font-family="sans-serif" font-size="10" font-weight="bold" text-anchor="middle" dominant-baseline="middle" transform="rotate(${-rotation} ${cx} ${cy})">Photo #${obj.display_number || 1}</text>\n`;
    }

    svg += buildObjectControlsSvg(safeId, cx, x, y, outerW, outerH, obj.type);
    svg += `  </g>\n`;
  });

  svg += `</svg>`;
  return svg;
}

export function injectAssetsIntoSvg(rawSvg, photos = [], cutouts = [], viewMode = 'visual', papers = []) {
  if (!rawSvg) return '';
  let finalSvg = rawSvg;

  photos.forEach((p) => {
    if (p.dataUrl) {
      finalSvg = finalSvg.replaceAll(`__PHOTO_DATA_${p.id}__`, p.dataUrl);
    } else {
      finalSvg = finalSvg.replaceAll(`href="__PHOTO_DATA_${p.id}__"`, `href="" display="none"`);
    }
  });

  cutouts.forEach((c) => {
    if (c.item_type === 'washi_tape') return;
    const tokenKey = c.id;
    if (c.item_type === 'cut_svg') {
      finalSvg = finalSvg.replaceAll(`__VECTOR_SVG_${tokenKey}__`, c.svgInner || '');
    } else {
      finalSvg = finalSvg.replaceAll(`__STICKER_DATA_${tokenKey}__`, c.cropUrl || '');
    }
  });

  let paperPatternDefs = '';
  let paperPatternCss = '';
  if (viewMode === 'visual' && Array.isArray(papers) && papers.length > 0) {
    papers.forEach((paper, idx) => {
      const hasTexture =
        paper.swatchUrl &&
        ['plaid', 'speckled', 'striped', 'floral', 'patterned'].includes(paper.pattern_type);
      if (!hasTexture || !paper.hex) return;
      const patId = `paper_swatch_${idx}`;
      const sizeMm = paper.pattern_type === 'plaid' ? 68 : 80;
      paperPatternDefs += `<pattern id="${patId}" width="${sizeMm}" height="${sizeMm}" patternUnits="userSpaceOnUse"><image href="${paper.swatchUrl}" width="${sizeMm}" height="${sizeMm}" preserveAspectRatio="xMidYMid slice" /></pattern>`;
      paperPatternCss += ` [data-paper-hex="${paper.hex}" i] { fill: url(#${patId}); }`;
    });
  }

  const controlsCss = `.object-controls { opacity: 0; pointer-events: none; transition: opacity 0.12s ease-in-out; } g[data-draggable="true"]:hover .object-controls { opacity: 1; pointer-events: all; }`;
  const modeCss =
    viewMode === 'visual'
      ? `<style>.blueprint-layer { display: none; } ${paperPatternCss} ${controlsCss}</style>`
      : `<style>.visual-layer { opacity: 0.18; } .blueprint-layer { display: inline; } ${controlsCss}</style>`;

  return finalSvg.replace('</defs>', `${paperPatternDefs}</defs>${modeCss}`);
}

export function upsertCutoutInLayout({
  currentLayoutObj,
  item,
  xMm,
  yMm,
  photos = [],
  baseColor = '#24344D',
  defaultMatHex = '#F2EFE4',
}) {
  const baseObjects = currentLayoutObj?.objects
    ? [...currentLayoutObj.objects]
    : photos.map((p, idx) => {
        const obj = {
          id: p.id,
          type: 'photo_mat',
          photo_width: Number((p.w_in * 25.4).toFixed(1)),
          photo_height: Number((p.h_in * 25.4).toFixed(1)),
          display_number: idx + 1,
          center_x: idx % 2 === 0 ? 95 : 205,
          center_y: 115 + Math.floor(idx / 2) * 100,
          rotation_degrees: idx % 2 === 0 ? -2 : 2,
          z_index: 1,
          mat_color: defaultMatHex,
        };
        clampToMargin(obj);
        return obj;
      });

  const isWashi = item.item_type === 'washi_tape';
  const exists = !isWashi && baseObjects.some((o) => o.id === item.id);

  let objects;
  if (exists) {
    objects = baseObjects.map((o) => {
      if (o.id !== item.id) return o;
      const moved = { ...o, center_x: xMm, center_y: yMm };
      clampToMargin(moved);
      return moved;
    });
  } else {
    const newId = isWashi
      ? baseObjects.some((o) => o.id === item.id)
        ? `${item.id}_strip_${Date.now().toString(36).slice(-4)}`
        : item.id
      : item.id;

    const added = isWashi
      ? {
          id: newId,
          source_id: item.source_id || item.id,
          type: 'washi_tape',
          label: item.label,
          color_name: item.color_name || item.label,
          primary_hex: item.primary_hex || '#9E222B',
          secondary_hex: item.secondary_hex || '#C2B29C',
          pattern_type: item.pattern_type || 'solid',
          width_mm: item.width_mm || 48,
          height_mm: item.height_mm || 12,
          center_x: xMm,
          center_y: yMm,
          rotation_degrees: -35,
          z_index: 14,
        }
      : {
          id: newId,
          type: item.item_type === 'cut_svg' ? 'cut_svg' : 'sticker',
          label: item.label,
          width_mm: item.width_mm || 50,
          height_mm: item.height_mm || 50,
          center_x: xMm,
          center_y: yMm,
          rotation_degrees: 0,
          z_index: 10,
        };
    clampToMargin(added);
    objects = [...baseObjects, added];
  }

  return {
    layout: {
      canvas_width: CANVAS_SIZE_MM,
      canvas_height: CANVAS_SIZE_MM,
      unit: 'mm',
      base_color: currentLayoutObj?.layout?.base_color || baseColor,
    },
    objects,
  };
}
