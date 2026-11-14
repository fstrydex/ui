import { GoogleGenerativeAI } from '@google/generative-ai';

export const VISION_MODEL_CASCADE = [
  'gemini-4-hydrogen',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-2.5-flash',
];

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function createHttpError(message, status = 500) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function unwrapJsonArray(raw, preferredKeys = []) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    for (const key of preferredKeys) {
      if (Array.isArray(raw[key])) return raw[key];
    }
    const firstArr = Object.values(raw).find((v) => Array.isArray(v));
    if (Array.isArray(firstArr)) return firstArr;
  }
  return [];
}

export function normalizeHex(hex, fallback = '#D8C9B4') {
  if (typeof hex !== 'string') return fallback;
  const cleaned = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    const expanded = cleaned
      .split('')
      .map((c) => c + c)
      .join('');
    return `#${expanded.toUpperCase()}`;
  }
  return fallback;
}

export function dataUrlToPart(dataUrl, fallbackMime = 'image/jpeg') {
  const matches = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  const mimeType = matches ? matches[1] : fallbackMime;
  const base64Data = matches
    ? matches[2]
    : dataUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
  return { inlineData: { data: base64Data, mimeType } };
}

export async function callGeminiJson(prompt, imageParts = [], temperature = 0.1) {
  if (!process.env.GEMINI_API_KEY) {
    throw createHttpError('GEMINI_API_KEY is missing in .env.local', 500);
  }

  const parts = !imageParts
    ? [prompt]
    : Array.isArray(imageParts)
    ? imageParts.length > 0
      ? [prompt, ...imageParts]
      : [prompt]
    : [prompt, imageParts];
  let lastErr = null;

  for (const modelName of VISION_MODEL_CASCADE) {
    const startMs = Date.now();
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature,
        },
      });
      const result = await model.generateContent(parts);
      const usedModel = modelName;
      const usage = result.usageMetadata || result.response?.usageMetadata;
      console.log(
        `[Gemini API] Model: ${usedModel} | Prompt Tokens: ${usage?.promptTokenCount} | Output Tokens: ${usage?.candidatesTokenCount} | Time: ${Date.now() - startMs}ms`
      );
      return {
        data: JSON.parse(result.response.text()),
        usedModel,
      };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || createHttpError('All vision models in cascade failed.', 500);
}

export async function analyzePhotosForTheme(photos = []) {
  const realPhotos = photos.filter((p) => typeof p?.dataUrl === 'string' && p.dataUrl.length > 0);
  if (realPhotos.length === 0) {
    throw createHttpError('No real photo uploads provided for theme analysis.', 400);
  }

  const imageParts = realPhotos.map((p) => dataUrlToPart(p.dataUrl, 'image/jpeg'));
  const prompt = `Examine these user scrapbook photos carefully.
Suggest an evocative scrapbook page theme, a coordinated 3-color cardstock palette (1 base_canvas and 2 photo_mat colors with BOTH descriptive color names and accurate #RRGGBB hex codes that complement the photos' lighting, tones, and subject), and a concise 1-2 sentence summary explaining why this palette fits the photos.

Return pure JSON:
{
  "theme": "Short evocative theme title",
  "recommended_palette": [
    { "name": "Deep Navy Blue", "hex": "#1F324C", "role": "base_canvas" },
    { "name": "Dusty Sky Blue", "hex": "#A4C6D8", "role": "photo_mat" },
    { "name": "Warm Ivory Cream", "hex": "#F4F1E6", "role": "photo_mat" }
  ],
  "summary": "Brief explanation of the mood and color pairing."
}`;

  const { data, usedModel } = await callGeminiJson(prompt, imageParts, 0.2);
  const palette = Array.isArray(data?.recommended_palette)
    ? data.recommended_palette.map((c, idx) => ({
        name: c?.name || `Palette Color ${idx + 1}`,
        hex: normalizeHex(c?.hex, idx === 0 ? '#24344D' : '#F2EFE4'),
        role: c?.role || (idx === 0 ? 'base_canvas' : 'photo_mat'),
      }))
    : [];

  return {
    theme: data?.theme || 'Timeless Memories',
    recommended_palette: palette,
    summary: data?.summary || 'Recommended palette matched to your uploaded photos.',
    usedModel,
  };
}

