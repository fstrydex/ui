import { designInitialLayoutWithCloud } from './cloudVision.js';
import { getMatchingStarredLayouts } from './layoutMemory.js';
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

export function resolveClusterAnchors(objects = []) {
  const photos = objects.filter((o) => o.type === 'photo_mat');
  const clusterCounts = new Map();

  return objects.map((obj) => {
    if (obj.type === 'photo_mat' || !obj.anchor_zone) return obj;
    const target = photos.find((p) => p.id === obj.anchor_to) || photos[0];
    if (!target) {
      const cleaned = { ...obj };
      delete cleaned.anchor_to;
      delete cleaned.anchor_zone;
      return cleaned;
    }

    const clusterKey = `${target.id}:${obj.anchor_zone}`;
    const clusterIdx = clusterCounts.get(clusterKey) || 0;
    clusterCounts.set(clusterKey, clusterIdx + 1);

    const t = getOuterDims(target);
    const s = getOuterDims(obj);
    const fanOffsets = {
      overlap_top_left: [[0, 0], [22, -4], [-6, 22]],
      overlap_top_right: [[0, 0], [-22, -4], [6, 22]],
      overlap_bottom_left: [[0, 0], [22, 4], [-6, -22]],
      overlap_bottom_right: [[0, 0], [-22, 4], [6, -22]],
      above: [[0, 0], [26, 0], [-26, 0]],
      below: [[0, 0], [26, 0], [-26, 0]],
      left: [[0, 0], [0, 22], [0, -22]],
      right: [[0, 0], [0, 22], [0, -22]],
    };
    const baseCenters = {
      overlap_top_left: [target.center_x - t.w / 2, target.center_y - t.h / 2],
      overlap_top_right: [target.center_x + t.w / 2, target.center_y - t.h / 2],
      overlap_bottom_left: [target.center_x - t.w / 2, target.center_y + t.h / 2],
      overlap_bottom_right: [target.center_x + t.w / 2, target.center_y + t.h / 2],
      above: [target.center_x, target.center_y - t.h / 2 - s.h / 2 - 6],
      below: [target.center_x, target.center_y + t.h / 2 + s.h / 2 + 6],
      left: [target.center_x - t.w / 2 - s.w / 2 - 6, target.center_y],
      right: [target.center_x + t.w / 2 + s.w / 2 + 6, target.center_y],
    };

    const base = baseCenters[obj.anchor_zone];
    const updated = { ...obj };
    if (base) {
      const fanList = fanOffsets[obj.anchor_zone] || [[0, 0]];
      const [fx, fy] = fanList[clusterIdx] || [
        (clusterIdx % 2 === 0 ? -1 : 1) * (16 + clusterIdx * 6),
        14 * clusterIdx,
      ];
      updated.center_x = Number((base[0] + fx).toFixed(1));
      updated.center_y = Number((base[1] + fy).toFixed(1));
      updated._clustered = true;
    }
    delete updated.anchor_to;
    delete updated.anchor_zone;
    return updated;
  });
}

export function nudgeToNearestOpenSpot(obj, checkCollision) {
  const origX = Number.isFinite(obj.center_x) ? obj.center_x : CANVAS_SIZE_MM / 2;
  const origY = Number.isFinite(obj.center_y) ? obj.center_y : CANVAS_SIZE_MM / 2;
  let box = clampToMargin(obj);
  if (!checkCollision(box)) return box;

  for (let radius = 12; radius <= 240; radius += 12) {
    let bestSpot = null;
    let bestDist = Infinity;
    for (let i = 0; i < 12; i++) {
      const angle = (i * 2 * Math.PI) / 12;
      obj.center_x = Number((origX + radius * Math.cos(angle)).toFixed(1));
      obj.center_y = Number((origY + radius * Math.sin(angle)).toFixed(1));
      const candidate = clampToMargin(obj);
      if (!checkCollision(candidate)) {
        const dist = Math.hypot(obj.center_x - origX, obj.center_y - origY);
        if (dist < bestDist) {
          bestDist = dist;
          bestSpot = { x: obj.center_x, y: obj.center_y, box: candidate };
        }
      }
    }
    if (bestSpot) {
      obj.center_x = bestSpot.x;
      obj.center_y = bestSpot.y;
      return bestSpot.box;
    }
  }

  obj.center_x = origX;
  obj.center_y = origY;
  return clampToMargin(obj);
}

