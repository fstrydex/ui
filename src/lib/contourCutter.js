function toHexByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

function rgbToHex(r, g, b) {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function normalizeHexColor(hex, fallback = '#D8C9B4') {
  if (typeof hex !== 'string') return fallback;
  const cleaned = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) return `#${cleaned.toUpperCase()}`;
  return fallback;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

function sampleMedianHexFromImageData(data, pixelCount) {
  const rs = [];
  const gs = [];
  const bs = [];
  const step = Math.max(1, Math.floor(pixelCount / 400));
  for (let i = 0; i < pixelCount; i += step) {
    const idx = i * 4;
    rs.push(data[idx]);
    gs.push(data[idx + 1]);
    bs.push(data[idx + 2]);
  }
  if (!rs.length) return '#D8C9B4';
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(rs.length / 2);
  return rgbToHex(rs[mid], gs[mid], bs[mid]);
}

export function normalizeImageDataUrl(rawFile, maxDim = 1600) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(rawFile);
  });
}

export function cropBoxToDataUrl(sourceDataUrl, box2d) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const [W, H] = [img.naturalWidth, img.naturalHeight];
      const [ymin, xmin, ymax, xmax] = box2d || [0, 0, 1000, 1000];
      const sx = Math.max(0, Math.floor((xmin / 1000) * W));
      const sy = Math.max(0, Math.floor((ymin / 1000) * H));
      const sw = Math.max(32, Math.floor(((xmax - xmin) / 1000) * W));
      const sh = Math.max(32, Math.floor(((ymax - ymin) / 1000) * H));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.src = sourceDataUrl;
  });
}

// Connected-component neighbor pruning: drops cut-off neighbor fragments near crop edges
export function pruneDisconnectedEdgeNeighbors(isInk, w, h) {
  const total = w * h;
  const labels = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  const components = [];
  const bridgeRadius = 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (!isInk[start] || labels[start] !== -1) continue;
      const compId = components.length;
      let head = 0, tail = 0, count = 0, sumX = 0, sumY = 0;
      let minX = x, maxX = x, minY = y, maxY = y;
      labels[start] = compId;
      queue[tail++] = start;

      while (head < tail) {
        const curr = queue[head++];
        const cx = curr % w;
        const cy = (curr / w) | 0;
        count++; sumX += cx; sumY += cy;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        for (let ny = Math.max(0, cy - bridgeRadius); ny <= Math.min(h - 1, cy + bridgeRadius); ny++) {
          for (let nx = Math.max(0, cx - bridgeRadius); nx <= Math.min(w - 1, cx + bridgeRadius); nx++) {
            const nPos = ny * w + nx;
            if (isInk[nPos] && labels[nPos] === -1) { labels[nPos] = compId; queue[tail++] = nPos; }
          }
        }
      }
      const comX = sumX / count;
      const comY = sumY / count;
      components.push({ id: compId, count, minX, minY, maxX, maxY, comX, comY, distToCenter: Math.hypot(comX - w / 2, comY - h / 2) });
    }
  }

  if (components.length <= 1) return;
  const maxCount = Math.max(...components.map((c) => c.count));
  const significant = components.filter((c) => c.count >= maxCount * 0.15);
  const primary = (significant.length ? significant : components).reduce((best, c) => (c.distToCenter < best.distToCenter ? c : best));

  const discarded = new Uint8Array(components.length);
  components.forEach((c) => {
    if (c.id === primary.id) return;
    const touchesEdge = c.minX <= 4 || c.minY <= 4 || c.maxX >= w - 5 || c.maxY >= h - 5;
    const inOuterPerimeter = c.comX < w * 0.2 || c.comX > w * 0.8 || c.comY < h * 0.2 || c.comY > h * 0.8;
    if (touchesEdge && inOuterPerimeter) discarded[c.id] = 1;
  });

  for (let i = 0; i < total; i++) {
    if (labels[i] >= 0 && discarded[labels[i]]) isInk[i] = 0;
  }
}

function estimateSheetBackground(data, totalPixels) {
  const lumList = [];
  for (let i = 0; i < totalPixels; i += 4) {
    const [r, g, b] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    lumList.push({ lum: 0.299 * r + 0.587 * g + 0.114 * b, r, g, b });
  }
  lumList.sort((a, b) => b.lum - a.lum);
  const topCount = Math.max(1, Math.floor(lumList.length * 0.25));
  let bgR = 0, bgG = 0, bgB = 0;
  for (let i = 0; i < topCount; i++) { bgR += lumList[i].r; bgG += lumList[i].g; bgB += lumList[i].b; }
  return [Math.round(bgR / topCount), Math.round(bgG / topCount), Math.round(bgB / topCount)];
}

