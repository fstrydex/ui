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

export function compileLayoutToSvg(layout, defaultMatHex = '#F2EFE4') {
  const objects = Array.isArray(layout?.objects) ? layout.objects : [];
  objects.forEach((obj) => clampToMargin(obj));

  const bgHex = layout?.layout?.base_color || '#24344D';
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_SIZE_MM} ${CANVAS_SIZE_MM}" width="100%" height="100%">\n`;
  svg += `  <defs><filter id="dropShadow" x="-15%" y="-15%" width="130%" height="130%"><feDropShadow dx="1.2" dy="1.8" stdDeviation="1.6" flood-opacity="0.45"/></filter></defs>\n`;
  svg += `  <rect x="0" y="0" width="${CANVAS_SIZE_MM}" height="${CANVAS_SIZE_MM}" fill="${bgHex}" stroke="#333" stroke-width="1"/>\n`;
  svg += `  <rect class="blueprint-guide" x="${HARD_MARGIN_MM}" y="${HARD_MARGIN_MM}" width="${CANVAS_SIZE_MM - HARD_MARGIN_MM * 2}" height="${CANVAS_SIZE_MM - HARD_MARGIN_MM * 2}" fill="none" stroke="#ffffff55" stroke-dasharray="4,4" stroke-width="0.6"/>\n`;

  const sortedObjects = [...objects].sort((a, b) => (a.z_index || 1) - (b.z_index || 1));

  sortedObjects.forEach((obj) => {
    const { w: outerW, h: outerH } = getOuterDims(obj);
    const cx = obj.center_x;
    const cy = obj.center_y;
    const rotation = obj.rotation_degrees || 0;
    const x = cx - outerW / 2;
    const y = cy - outerH / 2;
    const safeLabel = escapeXml(obj.label || obj.id);

    svg += `  <g id="${escapeXml(obj.id)}" data-draggable="true" transform="rotate(${rotation} ${cx} ${cy})" style="cursor: grab;">\n`;

    if (obj.type === 'cut_svg') {
      svg += `    <rect x="${x}" y="${y}" width="${outerW}" height="${outerH}" fill="transparent" />\n`;
      svg += `    <svg x="${x}" y="${y}" width="${outerW}" height="${outerH}" viewBox="0 0 100 100" filter="url(#dropShadow)">__VECTOR_SVG_${obj.id}__</svg>\n`;
      svg += `    <rect class="blueprint-layer" x="${x}" y="${y}" width="${outerW}" height="${outerH}" fill="none" stroke="#ef4444" stroke-dasharray="2,2" stroke-width="0.9"/>\n`;
      svg += `    <text class="blueprint-layer" x="${cx}" y="${y - 3}" fill="#fca5a5" font-family="sans-serif" font-size="5.5" font-weight="bold" text-anchor="middle">CUT SVG: ${safeLabel}</text>\n`;
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

      svg += `    <rect x="${x}" y="${y}" width="${outerW}" height="${outerH}" fill="${matColor}" stroke="#ef4444" stroke-width="1.2" filter="url(#dropShadow)" />\n`;
      svg += `    <rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" fill="#18181b" stroke="#22c55e" stroke-width="0.9" />\n`;
      svg += `    <image class="visual-layer" href="__PHOTO_DATA_${obj.id}__" x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" preserveAspectRatio="xMidYMid slice" />\n`;
      svg += `    <circle class="blueprint-layer" cx="${cx}" cy="${cy}" r="9" fill="#000000aa" />\n`;
      svg += `    <text class="blueprint-layer" x="${cx}" y="${cy}" fill="white" font-family="sans-serif" font-size="10" font-weight="bold" text-anchor="middle" dominant-baseline="middle" transform="rotate(${-rotation} ${cx} ${cy})">Photo #${obj.display_number || 1}</text>\n`;
    }

    svg += `  </g>\n`;
  });

  svg += `</svg>`;
  return svg;
}

export function injectAssetsIntoSvg(rawSvg, photos = [], cutouts = [], viewMode = 'visual') {
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
    if (c.item_type === 'cut_svg') {
      finalSvg = finalSvg.replaceAll(`__VECTOR_SVG_${c.id}__`, c.svgInner || '');
    } else {
      finalSvg = finalSvg.replaceAll(`__STICKER_DATA_${c.id}__`, c.cropUrl || '');
    }
  });

  const modeCss =
    viewMode === 'visual'
      ? `<style>.blueprint-layer { display: none; }</style>`
      : `<style>.visual-layer { opacity: 0.18; } .blueprint-layer { display: inline; }</style>`;

  return finalSvg.replace('</defs>', `</defs>${modeCss}`);
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

  const exists = baseObjects.some((o) => o.id === item.id);
  const objects = exists
    ? baseObjects.map((o) => {
        if (o.id !== item.id) return o;
        const moved = { ...o, center_x: xMm, center_y: yMm };
        clampToMargin(moved);
        return moved;
      })
    : [
        ...baseObjects,
        (() => {
          const added = {
            id: item.id,
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
          return added;
        })(),
      ];

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
