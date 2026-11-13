import {
  analyzePhotosForTheme,
  detectStickersOnSheet,
  locateSheetAndPapers,
  vectorizeCutout,
} from '@/lib/cloudVision';
import { generateOrPatchLayout } from '@/lib/localDraftsman';
import { compileLayoutToSvg } from '@/lib/svgCompiler';

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
      const result = await analyzePhotosForTheme(photos);
      return Response.json(result);
    }

    if (action === 'locate_sheet_and_papers') {
      const result = await locateSheetAndPapers(supplyImage);
      return Response.json(result);
    }

    if (action === 'detect_stickers_on_sheet') {
      const result = await detectStickersOnSheet(sheetOnlyImage);
      return Response.json(result);
    }

    if (action === 'vectorize_cutout') {
      const result = await vectorizeCutout(cropImage, label, palette);
      return Response.json(result);
    }

    const { layout, defaultMatHex } = await generateOrPatchLayout({
      messages,
      currentLayout,
      photos,
      extractedInventory,
    });

    const svgContent = compileLayoutToSvg(layout, defaultMatHex);
    return Response.json({
      svg: svgContent,
      json: JSON.stringify(layout, null, 2),
    });
  } catch (error) {
    const status = error?.status || 500;
    return Response.json({ error: error?.message || 'Internal Server Error' }, { status });
  }
}
