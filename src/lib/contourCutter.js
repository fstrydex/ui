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

export function cropCutoutsFromSheet(sheetDataUrl, cutouts = []) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const [W, H, padPx] = [img.naturalWidth, img.naturalHeight, 6];
      const enriched = cutouts.map((item) => {
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
        return { ...item, item_type: 'sticker', cropUrl: canvas.toDataURL('image/png') };
      });
      resolve(enriched);
    };
    img.src = sheetDataUrl;
  });
}
