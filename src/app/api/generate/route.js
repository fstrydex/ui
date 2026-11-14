import {
  analyzePhotosForTheme,
  detectStickersOnSheet,
  locateSheetAndPapers,
  vectorizeCutout,
} from '@/lib/cloudVision';
import { loadStarredLayouts, saveStarredLayout } from '@/lib/layoutMemory';
import { generateOrPatchLayout } from '@/lib/localDraftsman';
import { compileLayoutToSvg } from '@/lib/svgCompiler';

export async function GET() {
  try {
    const all = await loadStarredLayouts();
    return Response.json({ totalStarred: all.length });
  } catch (error) {
    return Response.json({ error: error?.message || 'Failed to load library' }, { status: 500 });
  }
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

    if (action === 'analyze_photos') {
      return Response.json(await analyzePhotosForTheme(photos));
    }

    if (action === 'locate_sheet_and_papers') {
      return Response.json(await locateSheetAndPapers(supplyImage));
    }

    if (action === 'detect_stickers_on_sheet') {
      return Response.json(await detectStickersOnSheet(sheetOnlyImage));
    }

    if (action === 'vectorize_cutout') {
      return Response.json(await vectorizeCutout(cropImage, label, palette));
    }

    if (action === 'star_layout') {
      const parsedLayout =
        typeof currentLayout === 'string' ? JSON.parse(currentLayout) : currentLayout;
      const { savedEntry, totalStarred } = await saveStarredLayout({
        layout: parsedLayout,
        photos,
        theme: body.theme || 'Scrapbook Page',
        prompt: body.prompt || '',
      });
      return Response.json({ ok: true, savedEntry, totalStarred });
    }

    const { layout, defaultMatHex, usedModel, designNotes, archetype } =
      await generateOrPatchLayout({
        messages,
        currentLayout,
        photos,
        extractedInventory,
      });

    const svgContent = compileLayoutToSvg(layout, defaultMatHex);
    return Response.json({
      svg: svgContent,
      json: JSON.stringify(layout, null, 2),
      usedModel,
      designNotes,
      archetype,
    });
  } catch (error) {
    const status = error?.status || 500;
    return Response.json({ error: error?.message || 'Internal Server Error' }, { status });
  }
}
