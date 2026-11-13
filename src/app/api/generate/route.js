import { GoogleGenerativeAI } from '@google/generative-ai';

const OLLAMA_URL = 'http://localhost:11434/api/chat';
const LAYOUT_MODEL = 'llama3.1:8b';
const GEMINI_VISION_MODEL = 'gemini-3.8-flash';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function callGeminiJson(prompt, imagePart, temperature = 0.1) {
  const modelsToTry = [GEMINI_VISION_MODEL, 'gemini-3.6-flash', 'gemini-2.5-flash'];
  let lastErr = null;

  for (const modelName of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature,
        },
      });
      const result = await model.generateContent([prompt, imagePart]);
      return {
        data: JSON.parse(result.response.text()),
        usedModel: modelName,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function callOllama(modelName, messages, forceJson = false, keepAlive = '15m') {
  const body = {
    model: modelName,
    messages,
    stream: false,
    keep_alive: keepAlive,
  };
  if (forceJson) body.format = 'json';

  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.message.content;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      action = 'generate_layout',
      messages = [],
      currentLayout = null,
      photos = [],
      supplyImage = null,
      sheetOnlyImage = null,
      extractedInventory = null,
      cropImage = null,
      label = '',
      palette = [],
    } = body;

    // =========================================================================
    // MODE 1A: LOCATE STICKER SHEET + DETECT CARDSTOCK PALETTE (GEMINI 3.8 FLASH)
    // =========================================================================
    if (action === 'locate_sheet_and_papers') {
      if (!supplyImage) {
        return Response.json({ error: 'No supply image provided.' }, { status: 400 });
      }
      if (!process.env.GEMINI_API_KEY) {
        return Response.json({ error: 'GEMINI_API_KEY is missing in .env.local' }, { status: 500 });
      }

      const matches = supplyImage.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      const mimeType = matches ? matches[1] : 'image/jpeg';
      const base64Data = matches ? matches[2] : supplyImage.replace(/^data:image\/\w+;base64,/, '');
      const imagePart = { inlineData: { data: base64Data, mimeType } };

      const locatePrompt = `Examine this overhead photo of scrapbooking supplies on a table.
1. Find the exact 2D bounding box of ONLY the white/cream sticker sheet ("sheet_box_2d": [ymin, xmin, ymax, xmax] scaled 0..1000), excluding the wooden table and excluding the blue/navy cardstock sticking out on the right/bottom.
2. Identify the background cardstock and patterned paper sheets ("papers") with accurate hex codes.

Return pure JSON:
{
  "theme": "Romantic / Wedding",
  "sheet_box_2d": [82, 125, 835, 675],
  "papers": [
    { "id": "paper_1", "name": "Navy Blue Cardstock", "hex": "#24344D", "role": "base_canvas" },
    { "id": "paper_2", "name": "Light Blue Patterned Paper", "hex": "#A8C8D4", "role": "photo_mat" },
    { "id": "paper_3", "name": "Warm Cream Cardstock", "hex": "#F2EFE4", "role": "photo_mat" }
  ]
}`;

      const { data, usedModel } = await callGeminiJson(locatePrompt, imagePart, 0.1);
      return Response.json({ ...data, usedModel });
    }

    // =========================================================================
    // MODE 1B: PRECISION STICKER DETECTION ON THE CROPPED STICKER SHEET ONLY
    // =========================================================================
    if (action === 'detect_stickers_on_sheet') {
      if (!sheetOnlyImage) {
        return Response.json({ error: 'No cropped sheet image provided.' }, { status: 400 });
      }

      const matches = sheetOnlyImage.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      const mimeType = matches ? matches[1] : 'image/jpeg';
      const base64Data = matches ? matches[2] : sheetOnlyImage.replace(/^data:image\/\w+;base64,/, '');
      const imagePart = { inlineData: { data: base64Data, mimeType } };

      const boxPrompt = `This image is a cropped view of a single scrapbook sticker sheet.
Detect 8 to 10 distinct, well-separated individual stickers on this sheet:
- The cursive "together" script word
- The "Happily ever after" framed square sticker
- The dark "The best is yet to come..." rectangle
- An individual 5-petal cream/tan flower blossom (pick ONE single flower, not a group)
- An individual dark line-art botanical leafy stem (pick ONE single stem)
- The "adore you" round sticker
- The dark floral heart sticker
- The "this is us" or "best day ever" dark top banner

CRITICAL BOUNDING BOX RULES:
- Coordinates [ymin, xmin, ymax, xmax] are scaled 0 to 1000 relative to THIS cropped sheet image.
- Keep each box tight around that single sticker so neighboring stickers do not bleed into the box!

Return a pure JSON array:
[
  { "box_2d": [ymin, xmin, ymax, xmax], "label": "descriptive name", "category": "title|floral|banner|heart|tag", " ink_type": "dark_or_ floral" }
]`;

      const { data: rawBoxes, usedModel } = await callGeminiJson(boxPrompt, imagePart, 0.05);

      const cutouts = (Array.isArray(rawBoxes) ? rawBoxes : []).slice(0, 10).map((item, idx) => {
        const [ymin, xmin, ymax, xmax] = item.box_2d || [100, 100, 250, 250];
        const estW = Math.max(24, Math.min(125, Math.round(((xmax - xmin) / 1000) * 304.8)));
        const estH = Math.max(18, Math.min(105, Math.round(((ymax - ymin) / 1000) * 304.8)));
        return {
          id: `sticker_${idx + 1}`,
          label: item.label || `Sticker ${idx + 1}`,
          category: item.category || 'motif',
          box_2d: [ymin, xmin, ymax, xmax],
          width_mm: estW,
          height_mm: estH,
        };
      });

      return Response.json({ cutouts, usedModel });
    }

    // =========================================================================
    // MODE 2: VECTORIZE A FLORAL/SHAPE STICKER INTO A CARDSTOCK CUT SVG
    // =========================================================================
    if (action === 'vectorize_cutout') {
      if (!cropImage) {
        return Response.json({ error: 'No crop image provided.' }, { status: 400 });
      }

      const matches = cropImage.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      const mimeType = matches ? matches[1] : 'image/png';
      const base64Data = matches ? matches[2] : cropImage.replace(/^data:image\/\w+;base64,/, '');
      const imagePart = { inlineData: { data: base64Data, mimeType } };

      const paletteDesc =
        palette.map((p) => `${p.name} (${p.hex})`).join(', ') ||
        'Navy (#24344D), Light Blue (#A8C8D4), Cream (#F2EFE4)';

      const vectorPrompt = `Look closely at the visual motif in this cropped sticker image ("${label}").
Trace its actual visual contour into a detailed, multi-layered SVG cut-file inside a 100x100 viewBox (0..100, 0..100) that can be cut from cardstock on a Cricut.
- Use cubic Bezier curves (<path d="M... C... Z"/>) to capture organic petal, leaf, or heart contours accurately—do NOT just use primitive circles!
- Base layer: Cream (#F2EFE4) or Light Blue (#A8C8D4) outer contour.
- Inner layers: Contrasting details using ${paletteDesc} and #2C2C2C.

Return pure JSON:
{
  "svg_inner": "<path ... />",
  "recognized_shape": "exact visual motif traced"
}`;

      const { data: parsedVector } = await callGeminiJson(vectorPrompt, imagePart, 0.15);
      return Response.json({ vector: parsedVector });
    }

    // =========================================================================
    // MODE 3: GENERATE OR PATCH LAYOUT USING REAL DIE-CUT STICKER CROPS
    // =========================================================================
    const lastUserMessage = messages[messages.length - 1]?.content || 'Design a balanced scrapbook page.';
    const isStartOver = /start over|new layout|reset/i.test(lastUserMessage);

    const canvasSize = 304.8;
    const hardMargin = 15.0;
    const canvasArea = canvasSize * canvasSize;

    if (photos.length > 0) {
      const totalPhotoMatArea = photos.reduce((sum, p) => {
        const outerW = p.w_in * 25.4 + 10;
        const outerH = p.h_in * 25.4 + 10;
        return sum + outerW * outerH;
      }, 0);

      const areaPct = (totalPhotoMatArea / canvasArea) * 100;
      if (areaPct > 50.0) {
        return Response.json(
          { error: `Hard Rule Violation: Selected photos take up ${areaPct.toFixed(1)}% of the canvas (max allowed is 50%).` },
          { status: 400 }
        );
      }
    }

    const papers = extractedInventory?.papers || [
      { id: 'paper_1', name: 'Navy Base', hex: '#24344D', role: 'base_canvas' },
      { id: 'paper_2', name: 'Light Blue Mat', hex: '#A8C8D4', role: 'photo_mat' },
      { id: 'paper_3', name: 'Cream Mat', hex: '#F2EFE4', role: 'photo_mat' },
    ];
    const availableCutouts = extractedInventory?.cutouts || [];
    const baseCanvasHex = papers[0]?.hex || '#24344D';
    const matPapers = papers.length > 1 ? papers.slice(1) : papers;
    const defaultMatHex = matPapers[0]?.hex || '#F2EFE4';

    let layout;

    if (currentLayout && !isStartOver) {
      const existingLayout = JSON.parse(currentLayout);

      const patchSystemPrompt = {
        role: 'system',
        content: `You are a precision coordinate updater for a 304.8mm x 304.8mm scrapbook canvas.
Coordinate reference (0,0 is TOP-LEFT):
- Top-Left: center_x ~ 85, center_y ~ 95
- Top-Right: center_x ~ 220, center_y ~ 95
- Bottom-Left: center_x ~ 85, center_y ~ 215
- Bottom-Right: center_x ~ 220, center_y ~ 215
- Center: center_x ~ 152.4, center_y ~ 152.4

CRITICAL DIRECTIONAL MATH:
- Y=0 is the TOP. Move UP = DECREASE center_y. Move DOWN = INCREASE center_y.
- Move LEFT = DECREASE center_x. Move RIGHT = INCREASE center_x.
- For relative placement, output "relative_to": "<target_id>" and "position": "above" | "below" | "left" | "right" | "overlap_top_right" | "overlap_top_left" | "overlap_bottom_right" | "overlap_bottom_left".
- ONLY use exact IDs from CURRENT OBJECTS or AVAILABLE INVENTORY CUTOUTS.

Output pure JSON only:
{
  "updates": [
    {
      "id": "string",
      "center_x": float,
      "center_y": float,
      "rotation_degrees": integer,
      "mat_color": "string (hex code, optional)",
      "relative_to": "string (optional)",
      "position": "above|below|left|right|overlap_top_right|overlap_top_left|overlap_bottom_right|overlap_bottom_left (optional)",
      "gap_mm": float (optional, default 4)
    }
  ]
}`,
      };

      const rawPatch = await callOllama(
        LAYOUT_MODEL,
        [
          patchSystemPrompt,
          {
            role: 'user',
            content: `CURRENT OBJECTS:\n${JSON.stringify(existingLayout.objects, null, 2)}\n\nAVAILABLE INVENTORY CUTOUTS:\n${JSON.stringify(
              availableCutouts.map(({ id, label, item_type, width_mm, height_mm }) => ({ id, label, item_type, width_mm, height_mm })),
              null,
              2
            )}\n\nCOMMAND: ${lastUserMessage}`,
          },
        ],
        true,
        '15m'
      );

      const patchData = JSON.parse(rawPatch);

      const getOuterDims = (item) => ({
        w: item.type === 'photo_mat' ? item.photo_width + 10 : item.width_mm || 50,
        h: item.type === 'photo_mat' ? item.photo_height + 10 : item.height_mm || 35,
      });

      if (patchData.updates && Array.isArray(patchData.updates)) {
        patchData.updates.forEach((u) => {
          const exists = existingLayout.objects.some((o) => o.id === u.id);
          if (!exists) {
            const invItem = availableCutouts.find((c) => c.id === u.id);
            if (invItem) {
              existingLayout.objects.push({
                id: invItem.id,
                type: invItem.item_type === 'cut_svg' ? 'cut_svg' : 'sticker',
                label: invItem.label,
                width_mm: invItem.width_mm || 50,
                height_mm: invItem.height_mm || 50,
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

          let updatedObj = { ...obj, ...update };
          if (obj.type === 'photo_mat') {
            updatedObj.photo_width = obj.photo_width;
            updatedObj.photo_height = obj.photo_height;
          }

          if (update.relative_to && update.position) {
            const target = existingLayout.objects.find((o) => o.id === update.relative_to);
            if (target) {
              const targetDims = getOuterDims(target);
              const selfDims = getOuterDims(updatedObj);
              const gap = update.gap_mm !== undefined ? update.gap_mm : 4.0;

              switch (update.position) {
                case 'above':
                  updatedObj.center_x = target.center_x;
                  updatedObj.center_y = target.center_y - targetDims.h / 2 - selfDims.h / 2 - gap;
                  break;
                case 'below':
                  updatedObj.center_x = target.center_x;
                  updatedObj.center_y = target.center_y + targetDims.h / 2 + selfDims.h / 2 + gap;
                  break;
                case 'left':
                  updatedObj.center_x = target.center_x - targetDims.w / 2 - selfDims.w / 2 - gap;
                  updatedObj.center_y = target.center_y;
                  break;
                case 'right':
                  updatedObj.center_x = target.center_x + targetDims.w / 2 + selfDims.w / 2 + gap;
                  updatedObj.center_y = target.center_y;
                  break;
                case 'overlap_top_right':
                  updatedObj.center_x = target.center_x + targetDims.w / 2 - 8;
                  updatedObj.center_y = target.center_y - targetDims.h / 2 + 8;
                  break;
                case 'overlap_top_left':
                  updatedObj.center_x = target.center_x - targetDims.w / 2 + 8;
                  updatedObj.center_y = target.center_y - targetDims.h / 2 + 8;
                  break;
                case 'overlap_bottom_right':
                  updatedObj.center_x = target.center_x + targetDims.w / 2 - 8;
                  updatedObj.center_y = target.center_y + targetDims.h / 2 - 8;
                  break;
                case 'overlap_bottom_left':
                  updatedObj.center_x = target.center_x - targetDims.w / 2 + 8;
                  updatedObj.center_y = target.center_y + targetDims.h / 2 - 8;
                  break;
              }
            }
            delete updatedObj.relative_to;
            delete updatedObj.position;
            delete updatedObj.gap_mm;
          }

          return updatedObj;
        });
      }
      layout = existingLayout;
    } else {
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

      const initSystemPrompt = {
        role: 'system',
        content: `You are an expert Scrapbook Layout Designer for a 304.8 x 304.8 mm canvas. Output pure JSON only.
1. Include EVERY photo from LOCKED PHOTO INVENTORY with its exact "id", "photo_width", "photo_height", and "mat_color". Place photo_1 in the upper-left area (center_x: 95, center_y: 115, rotation_degrees: -2) and photo_2 in the lower-right area (center_x: 205, center_y: 215, rotation_degrees: 2).
2. Pick 3 to 5 items ONLY from AVAILABLE INVENTORY CUTOUTS (using their EXACT "id"). Place titles in the open top-right area (center_x: 220, center_y: 65) or bottom-left open space (center_x: 75, center_y: 235), and place small florals/badges near photo corners.

Schema format:
{
  "layout": { "canvas_width": 304.8, "canvas_height": 304.8, "unit": "mm", "base_color": "#24344D" },
  "objects": [
    { "id": "photo_1", "type": "photo_mat", "photo_width": 101.6, "photo_height": 76.2, "center_x": 95.0, "center_y": 115.0, "rotation_degrees": -2, "z_index": 1, "mat_color": "#A8C8D4" },
    { "id": "sticker_1", "type": "sticker", "label": "together", "width_mm": 90.0, "height_mm": 38.0, "center_x": 220.0, "center_y": 65.0, "rotation_degrees": 2, "z_index": 10 }
  ]
}`,
      };

      const userPrompt = `LOCKED PHOTO INVENTORY:
${JSON.stringify(lockedPhotos, null, 2)}

AVAILABLE INVENTORY CUTOUTS (Use ONLY exact "id" values from this list):
${JSON.stringify(stickerCatalog, null, 2)}

USER REQUEST: ${lastUserMessage}`;

      const rawJson = await callOllama(
        LAYOUT_MODEL,
        [initSystemPrompt, { role: 'user', content: userPrompt }],
        true,
        '15m'
      );

      layout = JSON.parse(rawJson);
      if (!layout.layout) layout.layout = { canvas_width: 304.8, canvas_height: 304.8, unit: 'mm' };
      layout.layout.base_color = baseCanvasHex;

      const validObjects = [];
      (layout.objects || []).forEach((obj) => {
        const lockedPhoto = lockedPhotos.find((lp) => lp.id === obj.id);
        if (lockedPhoto) {
          validObjects.push({
            ...obj,
            type: 'photo_mat',
            photo_width: lockedPhoto.photo_width,
            photo_height: lockedPhoto.photo_height,
            display_number: lockedPhoto.display_number,
            mat_color: lockedPhoto.mat_color,
            z_index: 1,
          });
          return;
        }
        const matchedItem = stickerCatalog.find((sc) => sc.id === obj.id);
        if (matchedItem && !validObjects.some((v) => v.id === matchedItem.id)) {
          validObjects.push({
            ...obj,
            type: matchedItem.type,
            label: matchedItem.label,
            width_mm: matchedItem.width_mm,
            height_mm: matchedItem.height_mm,
            z_index: obj.z_index || 10,
          });
        }
      });

      lockedPhotos.forEach((lp, idx) => {
        if (!validObjects.some((o) => o.id === lp.id)) {
          validObjects.push({
            ...lp,
            center_x: idx === 0 ? 95 : 205,
            center_y: idx === 0 ? 115 : 215,
            rotation_degrees: idx === 0 ? -2 : 2,
            z_index: 1,
          });
        }
      });

      layout.objects = validObjects;
    }

    const clampToMargin = (obj) => {
      const isPhoto = obj.type === 'photo_mat';
      const outerW = isPhoto ? obj.photo_width + 10 : obj.width_mm || 50;
      const outerH = isPhoto ? obj.photo_height + 10 : obj.height_mm || 35;

      const minW = hardMargin + outerW / 2;
      const maxW = canvasSize - hardMargin - outerW / 2;
      const minH = hardMargin + outerH / 2;
      const maxH = canvasSize - hardMargin - outerH / 2;

      if (obj.center_x < minW) obj.center_x = minW;
      if (obj.center_x > maxW) obj.center_x = maxW;
      if (obj.center_y < minH) obj.center_y = minH;
      if (obj.center_y > maxH) obj.center_y = maxH;

      return {
        left: obj.center_x - outerW / 2,
        right: obj.center_x + outerW / 2,
        top: obj.center_y - outerH / 2,
        bottom: obj.center_y + outerH / 2,
        w: outerW,
        h: outerH,
      };
    };

    layout.objects.forEach((obj) => clampToMargin(obj));

    if (!currentLayout || isStartOver) {
      const placedPhotoBoxes = [];
      const photoGap = 10.0;

      const overlapsPhoto = (box) =>
        placedPhotoBoxes.some((p) => {
          const xOverlap = Math.min(box.right, p.right) - Math.max(box.left, p.left);
          const yOverlap = Math.min(box.bottom, p.bottom) - Math.max(box.top, p.top);
          return xOverlap > -photoGap && yOverlap > -photoGap;
        });

      layout.objects
        .filter((o) => o.type === 'photo_mat')
        .forEach((obj) => {
          let box = clampToMargin(obj);
          if (overlapsPhoto(box)) {
            const minX = hardMargin + box.w / 2;
            const maxX = canvasSize - hardMargin - box.w / 2;
            const minY = hardMargin + box.h / 2;
            const maxY = canvasSize - hardMargin - box.h / 2;

            let foundSpot = false;
            for (let y = minY; y <= maxY && !foundSpot; y += 15) {
              for (let x = minX; x <= maxX && !foundSpot; x += 15) {
                obj.center_x = Number(x.toFixed(1));
                obj.center_y = Number(y.toFixed(1));
                box = clampToMargin(obj);
                if (!overlapsPhoto(box)) foundSpot = true;
              }
            }
          }
          placedPhotoBoxes.push(box);
        });

      const placedStickerBoxes = [];
      const hitsPhotoInteriorOrSticker = (sBox) => {
        const hitsPhotoCore = placedPhotoBoxes.some((p) => {
          const coreMarginX = p.w * 0.12;
          const coreMarginY = p.h * 0.12;
          const xOverlap = Math.min(sBox.right, p.right - coreMarginX) - Math.max(sBox.left, p.left + coreMarginX);
          const yOverlap = Math.min(sBox.bottom, p.bottom - coreMarginY) - Math.max(sBox.top, p.top + coreMarginY);
          return xOverlap > 0 && yOverlap > 0;
        });
        if (hitsPhotoCore) return true;

        return placedStickerBoxes.some((other) => {
          const xOverlap = Math.min(sBox.right, other.right) - Math.max(sBox.left, other.left);
          const yOverlap = Math.min(sBox.bottom, other.bottom) - Math.max(sBox.top, other.top);
          return xOverlap > -4 && yOverlap > -4;
        });
      };

      layout.objects
        .filter((o) => o.type !== 'photo_mat')
        .forEach((obj) => {
          let sBox = clampToMargin(obj);
          if (hitsPhotoInteriorOrSticker(sBox)) {
            const minX = hardMargin + sBox.w / 2;
            const maxX = canvasSize - hardMargin - sBox.w / 2;
            const minY = hardMargin + sBox.h / 2;
            const maxY = canvasSize - hardMargin - sBox.h / 2;

            let foundSpot = false;
            for (let y = minY; y <= maxY && !foundSpot; y += 15) {
              for (let x = minX; x <= maxX && !foundSpot; x += 15) {
                obj.center_x = Number(x.toFixed(1));
                obj.center_y = Number(y.toFixed(1));
                sBox = clampToMargin(obj);
                if (!hitsPhotoInteriorOrSticker(sBox)) foundSpot = true;
              }
            }
          }
          placedStickerBoxes.push(sBox);
        });
    }

    const bgHex = layout.layout?.base_color || baseCanvasHex;
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasSize} ${canvasSize}" width="100%" height="100%">\n`;
    svgContent += `  <defs><filter id="dropShadow" x="-15%" y="-15%" width="130%" height="130%"><feDropShadow dx="1.2" dy="1.8" stdDeviation="1.6" flood-opacity="0.45"/></filter></defs>\n`;
    svgContent += `  <rect x="0" y="0" width="${canvasSize}" height="${canvasSize}" fill="${bgHex}" stroke="#333" stroke-width="1"/>\n`;
    svgContent += `  <rect class="blueprint-guide" x="${hardMargin}" y="${hardMargin}" width="${canvasSize - hardMargin * 2}" height="${canvasSize - hardMargin * 2}" fill="none" stroke="#ffffff55" stroke-dasharray="4,4" stroke-width="0.6"/>\n`;

    const sortedObjects = [...layout.objects].sort((a, b) => (a.z_index || 1) - (b.z_index || 1));

    sortedObjects.forEach((obj) => {
      const isPhoto = obj.type === 'photo_mat';
      const outerW = isPhoto ? obj.photo_width + 10 : obj.width_mm || 50;
      const outerH = isPhoto ? obj.photo_height + 10 : obj.height_mm || 35;
      const cx = obj.center_x;
      const cy = obj.center_y;
      const rotation = obj.rotation_degrees || 0;

      svgContent += `  <g id="${obj.id}" transform="rotate(${rotation} ${cx} ${cy})">\n`;

      if (obj.type === 'cut_svg') {
        const x = cx - outerW / 2;
        const y = cy - outerH / 2;
        svgContent += `    <svg x="${x}" y="${y}" width="${outerW}" height="${outerH}" viewBox="0 0 100 100" filter="url(#dropShadow)">__VECTOR_SVG_${obj.id}__</svg>\n`;
        svgContent += `    <rect class="blueprint-layer" x="${x}" y="${y}" width="${outerW}" height="${outerH}" fill="none" stroke="#ef4444" stroke-dasharray="2,2" stroke-width="0.9"/>\n`;
        svgContent += `    <text class="blueprint-layer" x="${cx}" y="${y - 3}" fill="#fca5a5" font-family="sans-serif" font-size="5.5" font-weight="bold" text-anchor="middle">CUT SVG: ${obj.label}</text>\n`;
      } else if (obj.type === 'sticker') {
        const x = cx - outerW / 2;
        const y = cy - outerH / 2;
        svgContent += `    <image class="visual-layer" href="__STICKER_DATA_${obj.id}__" x="${x}" y="${y}" width="${outerW}" height="${outerH}" preserveAspectRatio="xMidYMid meet" filter="url(#dropShadow)" />\n`;
        svgContent += `    <rect class="blueprint-layer" x="${x}" y="${y}" width="${outerW}" height="${outerH}" fill="#f59e0b22" stroke="#f59e0b" stroke-dasharray="3,2" stroke-width="1.2" rx="2"/>\n`;
        svgContent += `    <text class="blueprint-layer" x="${cx}" y="${cy}" fill="#fef3c7" stroke="#000" stroke-width="0.3" font-family="sans-serif" font-size="6.5" font-weight="bold" text-anchor="middle" dominant-baseline="middle">STICKER: ${obj.label || obj.id}</text>\n`;
      } else {
        const innerW = obj.photo_width - 5;
        const innerH = obj.photo_height - 5;
        const innerX = cx - innerW / 2;
        const innerY = cy - innerH / 2;
        const matColor = obj.mat_color || defaultMatHex;

        svgContent += `    <rect x="${cx - outerW / 2}" y="${cy - outerH / 2}" width="${outerW}" height="${outerH}" fill="${matColor}" stroke="#ef4444" stroke-width="1.2" filter="url(#dropShadow)" />\n`;
        svgContent += `    <rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" fill="#18181b" stroke="#22c55e" stroke-width="0.9" />\n`;
        svgContent += `    <image class="visual-layer" href="__PHOTO_DATA_${obj.id}__" x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" preserveAspectRatio="xMidYMid slice" />\n`;
        svgContent += `    <circle class="blueprint-layer" cx="${cx}" cy="${cy}" r="9" fill="#000000aa" />\n`;
        svgContent += `    <text class="blueprint-layer" x="${cx}" y="${cy}" fill="white" font-family="sans-serif" font-size="10" font-weight="bold" text-anchor="middle" dominant-baseline="middle" transform="rotate(${-rotation} ${cx} ${cy})">Photo #${obj.display_number || 1}</text>\n`;
      }

      svgContent += `  </g>\n`;
    });

    svgContent += `</svg>`;

    return Response.json({
      svg: svgContent,
      json: JSON.stringify(layout, null, 2),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}