import { CANVAS_SIZE_MM, HARD_MARGIN_MM, MAX_PHOTO_AREA_PCT, clampToMargin, getOuterDims } from './svgCompiler.js';

const OLLAMA_URL = 'http://localhost:11434/api/chat';
const LAYOUT_MODEL = 'llama3.1:8b';
const DEFAULT_PAPERS = [
  { id: 'paper_1', name: 'Navy Base', hex: '#24344D', role: 'base_canvas' },
  { id: 'paper_2', name: 'Light Blue Mat', hex: '#A8C8D4', role: 'photo_mat' },
  { id: 'paper_3', name: 'Cream Mat', hex: '#F2EFE4', role: 'photo_mat' },
];

async function callOllama(messages) {
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: LAYOUT_MODEL, messages, stream: false, format: 'json', keep_alive: '15m' }),
  });
  if (!res.ok) throw new Error(`Ollama Error (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.message.content;
}

function boxesOverlap(a, b, gap = 0) {
  const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return xOverlap > -gap && yOverlap > -gap;
}

function applyRelationalUpdate(updatedObj, update, allObjects) {
  if (!update.relative_to || !update.position) return updatedObj;
  const target = allObjects.find((o) => o.id === update.relative_to);
  if (target) {
    const t = getOuterDims(target);
    const s = getOuterDims(updatedObj);
    const gap = update.gap_mm !== undefined ? update.gap_mm : 4.0;
    const offsets = {
      above: [0, -(t.h / 2 + s.h / 2 + gap)],
      below: [0, t.h / 2 + s.h / 2 + gap],
      left: [-(t.w / 2 + s.w / 2 + gap), 0],
      right: [t.w / 2 + s.w / 2 + gap, 0],
      overlap_top_right: [t.w / 2 - 8, -t.h / 2 + 8],
      overlap_top_left: [-t.w / 2 + 8, -t.h / 2 + 8],
      overlap_bottom_right: [t.w / 2 - 8, t.h / 2 - 8],
      overlap_bottom_left: [-t.w / 2 + 8, t.h / 2 - 8],
    };
    const delta = offsets[update.position];
    if (delta) {
      updatedObj.center_x = target.center_x + delta[0];
      updatedObj.center_y = target.center_y + delta[1];
    }
  }
  delete updatedObj.relative_to;
  delete updatedObj.position;
  delete updatedObj.gap_mm;
  return updatedObj;
}

function scanNonCollidingSpot(obj, checkCollision) {
  let box = clampToMargin(obj);
  if (!checkCollision(box)) return box;
  const minX = HARD_MARGIN_MM + box.w / 2;
  const maxX = CANVAS_SIZE_MM - HARD_MARGIN_MM - box.w / 2;
  const minY = HARD_MARGIN_MM + box.h / 2;
  const maxY = CANVAS_SIZE_MM - HARD_MARGIN_MM - box.h / 2;
  for (let y = minY; y <= maxY; y += 15) {
    for (let x = minX; x <= maxX; x += 15) {
      obj.center_x = Number(x.toFixed(1));
      obj.center_y = Number(y.toFixed(1));
      box = clampToMargin(obj);
      if (!checkCollision(box)) return box;
    }
  }
  return box;
}

function resolveInitialCollisions(layout) {
  const placedPhotoBoxes = [];
  layout.objects
    .filter((o) => o.type === 'photo_mat')
    .forEach((obj) => placedPhotoBoxes.push(scanNonCollidingSpot(obj, (b) => placedPhotoBoxes.some((p) => boxesOverlap(b, p, 10.0)))));

  const placedStickerBoxes = [];
  const hitsPhotoCoreOrSticker = (sBox) =>
    placedPhotoBoxes.some((p) => boxesOverlap(sBox, { left: p.left + p.w * 0.12, right: p.right - p.w * 0.12, top: p.top + p.h * 0.12, bottom: p.bottom - p.h * 0.12 })) ||
    placedStickerBoxes.some((other) => boxesOverlap(sBox, other, 4.0));

  layout.objects
    .filter((o) => o.type !== 'photo_mat')
    .forEach((obj) => placedStickerBoxes.push(scanNonCollidingSpot(obj, hitsPhotoCoreOrSticker)));
}

async function patchExistingLayout(existingLayout, availableCutouts, lastUserMessage) {
  const patchPrompt = `You are a precision coordinate updater for a 304.8mm x 304.8mm scrapbook canvas (0,0 is TOP-LEFT).
DIRECTIONAL MATH: Move UP = DECREASE center_y. Move DOWN = INCREASE center_y. Move LEFT = DECREASE center_x. Move RIGHT = INCREASE center_x.
For relative placement, output "relative_to": "<target_id>" and "position": "above"|"below"|"left"|"right"|"overlap_top_right"|"overlap_top_left"|"overlap_bottom_right"|"overlap_bottom_left".
ONLY use exact IDs from CURRENT OBJECTS or AVAILABLE INVENTORY CUTOUTS.
Output pure JSON: { "updates": [{ "id": "string", "center_x": float, "center_y": float, "rotation_degrees": integer, "mat_color": "string (optional)", "relative_to": "string (optional)", "position": "string (optional)", "gap_mm": float }] }`;

  const catalogBrief = availableCutouts.map(({ id, label, item_type, width_mm, height_mm }) => ({ id, label, item_type, width_mm, height_mm }));
  const rawPatch = await callOllama([
    { role: 'system', content: patchPrompt },
    { role: 'user', content: `CURRENT OBJECTS:\n${JSON.stringify(existingLayout.objects, null, 2)}\n\nAVAILABLE INVENTORY CUTOUTS:\n${JSON.stringify(catalogBrief, null, 2)}\n\nCOMMAND: ${lastUserMessage}` },
  ]);

  const patchData = JSON.parse(rawPatch);
  if (Array.isArray(patchData.updates)) {
    patchData.updates.forEach((u) => {
      if (!existingLayout.objects.some((o) => o.id === u.id)) {
        const inv = availableCutouts.find((c) => c.id === u.id);
        if (inv) existingLayout.objects.push({ id: inv.id, type: inv.item_type === 'cut_svg' ? 'cut_svg' : 'sticker', label: inv.label, width_mm: inv.width_mm || 50, height_mm: inv.height_mm || 50, center_x: u.center_x || 152.4, center_y: u.center_y || 152.4, rotation_degrees: u.rotation_degrees || 0, z_index: 10 });
      }
    });
    existingLayout.objects = existingLayout.objects.map((obj) => {
      const update = patchData.updates.find((u) => u.id === obj.id);
      if (!update) return obj;
      const updatedObj = { ...obj, ...update };
      if (obj.type === 'photo_mat') {
        updatedObj.photo_width = obj.photo_width;
        updatedObj.photo_height = obj.photo_height;
      }
      return applyRelationalUpdate(updatedObj, update, existingLayout.objects);
    });
  }
  return existingLayout;
}

async function createInitialLayout(photos, availableCutouts, baseCanvasHex, matPapers, defaultMatHex, lastUserMessage) {
  const lockedPhotos = photos.map((p, idx) => ({
    id: p.id || `photo_${idx + 1}`, type: 'photo_mat', photo_width: Number((p.w_in * 25.4).toFixed(1)),
    photo_height: Number((p.h_in * 25.4).toFixed(1)), display_number: idx + 1, mat_color: matPapers[idx % matPapers.length]?.hex || defaultMatHex,
  }));
  const stickerCatalog = availableCutouts.map((c) => ({
    id: c.id, type: c.item_type === 'cut_svg' ? 'cut_svg' : 'sticker', label: c.label, category: c.category, width_mm: c.width_mm || 55, height_mm: c.height_mm || 35,
  }));

  const initPrompt = `You are an expert Scrapbook Layout Designer for a 304.8 x 304.8 mm canvas. Output pure JSON only.
1. Include EVERY photo from LOCKED PHOTO INVENTORY with exact "id", "photo_width", "photo_height", "mat_color". Place photo_1 upper-left (95, 115, -2 deg) and photo_2 lower-right (205, 215, 2 deg).
2. Pick 3 to 5 items ONLY from AVAILABLE INVENTORY CUTOUTS (using exact "id"). Place titles top-right (220, 65) or bottom-left (75, 235), florals near photo corners.
Schema: { "layout": { "canvas_width": 304.8, "canvas_height": 304.8, "unit": "mm", "base_color": "#24344D" }, "objects": [{ "id": "photo_1", "type": "photo_mat", "photo_width": 101.6, "photo_height": 76.2, "center_x": 95.0, "center_y": 115.0, "rotation_degrees": -2, "z_index": 1, "mat_color": "#A8C8D4" }] }`;

  const rawJson = await callOllama([
    { role: 'system', content: initPrompt },
    { role: 'user', content: `LOCKED PHOTO INVENTORY:\n${JSON.stringify(lockedPhotos, null, 2)}\n\nAVAILABLE INVENTORY CUTOUTS:\n${JSON.stringify(stickerCatalog, null, 2)}\n\nUSER REQUEST: ${lastUserMessage}` },
  ]);

  const layout = JSON.parse(rawJson);
  if (!layout.layout) layout.layout = { canvas_width: CANVAS_SIZE_MM, canvas_height: CANVAS_SIZE_MM, unit: 'mm' };
  layout.layout.base_color = baseCanvasHex;

  const validObjects = [];
  (layout.objects || []).forEach((obj) => {
    const lp = lockedPhotos.find((p) => p.id === obj.id);
    if (lp) return validObjects.push({ ...obj, type: 'photo_mat', photo_width: lp.photo_width, photo_height: lp.photo_height, display_number: lp.display_number, mat_color: lp.mat_color, z_index: 1 });
    const match = stickerCatalog.find((sc) => sc.id === obj.id);
    if (match && !validObjects.some((v) => v.id === match.id)) {
      validObjects.push({ ...obj, type: match.type, label: match.label, width_mm: match.width_mm, height_mm: match.height_mm, z_index: obj.z_index || 10 });
    }
  });
  lockedPhotos.forEach((lp, idx) => {
    if (!validObjects.some((o) => o.id === lp.id)) {
      validObjects.push({ ...lp, center_x: idx === 0 ? 95 : 205, center_y: idx === 0 ? 115 : 215, rotation_degrees: idx === 0 ? -2 : 2, z_index: 1 });
    }
  });
  layout.objects = validObjects;
  return layout;
}

export async function generateOrPatchLayout({ messages = [], currentLayout = null, photos = [], extractedInventory = null }) {
  const lastUserMessage = messages[messages.length - 1]?.content || 'Design a balanced scrapbook page.';
  const isStartOver = /start over|new layout|reset/i.test(lastUserMessage);
  if (photos.length > 0) {
    const totalArea = photos.reduce((sum, p) => sum + (p.w_in * 25.4 + 10) * (p.h_in * 25.4 + 10), 0);
    const areaPct = (totalArea / (CANVAS_SIZE_MM * CANVAS_SIZE_MM)) * 100;
    if (areaPct > MAX_PHOTO_AREA_PCT) {
      const err = new Error(`Hard Rule Violation: Selected photos take up ${areaPct.toFixed(1)}% of the canvas (max allowed is 50%).`);
      err.status = 400;
      throw err;
    }
  }

  const papers = extractedInventory?.papers?.length ? extractedInventory.papers : DEFAULT_PAPERS;
  const availableCutouts = extractedInventory?.cutouts || [];
  const baseCanvasHex = papers[0]?.hex || '#24344D';
  const matPapers = papers.length > 1 ? papers.slice(1) : papers;
  const defaultMatHex = matPapers[0]?.hex || '#F2EFE4';

  const layout = currentLayout && !isStartOver
    ? await patchExistingLayout(typeof currentLayout === 'string' ? JSON.parse(currentLayout) : currentLayout, availableCutouts, lastUserMessage)
    : await createInitialLayout(photos, availableCutouts, baseCanvasHex, matPapers, defaultMatHex, lastUserMessage);

  layout.objects.forEach((obj) => clampToMargin(obj));
  if (!currentLayout || isStartOver) resolveInitialCollisions(layout);
  return { layout, defaultMatHex };
}
