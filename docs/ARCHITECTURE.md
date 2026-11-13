# Scrapbook AI — System Architecture & Data Contracts

## 1. High-Level System Design

Scrapbook AI uses a **Hybrid Cloud-Vision + Local-CAD** architecture designed to maximize visual intelligence while keeping spatial coordinate math deterministic, fast, and free.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                        NEXT.JS FRONTEND (Browser)                          │
│                                                                            │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌───────────────────┐  │
│  │    IntakeSidebar     │  │     CanvasStage     │  │   InventoryTray   │  │
│  │ (Progressive Wizard) │  │ (12x12" Dual-View)  │  │ (Papers/Stickers) │  │
│  └──────────┬───────────┘  └──────────▲──────────┘  └─────────▲─────────┘  │
│             │                         │                       │            │
│             ▼                         │                       │            │
│  ┌────────────────────────────────────┴───────────────────────┴─────────┐  │
│  │            Client-Side Canvas & Contour Engine (contourCutter.js)    │  │
│  │  • EXIF Orientation Normalizer (caps at 1600px before API upload)    │  │
│  │  • Stage-1 Sheet Cropper (removes wood table & background cardstock) │  │
│  │  • Foreground-Seeded Contour Die-Cut Mask + Connected-Component      │  │
│  │    Neighbor Eraser (6px contour border, 100% transparent exterior)   │  │
│  └────────────────────────────────────┬─────────────────────────────────┘  │
└───────────────────────────────────────┼────────────────────────────────────┘
                                        │ HTTP POST /api/generate
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                        NODE.JS BACKEND (/api/generate)                     │
│                                                                            │
│  ┌────────────────────────────────────┐  ┌──────────────────────────────┐  │
│  │     cloudVision.js (Cloud AI)      │  │  localDraftsman.js (Ollama)  │  │
│  │  Model: gemini-4-hydrogen cascade  │  │  Model: llama3.1:8b (JSON)   │  │
│  │  • analyzePhotosForTheme           │  │  • Initial Layout Placement  │  │
│  │  • locateSheetAndPapers (Pass 1)   │  │  • Follow-Up Delta Patching  │  │
│  │  • detectStickersOnSheet (Pass 2)  │  │  • Relational Position Math  │  │
│  │  • vectorizeCutout (Bezier SVG)    │  │  • 2D Grid Collision Solver  │  │
│  └────────────────────────────────────┘  └──────────────┬───────────────┘  │
│                                                         │                  │
│                                                         ▼                  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    svgCompiler.js (CAD / SVG Engine)                 │  │
│  │  • 15mm Hard Margin Clamping & Hallucinated-ID Sanitizer             │  │
│  │  • Dual-Layer SVG Builder (.visual-layer vs .blueprint-layer)        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Progressive Frontend User Flow & State Machine

The UI follows a 3-column workspace (`IntakeSidebar` on left, `CanvasStage` in center, `InventoryTray` on right) driven by a progressive workflow:

### Stage A: Photo Intake & Theme Discovery
1. **Initial / Reset State:** Only the **Photos** box and **Chat** box are visible in the left sidebar.
2. **Photo Loading:** User uploads real photos (auto-detected into Portrait `4x6"`, Landscape `4x3"`, or Square `4x4"` based on aspect ratio) or uses blank photo placeholders.
3. **50% Area Gatekeeper:** Real-time meter calculates `sum((w_in * 25.4 + 10) * (h_in * 25.4 + 10)) / (304.8 * 304.8)`.
4. **AI Photo Scan:**
   - If real photos (`dataUrl !== null`) are loaded, the default prompt offers to scan the photos (`action: "analyze_photos"`) and recommend a color palette and scrapbook theme.
   - If only blank placeholders exist, the system informs the user that a photo-based color/theme recommendation requires real photo uploads, or lets them proceed directly to supplies.

### Stage B: Physical Supply Scanning & Contour Extraction
1. Once photos are evaluated (or skipped), the **Scan & Cut Supplies** panel appears in the left sidebar.
2. When the user uploads a photo of their physical supplies (sticker sheet + cardstock on a table):
   - **Step 1 (Client):** `normalizeImageDataUrl()` draws the file onto an HTML5 `<canvas>` (max 1600px) to strip EXIF rotation metadata so `0..1000` coordinates match browser pixels 1:1.
   - **Step 2 (Server `locate_sheet_and_papers`):** Cloud Vision finds `sheet_box_2d: [ymin, xmin, ymax, xmax]` of the white/cream sticker sheet (ignoring the wooden table and cardstock) and extracts the cardstock hex palette (`papers`).
   - **Step 3 (Client):** `cropBoxToDataUrl()` crops the normalized image to `sheet_box_2d`, producing a clean, wood-free image of the sticker sheet alone.
   - **Step 4 (Server `detect_stickers_on_sheet`):** Cloud Vision detects individual stickers `[ymin, xmin, ymax, xmax]` (0..1000) relative to the clean sheet image.
   - **Step 5 (Client `createTrueStickerCutout`):** Each sticker box is cropped with `6px` padding, masked with a `6px` contour-following border, cleaned of disconnected neighbor fragments at the crop edges, and placed into the right-hand **Inventory Tray**.

### Stage C: Hybrid AI Layout + Interactive Direct Manipulation
1. **AI Generation & Delta Patching:** Users prompt the AI to arrange the page or move items relative to one another (`"Put sticker_1 centered above photo_1"`).
2. **On-Demand SVG Vectorization (`✦ Make Cuttable SVG`):** Clicking the button on any cropped sticker sends its PNG to `action: "vectorize_cutout"`, generating a multi-layer cubic Bezier `<svg>` path mapped to the user's cardstock palette and adding it to the inventory as `item_type: "cut_svg"`.
3. **Interactive Mouse Drag-and-Drop (Planned/Active Frontend Layer):**
   - **Tray-to-Canvas Drop:** Dragging any sticker or `cut_svg` card from `InventoryTray` onto `CanvasStage` converts client mouse `(clientX, clientY)` into SVG viewBox coordinates `(0..304.8mm)` via `svgElement.getScreenCTM().inverse()`, appending the item to `layout.objects`.
   - **On-Canvas Dragging:** Dragging any `<g id="...">` element on the canvas updates its `center_x` and `center_y` in real time, clamps to the `15mm` safety margin, and syncs the updated JSON back into the latest assistant message state so subsequent AI chat commands respect the user's manual mouse adjustments.

---

## 3. Data Schemas & API Contracts

### 3.1 Inventory State Schema (`inventory`)

```json
{
  "theme": "Romantic / Wedding",
  "sheet_box_2d": [82, 125, 835, 675],
  "papers": [
    {
      "id": "paper_1",
      "name": "Navy Blue Cardstock",
      "hex": "#1F324C",
      "role": "base_canvas"
    },
    {
      "id": "paper_2",
      "name": "Light Blue Patterned Paper",
      "hex": "#A4C6D8",
      "role": "photo_mat"
    },
    {
      "id": "paper_3",
      "name": "Warm Cream Cardstock",
      "hex": "#F4F1E6",
      "role": "photo_mat"
    }
  ],
  "cutouts": [
    {
      "id": "sticker_1",
      "label": "cursive together script",
      "category": "title",
      "item_type": "sticker",
      "box_2d": [135, 225, 240, 410],
      "width_mm": 90,
      "height_mm": 38,
      "cropUrl": "data:image/png;base64,..."
    },
    {
      "id": "svg_sticker_4",
      "label": "5-Petal Flower (Cut SVG)",
      "category": "floral",
      "item_type": "cut_svg",
      "width_mm": 45,
      "height_mm": 45,
      "svgInner": "<path d='M50 10 C60 10...' fill='#F4F1E6'/><circle cx='50' cy='50' r='12' fill='#A4C6D8'/>"
    }
  ]
}
```

### 3.2 Layout State Schema (`layout`)

Stored as serialized JSON in the assistant's message history and synced with interactive canvas dragging:

```json
{
  "layout": {
    "canvas_width": 304.8,
    "canvas_height": 304.8,
    "unit": "mm",
    "base_color": "#1F324C"
  },
  "objects": [
    {
      "id": "photo_1",
      "type": "photo_mat",
      "photo_width": 101.6,
      "photo_height": 76.2,
      "display_number": 1,
      "center_x": 95.0,
      "center_y": 115.0,
      "rotation_degrees": -2,
      "z_index": 1,
      "mat_color": "#A4C6D8"
    },
    {
      "id": "sticker_1",
      "type": "sticker",
      "label": "cursive together script",
      "width_mm": 90.0,
      "height_mm": 38.0,
      "center_x": 220.0,
      "center_y": 65.0,
      "rotation_degrees": 2,
      "z_index": 10
    },
    {
      "id": "svg_sticker_4",
      "type": "cut_svg",
      "label": "5-Petal Flower (Cut SVG)",
      "width_mm": 45.0,
      "height_mm": 45.0,
      "center_x": 165.0,
      "center_y": 48.0,
      "rotation_degrees": 0,
      "z_index": 12
    }
  ]
}
```

### 3.3 Follow-Up Delta Patch Schema (`patchData`)

Used by `localDraftsman.js` on follow-up turns so untouched objects never shift:

```json
{
  "updates": [
    {
      "id": "sticker_1",
      "rotation_degrees": 0,
      "relative_to": "photo_1",
      "position": "above",
      "gap_mm": 5.0
    }
  ]
}
```

---

## 4. Image Processing Algorithms (`contourCutter.js`)

### 4.1 Foreground-Seeded Contour Die-Cut Algorithm
1. **Background Estimation:** Sort pixels in the cropped sticker box by luminance (`0.299R + 0.587G + 0.114B`) and average the brightest 25% of pixels to obtain the true local sticker-sheet backing color `(bgR, bgG, bgB)`.
2. **Foreground Ink Detection:** Mark pixels with Euclidean RGB distance `> 22` from `(bgR, bgG, bgB)` as foreground ink (`isInk = 1`), ignoring a `3px` outer border margin so neighbor bleed on the crop boundary doesn't seed the mask. (Fallback to threshold `> 11` if `inkCount < 1.5%` of crop area for low-contrast cream-on-white motifs).
3. **Connected-Component Neighbor Pruning (Fixes Cut-Off Neighbor Flowers):**
   - Group `isInk` pixels (or dilated foreground islands) into connected components using 8-way BFS.
   - Calculate each island's bounding box and distance to the crop's center `(w/2, h/2)`.
   - Discard any disconnected component that touches the outer `4px` crop boundary AND whose center of mass lies in the outer 20% perimeter of the box (e.g., the top half of the two flowers underneath `"together"`).
4. **Morphological Dilation (`dieCutBorderPx = 6`):** Expand surviving foreground pixels outward by a `6px` radius to form the contour-hugging cream sticker border (`inSticker = 1`).
5. **Exterior Flood-Fill:** Flood-fill from the outer perimeter (`x=0, w-1`, `y=0, h-1`) through pixels where `inSticker === 0` to mark `isOutside = 1`. Any pixel with `isOutside === 1` gets `alpha = 0` (transparent), preserving enclosed interior counters (like the loops of `'o'`, `'g'`, `'e'`, or inside framed tags).