export async function locateSheetAndPapers(supplyImage) {
  if (!supplyImage) {
    throw createHttpError('No supply image provided.', 400);
  }

  const imagePart = dataUrlToPart(supplyImage, 'image/jpeg');
  const locatePrompt = `Examine this overhead flat-lay photo of scrapbooking supplies on a table carefully and systematically.
Coordinates [ymin, xmin, ymax, xmax] must be scaled 0..1000 relative to the full image.

1. CARDSTOCK & PATTERNED PAPERS ("papers"):
   Scan across the fanned stack from left to right and top to bottom so you catch EVERY distinct sheet (solid, textured, speckled, plaid, striped, or printed — typically 4 to 8 sheets).
   For EACH distinct paper sheet, return:
   - "name": Full paper name (e.g. "Crimson Red Textured Cardstock", "Tan & Red Tartan Plaid Paper")
   - "color_name": Descriptive color name (e.g. "Crimson Red", "Warm Oatmeal Cream", "Tan & Crimson Plaid")
   - "hex": Accurate primary #RRGGBB color code
   - "secondary_hex": Secondary/accent #RRGGBB hex code (especially important for plaid, speckled, striped, or patterned papers; null if solid)
   - "pattern_type": "solid" | "textured" | "plaid" | "speckled" | "striped" | "floral"
   - "role": "base_canvas" | "photo_mat"
   - "sample_box_2d": [ymin, xmin, ymax, xmax] pointing to an UNOBSTRUCTED, clean visible patch of THAT specific paper (no stickers, tags, or table overlapping inside this box!).

2. STICKER & DIE-CUT BACKING SHEETS ("sticker_sheets"):
   Find ALL white/cream backing sheets holding multiple stickers or die-cuts (there may be 1, 2, or more separate sheets!). Exclude the table surface.

3. LOOSE PHYSICAL SUPPLIES ("loose_supplies"):
   Find standalone physical embellishments sitting loose on the cardstock or table OUTSIDE the sticker backing sheets and NOT tape rolls:
   - Luggage/kraft tags (category: "tag")
   - Lined prompt/journaling cards (category: "journal_card")
   - Mini envelopes (category: "envelope")
   - Chipboard word blocks/strips (category: "chipboard")
   - Loose round wax-seal/badge tokens (category: "badge")
   Keep each "box_2d" tight around the individual loose item.

4. WASHI TAPE ROLLS ("washi_tapes"):
   Find any coiled washi tape rolls visible in the photo. For each roll, identify its descriptive "color_name", "primary_hex", "secondary_hex", "pattern_type" ("solid"|"plaid"|"striped"|"speckled"|"polka"), full roll "box_2d", and "sample_box_2d" on the colored/patterned tape rim.

Return pure JSON:
{
  "theme": "Evocative Kit Theme",
  "papers": [
    {
      "id": "paper_1",
      "name": "Crimson Red Textured Cardstock",
      "color_name": "Crimson Red",
      "hex": "#9E222B",
      "secondary_hex": null,
      "pattern_type": "textured",
      "role": "base_canvas",
      "sample_box_2d": [320, 20, 460, 85]
    }
  ],
  "sticker_sheets": [
    { "id": "sheet_1", "label": "Main Sticker Sheet", "box_2d": [250, 140, 845, 505] }
  ],
  "loose_supplies": [
    { "id": "supply_1", "label": "Kraft Twine Tag", "category": "tag", "box_2d": [410, 780, 630, 920] }
  ],
  "washi_tapes": [
    {
      "id": "tape_1",
      "label": "Crimson Red Washi Tape",
      "color_name": "Crimson Red",
      "primary_hex": "#9E222B",
      "secondary_hex": "#7A1820",
      "pattern_type": "solid",
      "box_2d": [770, 745, 925, 860],
      "sample_box_2d": [815, 760, 875, 805]
    }
  ]
}`;

  const { data, usedModel } = await callGeminiJson(locatePrompt, imagePart, 0.1);

  const papers = unwrapJsonArray(data?.papers, ['papers']).map((p, idx) => ({
    id: p?.id || `paper_${idx + 1}`,
    name: p?.name || p?.color_name || `Cardstock ${idx + 1}`,
    color_name: p?.color_name || p?.name || `Color ${idx + 1}`,
    hex: normalizeHex(p?.hex, idx === 0 ? '#24344D' : '#F2EFE4'),
    secondary_hex: p?.secondary_hex ? normalizeHex(p.secondary_hex, null) : null,
    pattern_type: p?.pattern_type || 'solid',
    role: p?.role || (idx === 0 ? 'base_canvas' : 'photo_mat'),
    sample_box_2d: Array.isArray(p?.sample_box_2d) && p.sample_box_2d.length === 4 ? p.sample_box_2d : null,
  }));

  const rawSheets = unwrapJsonArray(data?.sticker_sheets, ['sticker_sheets', 'sheets']);
  const sticker_sheets =
    rawSheets.length > 0
      ? rawSheets
          .filter((s) => Array.isArray(s?.box_2d) && s.box_2d.length === 4)
          .map((s, idx) => ({
            id: s.id || `sheet_${idx + 1}`,
            label: s.label || `Sticker Sheet ${idx + 1}`,
            box_2d: s.box_2d,
          }))
      : Array.isArray(data?.sheet_box_2d) && data.sheet_box_2d.length === 4
      ? [{ id: 'sheet_1', label: 'Sticker Sheet 1', box_2d: data.sheet_box_2d }]
      : [];

  const loose_supplies = unwrapJsonArray(data?.loose_supplies, ['loose_supplies', 'ephemera', 'supplies'])
    .filter((item) => Array.isArray(item?.box_2d) && item.box_2d.length === 4)
    .map((item, idx) => ({
      id: item.id || `supply_${idx + 1}`,
      label: item.label || `Supply ${idx + 1}`,
      category: item.category || 'motif',
      box_2d: item.box_2d,
    }));

  const washi_tapes = unwrapJsonArray(data?.washi_tapes, ['washi_tapes', 'tapes']).map((t, idx) => ({
    id: t?.id || `tape_${idx + 1}`,
    label: t?.label || `${t?.color_name || 'Washi'} Tape`,
    color_name: t?.color_name || t?.label || `Washi Color ${idx + 1}`,
    primary_hex: normalizeHex(t?.primary_hex || t?.hex, papers[0]?.hex || '#9E222B'),
    secondary_hex: t?.secondary_hex ? normalizeHex(t.secondary_hex, '#C2B29C') : null,
    pattern_type: t?.pattern_type || 'solid',
    box_2d: Array.isArray(t?.box_2d) && t.box_2d.length === 4 ? t.box_2d : null,
    sample_box_2d: Array.isArray(t?.sample_box_2d) && t.sample_box_2d.length === 4 ? t.sample_box_2d : null,
  }));

  return {
    theme: data?.theme || 'Scrapbook Page',
    sheet_box_2d: sticker_sheets[0]?.box_2d || [50, 100, 850, 700],
    sticker_sheets,
    papers,
    loose_supplies,
    washi_tapes,
    usedModel,
  };
}