export function resolveInitialCollisions(layout) {
  const placedPhotoBoxes = [];
  layout.objects
    .filter((o) => o.type === 'photo_mat')
    .forEach((obj) =>
      placedPhotoBoxes.push(
        nudgeToNearestOpenSpot(obj, (b) => placedPhotoBoxes.some((p) => boxesOverlap(b, p, 10.0)))
      )
    );

  const placedStickers = [];
  layout.objects
    .filter((o) => o.type !== 'photo_mat')
    .forEach((obj) => {
      const isClustered = Boolean(obj._clustered);
      delete obj._clustered;
      const coreFactor = isClustered ? 0.24 : 0.14;

      const hitsPhotoCoreOrSticker = (sBox) => {
        const hitsCore = placedPhotoBoxes.some((p) =>
          boxesOverlap(sBox, {
            left: p.left + p.w * coreFactor,
            right: p.right - p.w * coreFactor,
            top: p.top + p.h * coreFactor,
            bottom: p.bottom - p.h * coreFactor,
          })
        );
        if (hitsCore) return true;

        const cx = (sBox.left + sBox.right) / 2;
        const cy = (sBox.top + sBox.bottom) / 2;
        return placedStickers.some((other) => {
          if (isClustered && other.isClustered) {
            const ox = (other.box.left + other.box.right) / 2;
            const oy = (other.box.top + other.box.bottom) / 2;
            return Math.hypot(cx - ox, cy - oy) < 16.0;
          }
          return boxesOverlap(sBox, other.box, 4.0);
        });
      };

      const finalBox = nudgeToNearestOpenSpot(obj, hitsPhotoCoreOrSticker);
      placedStickers.push({ box: finalBox, isClustered });
    });
}