function dilateMask(isInk, w, h, radius) {
  const inSticker = new Uint8Array(w * h);
  const r2 = radius * radius;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isInk[y * w + x]) { inSticker[y * w + x] = 1; continue; }
      for (let ny = Math.max(0, y - radius); ny <= Math.min(h - 1, y + radius) && !inSticker[y * w + x]; ny++) {
        for (let nx = Math.max(0, x - radius); nx <= Math.min(w - 1, x + radius); nx++) {
          if ((nx - x) * (nx - x) + (ny - y) * (ny - y) <= r2 && isInk[ny * w + nx]) { inSticker[y * w + x] = 1; break; }
        }
      }
    }
  }
  return inSticker;
}

function floodFillOutside(inSticker, w, h) {
  const isOutside = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const enqueue = (x, y) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const pos = y * w + x;
    if (!isOutside[pos] && !inSticker[pos]) { isOutside[pos] = 1; queue[tail++] = pos; }
  };
  for (let x = 0; x < w; x++) { enqueue(x, 0); enqueue(x, h - 1); }
  for (let y = 0; y < h; y++) { enqueue(0, y); enqueue(w - 1, y); }
  while (head < tail) {
    const curr = queue[head++];
    const cx = curr % w;
    const cy = (curr / w) | 0;
    enqueue(cx + 1, cy); enqueue(cx - 1, cy); enqueue(cx, cy + 1); enqueue(cx, cy - 1);
  }
  return isOutside;
}

export function createTrueStickerCutout(ctx, w, h, dieCutBorderPx = 6) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const [bgR, bgG, bgB] = estimateSheetBackground(data, w * h);
  const isInk = new Uint8Array(w * h);
  const markInk = (threshold) => {
    let count = 0;
    for (let y = 3; y < h - 3; y++) {
      for (let x = 3; x < w - 3; x++) {
        const idx = (y * w + x) * 4;
        if (Math.hypot(data[idx] - bgR, data[idx + 1] - bgG, data[idx + 2] - bgB) > threshold) {
          isInk[y * w + x] = 1;
          count++;
        }
      }
    }
    return count;
  };
  if (markInk(22) < w * h * 0.015) markInk(11);
  pruneDisconnectedEdgeNeighbors(isInk, w, h);
  const inSticker = dilateMask(isInk, w, h, dieCutBorderPx);
  const isOutside = floodFillOutside(inSticker, w, h);
  for (let i = 0; i < w * h; i++) {
    if (isOutside[i]) data[i * 4 + 3] = 0;
  }
  ctx.putImageData(imgData, 0, 0);
}

// Perimeter-sampled background removal for loose tags, cards, envelopes, chipboard & badges
export function createLooseSupplyCutout(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const total = w * h;
  const isOutside = new Uint8Array(total);
  const queue = new Int32Array(total);
  const seedPos = new Int32Array(total);
  let head = 0, tail = 0;

  // Build up to 8 dominant perimeter background clusters from the outer 2px border
  const buckets = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= 2 && x < w - 2 && y >= 2 && y < h - 2) continue;
      const i4 = (y * w + x) * 4;
      const key = `${data[i4] >> 5}_${data[i4 + 1] >> 5}_${data[i4 + 2] >> 5}`;
      const existing = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      existing.count++;
      existing.r += data[i4];
      existing.g += data[i4 + 1];
      existing.b += data[i4 + 2];
      buckets.set(key, existing);
    }
  }
  const edgeClusters = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((c) => [c.r / c.count, c.g / c.count, c.b / c.count]);

  const enqueueBorder = (x, y) => {
    const pos = y * w + x;
    if (isOutside[pos]) return;
    isOutside[pos] = 1;
    seedPos[pos] = pos;
    queue[tail++] = pos;
  };
  for (let x = 0; x < w; x++) { enqueueBorder(x, 0); enqueueBorder(x, h - 1); }
  for (let y = 0; y < h; y++) { enqueueBorder(0, y); enqueueBorder(w - 1, y); }

  const dirs = [1, -1, w, -w];
  while (head < tail) {
    const curr = queue[head++];
    const cx = curr % w;
    const cy = (curr / w) | 0;
    const c4 = curr * 4;
    const s4 = seedPos[curr] * 4;

    for (let d = 0; d < 4; d++) {
      const nx = d === 0 ? cx + 1 : d === 1 ? cx - 1 : cx;
      const ny = d === 2 ? cy + 1 : d === 3 ? cy - 1 : cy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nPos = ny * w + nx;
      if (isOutside[nPos]) continue;

      const n4 = nPos * 4;
      const stepDist = Math.hypot(data[n4] - data[c4], data[n4 + 1] - data[c4 + 1], data[n4 + 2] - data[c4 + 2]);
      const seedDist = Math.hypot(data[n4] - data[s4], data[n4 + 1] - data[s4 + 1], data[n4 + 2] - data[s4 + 2]);
      const matchesCluster = edgeClusters.some(
        ([cr, cg, cb]) => Math.hypot(data[n4] - cr, data[n4 + 1] - cg, data[n4 + 2] - cb) < 28
      );

      if (stepDist < 18 && (seedDist < 28 || matchesCluster)) {
        isOutside[nPos] = 1;
        seedPos[nPos] = seedPos[curr];
        queue[tail++] = nPos;
      }
    }
  }

  for (let i = 0; i < total; i++) {
    if (isOutside[i]) data[i * 4 + 3] = 0;
  }
  ctx.putImageData(imgData, 0, 0);
}