export async function detectStickersOnSheet(sheetOnlyImage) {
  if (!sheetOnlyImage) {
    throw createHttpError('No cropped sheet image provided.', 400);
  }

  const imagePart = dataUrlToPart(sheetOnlyImage, 'image/jpeg');
  const boxPrompt = `This image is a cropped view of a single scrapbook sticker or die-cut backing sheet.
Detect ALL distinct, well-separated individual stickers or die-cuts visible on this sheet (up to 24 items) regardless of theme:
- Word titles, quotes, and sentiment strips
- Ribbon banners and pennants / bunting flags
- Illustrations, wildlife, animals, florals, botanicals, stars, or scenic icons
- Badges, seals, frames, scalloped tags, compasses, and arrows
- Ignore sheet header branding text like "Scrapbook Supplies" along the top header margin if it is part of the packaging header rather than a peelable sticker.

CRITICAL BOUNDING BOX RULES:
- Coordinates [ymin, xmin, ymax, xmax] are scaled 0 to 1000 relative to THIS cropped sheet image.
- Keep each box tight around that single sticker/die-cut so neighboring items do not bleed into the box!

Return pure JSON:
{
  "cutouts": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "label": "descriptive name (e.g. 'Adventure Awaits Bison' or 'Crimson Bunting Flag')",
      "category": "title|banner|motif|tag|flag|badge|floral|arrow"
    }
  ]
}`;

  const { data: rawBoxes, usedModel } = await callGeminiJson(boxPrompt, imagePart, 0.05);
  const parsedList = unwrapJsonArray(rawBoxes, ['cutouts', 'stickers', 'items', 'boxes', 'results']);

  const cutouts = parsedList
    .filter((item) => Array.isArray(item?.box_2d) && item.box_2d.length === 4)
    .slice(0, 24)
    .map((item, idx) => {
      const [ymin, xmin, ymax, xmax] = item.box_2d;
      const estW = Math.max(22, Math.min(115, Math.round(((xmax - xmin) / 1000) * 210)));
      const estH = Math.max(16, Math.min(105, Math.round(((ymax - ymin) / 1000) * 240)));
      return {
        id: `sticker_${idx + 1}`,
        label: item.label || `Sticker ${idx + 1}`,
        category: item.category || 'motif',
        box_2d: [ymin, xmin, ymax, xmax],
        width_mm: estW,
        height_mm: estH,
      };
    });

  return { cutouts, usedModel };
}