async function patchExistingLayout(existingLayout, availableCutouts, lastUserMessage) {
  const patchPrompt = `You are a precision coordinate updater for a 304.8mm x 304.8mm scrapbook canvas (0,0 is TOP-LEFT).
DIRECTIONAL MATH: Move UP = DECREASE center_y. Move DOWN = INCREASE center_y. Move LEFT = DECREASE center_x. Move RIGHT = INCREASE center_x.
For relative placement, output "relative_to": "<target_id>" and "position": "above"|"below"|"left"|"right"|"overlap_top_right"|"overlap_top_left"|"overlap_bottom_right"|"overlap_bottom_left".
ONLY use exact IDs from CURRENT OBJECTS or AVAILABLE INVENTORY CUTOUTS.
Output pure JSON: { "updates": [{ "id": "string", "center_x": float, "center_y": float, "rotation_degrees": integer, "mat_color": "string (optional)", "relative_to": "string (optional)", "position": "string (optional)", "gap_mm": float }] }`;

  const catalogBrief = availableCutouts.map(({ id, label, item_type, width_mm, height_mm }) => ({
    id, label, item_type, width_mm, height_mm,
  }));
  const rawPatch = await callOllama([
    { role: 'system', content: patchPrompt },
    { role: 'user', content: `CURRENT OBJECTS:\n${JSON.stringify(existingLayout.objects, null, 2)}\n\nAVAILABLE INVENTORY CUTOUTS:\n${JSON.stringify(catalogBrief, null, 2)}\n\nCOMMAND: ${lastUserMessage}` },
  ]);

  const patchData = JSON.parse(rawPatch);
  if (Array.isArray(patchData.updates)) {
    patchData.updates.forEach((u) => {
      if (!existingLayout.objects.some((o) => o.id === u.id)) {
        const inv = availableCutouts.find((c) => c.id === u.id);
        if (inv) {
          existingLayout.objects.push({
            id: inv.id,
            type: inv.item_type === 'cut_svg' ? 'cut_svg' : 'sticker',
            label: inv.label,
            width_mm: inv.width_mm || 50,
            height_mm: inv.height_mm || 50,
            center_x: u.center_x || 152.4,
            center_y: u.center_y || 152.4,
            rotation_degrees: u.rotation_degrees || 0,
            z_index: 10,
          });
        }
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
  return { layout: existingLayout, usedModel: LAYOUT_MODEL };
}

async function createInitialLayout(photos, availableCutouts, baseCanvasHex, matPapers, defaultMatHex, theme, lastUserMessage) {
  const lockedPhotos = photos.map((p, idx) => ({
    id: p.id || `photo_${idx + 1}`,
    type: 'photo_mat',
    photo_width: Number((p.w_in * 25.4).toFixed(1)),
    photo_height: Number((p.h_in * 25.4).toFixed(1)),
    display_number: idx + 1,
    mat_color: matPapers[idx % matPapers.length]?.hex || defaultMatHex,
  }));
  const stickerCatalog = availableCutouts.map((c) => ({
    id: c.id,
    type: c.item_type === 'cut_svg' ? 'cut_svg' : 'sticker',
    label: c.label,
    category: c.category,
    width_mm: c.width_mm || 55,
    height_mm: c.height_mm || 35,
  }));

  const { examples: starredExamples } = await getMatchingStarredLayouts(photos, 3);
  let draftData = null;
  let usedModel = LAYOUT_MODEL;

  try {
    const cloudResult = await designInitialLayoutWithCloud({
      lockedPhotos,
      stickerCatalog,
      baseCanvasHex,
      theme,
      userRequest: lastUserMessage,
      starredExamples,
    });
    draftData = cloudResult.data;
    usedModel = cloudResult.usedModel;
  } catch (err) {
    console.warn(`[Cloud Art Director Fallback -> ${LAYOUT_MODEL}]: ${err?.message || err}`);
    const initPrompt = `You are a Scrapbook Layout Designer for a 304.8 x 304.8 mm canvas. Output pure JSON only.
1. Place EVERY photo from LOCKED PHOTO INVENTORY (Diagonal Counterbalance or Triangle). Keep >=12mm gap between mats.
2. Pick 3 to 6 cutouts from AVAILABLE INVENTORY CUTOUTS using exact "id", grouping embellishments into 2-3 tight clusters anchored via "anchor_to": "photo_1" and "anchor_zone": "overlap_top_left"|"overlap_top_right"|"overlap_bottom_left"|"overlap_bottom_right"|"above"|"below".
STARRED EXAMPLES:\n${JSON.stringify(starredExamples, null, 2)}
Schema: { "archetype": "string", "design_notes": "string", "objects": [{ "id": "photo_1", "type": "photo_mat", "center_x": 95, "center_y": 110, "rotation_degrees": -2, "z_index": 1 }, { "id": "sticker_1", "type": "sticker", "anchor_to": "photo_1", "anchor_zone": "overlap_top_left", "center_x": 50, "center_y": 75, "rotation_degrees": 0, "z_index": 11 }] }`;

    const rawJson = await callOllama([
      { role: 'system', content: initPrompt },
      { role: 'user', content: `LOCKED PHOTO INVENTORY:\n${JSON.stringify(lockedPhotos, null, 2)}\n\nAVAILABLE INVENTORY CUTOUTS:\n${JSON.stringify(stickerCatalog, null, 2)}\n\nUSER REQUEST: ${lastUserMessage}` },
    ]);
    draftData = JSON.parse(rawJson);
  }

  const layout = {
    layout: {
      canvas_width: CANVAS_SIZE_MM,
      canvas_height: CANVAS_SIZE_MM,
      unit: 'mm',
      base_color: baseCanvasHex,
    },
    archetype: draftData?.archetype || 'Scrapbook Composition',
    design_notes: draftData?.design_notes || '',
    objects: [],
  };

  const validObjects = [];
  (draftData?.objects || []).forEach((obj) => {
    const lp = lockedPhotos.find((p) => p.id === obj.id);
    if (lp) {
      validObjects.push({
        ...obj,
        type: 'photo_mat',
        photo_width: lp.photo_width,
        photo_height: lp.photo_height,
        display_number: lp.display_number,
        mat_color: lp.mat_color,
        z_index: 1,
      });
      return;
    }
    const match = stickerCatalog.find((sc) => sc.id === obj.id);
    if (match && !validObjects.some((v) => v.id === match.id)) {
      validObjects.push({
        ...obj,
        type: match.type,
        label: match.label,
        width_mm: match.width_mm,
        height_mm: match.height_mm,
        z_index: obj.z_index || 10,
      });
    }
  });

  lockedPhotos.forEach((lp, idx) => {
    if (!validObjects.some((o) => o.id === lp.id)) {
      validObjects.push({
        ...lp,
        center_x: idx % 2 === 0 ? 95 : 205,
        center_y: 110 + Math.floor(idx / 2) * 100 + (idx % 2 === 1 ? 95 : 0),
        rotation_degrees: idx % 2 === 0 ? -2 : 2,
        z_index: 1,
      });
    }
  });

  layout.objects = resolveClusterAnchors(validObjects);
  return { layout, usedModel, designNotes: layout.design_notes, archetype: layout.archetype };
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
  const theme = extractedInventory?.theme || 'Scrapbook Page';

  let result;
  if (currentLayout && !isStartOver) {
    const parsed = typeof currentLayout === 'string' ? JSON.parse(currentLayout) : currentLayout;
    result = await patchExistingLayout(parsed, availableCutouts, lastUserMessage);
  } else {
    result = await createInitialLayout(photos, availableCutouts, baseCanvasHex, matPapers, defaultMatHex, theme, lastUserMessage);
  }

  result.layout.objects.forEach((obj) => clampToMargin(obj));
  if (!currentLayout || isStartOver) resolveInitialCollisions(result.layout);

  return {
    layout: result.layout,
    defaultMatHex,
    usedModel: result.usedModel,
    designNotes: result.designNotes || '',
    archetype: result.archetype || '',
  };
}