export async function extractPaperSwatches(sourceDataUrl, papers = []) {
  if (!sourceDataUrl || !Array.isArray(papers) || papers.length === 0) return papers;
  const img = await loadImage(sourceDataUrl);
  const [W, H] = [img.naturalWidth, img.naturalHeight];

  return papers.map((paper, idx) => {
    const fallbackHex = normalizeHexColor(paper.hex, idx === 0 ? '#24344D' : '#F2EFE4');
    if (!Array.isArray(paper.sample_box_2d) || paper.sample_box_2d.length !== 4) {
      return {
        ...paper,
        hex: fallbackHex,
        color_name: paper.color_name || paper.name,
        pattern_type: paper.pattern_type || 'solid',
        swatchUrl: null,
      };
    }

    const [ymin, xmin, ymax, xmax] = paper.sample_box_2d;
    const rawW = Math.max(12, Math.floor(((xmax - xmin) / 1000) * W));
    const rawH = Math.max(12, Math.floor(((ymax - ymin) / 1000) * H));
    const insetX = Math.floor(rawW * 0.1);
    const insetY = Math.floor(rawH * 0.1);
    const sx = Math.max(0, Math.floor((xmin / 1000) * W) + insetX);
    const sy = Math.max(0, Math.floor((ymin / 1000) * H) + insetY);
    const sw = Math.max(8, Math.min(W - sx, rawW - insetX * 2));
    const sh = Math.max(8, Math.min(H - sy, rawH - insetY * 2));

    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 96, 96);
    const imgData = ctx.getImageData(0, 0, 96, 96);
    const sampledHex = sampleMedianHexFromImageData(imgData.data, 96 * 96);

    const isSolidLike = paper.pattern_type === 'solid' || paper.pattern_type === 'textured';
    const calibratedHex = paper.hex ? normalizeHexColor(paper.hex, sampledHex) : sampledHex;

    return {
      ...paper,
      hex: isSolidLike && !paper.hex ? sampledHex : calibratedHex,
      sampled_hex: sampledHex,
      secondary_hex: paper.secondary_hex ? normalizeHexColor(paper.secondary_hex, null) : null,
      color_name: paper.color_name || paper.name,
      pattern_type: paper.pattern_type || 'solid',
      swatchUrl: canvas.toDataURL('image/jpeg', 0.9),
    };
  });
}

export async function cropCutoutsFromSheet(
  sheetDataUrl,
  cutouts = [],
  idPrefix = 'sticker',
  startIndex = 1
) {
  if (!sheetDataUrl || !cutouts.length) return [];
  const img = await loadImage(sheetDataUrl);
  const [W, H, padPx] = [img.naturalWidth, img.naturalHeight, 6];

  return cutouts.map((item, idx) => {
    const [ymin, xmin, ymax, xmax] = item.box_2d || [100, 100, 250, 250];
    const sx = Math.max(0, Math.floor((xmin / 1000) * W) - padPx);
    const sy = Math.max(0, Math.floor((ymin / 1000) * H) - padPx);
    const sw = Math.max(20, Math.min(W, Math.ceil((xmax / 1000) * W) + padPx) - sx);
    const sh = Math.max(20, Math.min(H, Math.ceil((ymax / 1000) * H) + padPx) - sy);
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    createTrueStickerCutout(ctx, sw, sh, 6);

    const widthMm = item.width_mm || 48;
    const aspectH = Math.max(14, Math.min(115, Math.round(widthMm * (sh / sw))));

    return {
      ...item,
      id: `${idPrefix}_${startIndex + idx}`,
      item_type: 'sticker',
      supply_origin: 'sheet',
      width_mm: widthMm,
      height_mm: aspectH,
      cropUrl: canvas.toDataURL('image/png'),
    };
  });
}