export async function vectorizeCutout(cropImage, label = '', palette = []) {
  if (!cropImage) {
    throw createHttpError('No crop image provided.', 400);
  }

  const imagePart = dataUrlToPart(cropImage, 'image/png');
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

  const { data: parsedVector, usedModel } = await callGeminiJson(vectorPrompt, imagePart, 0.15);
  return { vector: parsedVector, usedModel };
}

export async function designInitialLayoutWithCloud({
  lockedPhotos = [],
  stickerCatalog = [],
  baseCanvasHex = '#24344D',
  theme = 'Scrapbook Page',
  userRequest = 'Design a balanced scrapbook page.',
  starredExamples = [],
}) {
  const examplesBlock =
    starredExamples.length > 0
      ? `\nSTARRED REFERENCE LAYOUTS (Learn from these human-approved compositions):\n${JSON.stringify(starredExamples, null, 2)}`
      : '';

  const prompt = `You are a Master Scrapbook Art Director designing a 304.8mm x 304.8mm (12x12") layout (origin (0,0) top-left, 15.0mm outer safety margin).
THEME: ${theme} | BASE CARDSTOCK: ${baseCanvasHex}
USER REQUEST: ${userRequest}

COMPOSITION RULES:
1. PHOTO FOCAL BLOCK: Place EVERY photo from LOCKED PHOTO INVENTORY using balanced scrapbook archetypes (Diagonal Counterbalance, Centered Story Pair, Hero + Supporting Accent, or Asymmetric Triangle). Use subtle -3 to 3 degree tilts and leave at least 12mm breathing room between photo mats. Never alter photo_width or photo_height.
2. TITLE ANCHOR: Pick 1 "title" or "banner" sticker (if available) and anchor it in the primary open counter-space (e.g., anchor_zone "above", "below", "left", or "right" of a photo) at z_index 15.
3. VISUAL TRIANGLE, CORNER CLUSTERS & WASHI TAPE: Never scatter embellishments randomly in open space!
   - Group 3 to 6 items from AVAILABLE INVENTORY CUTOUTS (floral, heart, tag, journal_card, envelope, chipboard, badge, motif) into 2 or 3 tight corner clusters anchored to photo corners using "anchor_to": "<photo_id>" and "anchor_zone": "overlap_top_left" | "overlap_top_right" | "overlap_bottom_left" | "overlap_bottom_right" | "above" | "below" | "left" | "right".
   - If "washi_tape" items are present in AVAILABLE INVENTORY CUTOUTS, place 1 or 2 diagonal washi tape strips across opposite photo corners ("anchor_zone": "overlap_top_left" / "overlap_top_right" / "overlap_bottom_left" / "overlap_bottom_right", "rotation_degrees": -38 or 38, "z_index": 14) to visually tape the photos onto the mat!
4. ONLY use exact IDs from LOCKED PHOTO INVENTORY and AVAILABLE INVENTORY CUTOUTS.

LOCKED PHOTO INVENTORY:
${JSON.stringify(lockedPhotos, null, 2)}

AVAILABLE INVENTORY CUTOUTS:
${JSON.stringify(stickerCatalog, null, 2)}
${examplesBlock}

Return pure JSON:
{
  "archetype": "Name of composition archetype used",
  "design_notes": "1-sentence explanation of the focal flow and cluster triangle",
  "objects": [
    {
      "id": "photo_1",
      "type": "photo_mat",
      "center_x": 95.0,
      "center_y": 110.0,
      "rotation_degrees": -2,
      "z_index": 1
    },
    {
      "id": "sticker_1",
      "type": "sticker",
      "anchor_to": "photo_2",
      "anchor_zone": "above",
      "center_x": 205.0,
      "center_y": 62.0,
      "rotation_degrees": 1,
      "z_index": 15
    }
  ]
}`;

  const { data, usedModel } = await callGeminiJson(prompt, [], 0.25);
  return { data, usedModel };
}
