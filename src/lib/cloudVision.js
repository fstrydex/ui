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

export function dataUrlToPart(dataUrl, fallbackMime = 'image/jpeg') {
  const matches = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  const mimeType = matches ? matches[1] : fallbackMime;
  const base64Data = matches
    ? matches[2]
    : dataUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
  return { inlineData: { data: base64Data, mimeType } };
}

export async function callGeminiJson(prompt, imageParts, temperature = 0.1) {
  if (!process.env.GEMINI_API_KEY) {
    throw createHttpError('GEMINI_API_KEY is missing in .env.local', 500);
  }

  const parts = Array.isArray(imageParts) ? [prompt, ...imageParts] : [prompt, imageParts];
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
Suggest an evocative scrapbook page theme, a coordinated 3-color cardstock palette (1 base_canvas and 2 photo_mat colors with hex codes that complement the photos' lighting, tones, and subject), and a concise 1-2 sentence summary explaining why this palette fits the photos.

Return pure JSON:
{
  "theme": "Short evocative theme title",
  "recommended_palette": [
    { "name": "Color Name", "hex": "#1F324C", "role": "base_canvas" },
    { "name": "Color Name", "hex": "#A4C6D8", "role": "photo_mat" },
    { "name": "Color Name", "hex": "#F4F1E6", "role": "photo_mat" }
  ],
  "summary": "Brief explanation of the mood and color pairing."
}`;

  const { data, usedModel } = await callGeminiJson(prompt, imageParts, 0.2);
  return {
    theme: data?.theme || 'Timeless Memories',
    recommended_palette: Array.isArray(data?.recommended_palette) ? data.recommended_palette : [],
    summary: data?.summary || 'Recommended palette matched to your uploaded photos.',
    usedModel,
  };
}

export async function locateSheetAndPapers(supplyImage) {
  if (!supplyImage) {
    throw createHttpError('No supply image provided.', 400);
  }

  const imagePart = dataUrlToPart(supplyImage, 'image/jpeg');
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
  return { ...data, usedModel };
}

export async function detectStickersOnSheet(sheetOnlyImage) {
  if (!sheetOnlyImage) {
    throw createHttpError('No cropped sheet image provided.', 400);
  }

  const imagePart = dataUrlToPart(sheetOnlyImage, 'image/jpeg');
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
  { "box_2d": [ymin, xmin, ymax, xmax], "label": "descriptive name", "category": "title|floral|banner|heart|tag", "ink_type": "dark_or_floral" }
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