export async function cropLooseSuppliesFromImage(
  sourceDataUrl,
  looseSupplies = [],
  startIndex = 1
) {
  if (!sourceDataUrl || !Array.isArray(looseSupplies) || !looseSupplies.length) return [];
  const img = await loadImage(sourceDataUrl);
  const [W, H, padPx] = [img.naturalWidth, img.naturalHeight, 4];

  return looseSupplies.map((item, idx) => {
    const [ymin, xmin, ymax, xmax] = item.box_2d || [100, 100, 250, 250];
    const sx = Math.max(0, Math.floor((xmin / 1000) * W) - padPx);
    const sy = Math.max(0, Math.floor((ymin / 1000) * H) - padPx);
    const sw = Math.max(24, Math.min(W, Math.ceil((xmax / 1000) * W) + padPx) - sx);
    const sh = Math.max(24, Math.min(H, Math.ceil((ymax / 1000) * H) + padPx) - sy);
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    createLooseSupplyCutout(ctx, sw, sh);

    const estW = Math.max(28, Math.min(115, Math.round(((xmax - xmin) / 1000) * 340)));
    const estH = Math.max(18, Math.min(115, Math.round(estW * (sh / sw))));

    return {
      ...item,
      id: `supply_${startIndex + idx}`,
      item_type: 'sticker',
      supply_origin: 'loose',
      width_mm: estW,
      height_mm: estH,
      cropUrl: canvas.toDataURL('image/png'),
    };
  });
}

export async function buildWashiTapeItems(sourceDataUrl, washiTapes = [], papers = []) {
  if (!Array.isArray(washiTapes) || !washiTapes.length) return [];
  const img = sourceDataUrl ? await loadImage(sourceDataUrl) : null;
  const W = img?.naturalWidth || 0;
  const H = img?.naturalHeight || 0;
  const plaidPaper = papers.find((p) => p.pattern_type === 'plaid');

  return washiTapes.map((tape, idx) => {
    let rollThumbUrl = null;
    let sampledHex = null;
    const cropBox = tape.sample_box_2d || tape.box_2d;

    if (img && Array.isArray(cropBox) && cropBox.length === 4) {
      const [ymin, xmin, ymax, xmax] = cropBox;
      const sx = Math.max(0, Math.floor((xmin / 1000) * W));
      const sy = Math.max(0, Math.floor((ymin / 1000) * H));
      const sw = Math.max(12, Math.min(W - sx, Math.ceil(((xmax - xmin) / 1000) * W)));
      const sh = Math.max(12, Math.min(H - sy, Math.ceil(((ymax - ymin) / 1000) * H)));
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 64, 64);
      rollThumbUrl = canvas.toDataURL('image/jpeg', 0.9);
      sampledHex = sampleMedianHexFromImageData(ctx.getImageData(0, 0, 64, 64).data, 64 * 64);
    }

    const patternType = tape.pattern_type || 'solid';
    const primaryHex = normalizeHexColor(
      tape.primary_hex || tape.hex || sampledHex,
      papers[0]?.hex || '#9E222B'
    );
    const secondaryHex = normalizeHexColor(
      tape.secondary_hex,
      patternType === 'plaid' ? plaidPaper?.hex || '#C2B29C' : '#F4F1E6'
    );

    return {
      id: `tape_${idx + 1}`,
      source_id: `tape_${idx + 1}`,
      item_type: 'washi_tape',
      category: 'washi_tape',
      label: tape.label || `${tape.color_name || 'Washi'} Tape`,
      color_name: tape.color_name || tape.label || `Washi Color ${idx + 1}`,
      primary_hex: primaryHex,
      secondary_hex: secondaryHex,
      pattern_type: patternType,
      width_mm: 48,
      height_mm: 12,
      rollThumbUrl,
    };
  });
}
