# AGENTS.md — Scrapbook AI Agent Rules & Constraints

## 1. Project Mission & Core Philosophy
Scrapbook AI is a physical-to-digital layout generator and CAD/Cricut compiler for 12x12-inch (304.8mm × 304.8mm) physical scrapbooking.
- **The Yin-Yang Principle:** The system bridges generative AI creativity with strict deterministic physical reality. Unlike pure image generators (e.g., DALL-E) that hallucinate fake stickers and un-cuttable flat rasters, Scrapbook AI designs exclusively with the user's **actual physical inventory** (real photos, real scanned sticker sheets, real cardstock colors, and vectorized SVG cut-files) and compiles them into exact millimeter coordinates and cut paths.
- **Dual-Layer Output:** Every layout is simultaneously:
  1. **Visual Design Layer ("What You See"):** High-contrast preview showing uploaded photos, colored cardstock mats, drop shadows, contour die-cut sticker PNGs, and layered SVG cutouts.
  2. **Blueprint & Cut-Line Layer ("Behind the Scenes"):** Manufacturing view displaying red outer cardstock cut lines (`#ef4444`), green inner photo window cut lines (`#22c55e`), 15mm safety margins, and orange dashed sticker placement zones (`#f59e0b`).

---

## 2. Tech Stack & Model Architecture
- **Frontend:** Next.js (App Router, `src/app`), React Client Components, Tailwind CSS, HTML5 `<canvas>` for client-side image normalization and pixel-level contour die-cut masking.
- **Backend Runtime:** Next.js API Routes (`src/app/api/generate/route.js`) running on Node.js.
- **Hybrid "Cloud Director + Local Draftsman" AI Pipeline:**
  - **Cloud Vision / Art Director:** Google Gemini API (`@google/generative-ai`), using `gemini-4-hydrogen` as primary with automatic fallback cascade (`['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash']`). Configured via `GEMINI_API_KEY` in `.env.local`.
  - **Local Spatial Draftsman:** Ollama (`http://localhost:11434/api/chat`) running `llama3.1:8b` with `format: "json"` and `keep_alive: "15m"`.

---

## 3. Coding Conventions & File Naming Rules
- **NEVER Name Files After Specific AI Models:** Models change frequently. Use functional, domain-driven module names:
  - GOOD: `src/lib/cloudVision.js`, `src/lib/localDraftsman.js`, `src/lib/svgCompiler.js`, `src/lib/contourCutter.js`
  - BANNED: `geminiVision.js`, `ollamaDraftsman.js`, `llamaHelper.js`
- **Modular File Size Limit:** Keep individual files under ~150–200 lines. Do not dump new UI features or canvas math back into a monolithic `page.js` or `route.js`.
- **Target Directory Structure (`ui/src/`):**
  - `src/lib/cloudVision.js` — Cloud vision calls (photo theme/palette suggestion, 2-stage sticker sheet isolation & detection, sticker-to-SVG vectorization).
  - `src/lib/localDraftsman.js` — Local LLM layout generation, delta-patching, relational positioning solver, and deterministic collision resolution.
  - `src/lib/svgCompiler.js` — Dual-mode SVG string generator (Visual Layer + Blueprint Layer).
  - `src/lib/contourCutter.js` — Client-side `<canvas>` EXIF normalizer, bounding-box cropper, foreground-seeded contour die-cut generator, and connected-component neighbor eraser.
  - `src/components/IntakeSidebar.js` — Left panel (Progressive wizard: Photos -> AI Theme Recommendation -> Supplies Scan -> Chat/Prompting).
  - `src/components/CanvasStage.js` — Center panel (12x12" viewport, Visual/Blueprint toggle, pointer drag-and-drop handlers).
  - `src/components/InventoryTray.js` — Right panel (Detected cardstock swatches, contour-cut sticker grid, `✦ Make Cuttable SVG` trigger, drag sources).

---

## 4. Strict Physical & Mathematical Constraints ("DO NOT TOUCH" Rules)

### Rule 1: Canvas & Coordinate System
- **Canvas Dimensions:** Strictly `304.8mm × 304.8mm` (12 × 12 inches).
- **Origin `(0, 0)`:** Top-Left corner. `(304.8, 304.8)` is Bottom-Right.
- **Inverted Y-Axis Math:**
  - Move UP = **DECREASE** `center_y` (subtract).
  - Move DOWN = **INCREASE** `center_y` (add).
  - Move LEFT = **DECREASE** `center_x` (subtract).
  - Move RIGHT = **INCREASE** `center_x` (add).

### Rule 2: Hard 15.0mm Safety Margin
- Every object (`photo_mat`, `sticker`, `cut_svg`) must be clamped so its outer bounding box never crosses the `15.0mm` outer border:
  - `minX = 15.0 + outerW / 2`, `maxX = 304.8 - 15.0 - outerW / 2`
  - `minY = 15.0 + outerH / 2`, `maxY = 304.8 - 15.0 - outerH / 2`

### Rule 3: 50% Max Photo Mat Area Gatekeeper
- The sum of all photo mat outer areas (`(photo_width + 10mm) * (photo_height + 10mm)`) MUST NOT exceed `50.0%` of total canvas area (`92,903.04 mm²`, so max photo mat area is `46,451.52 mm²`).
- This rule must be enforced on both the client UI (disabling generation when over budget) and the server API (`status: 400`).

### Rule 4: Photo Mat Geometry
- Given a physical photo of `photo_width` × `photo_height` (in mm):
  - **Outer Cardstock Mat (Red Cut Line):** `(photo_width + 10mm) × (photo_height + 10mm)` (5mm mat border on each side).
  - **Inner Window Cutout (Green Cut Line):** `(photo_width - 5mm) × (photo_height - 5mm)` (leaves a 2.5mm lip per side so the physical photo can be taped behind the window frame).
- **Locked Photo Dimensions:** The LLM is NEVER allowed to alter `photo_width`, `photo_height`, or swap portrait/landscape orientation of user photos. Always re-overwrite `photo_width` and `photo_height` from the locked Node.js array after parsing LLM output.

### Rule 5: Deterministic Collision & Relational Math
- **Initial Turn Non-Overlap:** Two `6x4"` landscape mats (`162.4mm` wide each) total `324.8mm` and physically cannot fit side-by-side within the `274.8mm` usable width. Always run the deterministic 2D grid collision resolver on initial layout generation so photos never stack on top of each other and stickers never land on the inner 75% core of a photo.
- **Follow-Up Turns (Delta Patching Only):** Follow-up commands MUST NOT regenerate the full layout from scratch (which causes untouched items to drift). Follow-up turns return an `updates` array patching only modified objects, using the deterministic Relational Solver (`above`, `below`, `left`, `right`, `overlap_top_right`, `overlap_top_left`, `overlap_bottom_right`, `overlap_bottom_left`) in Node.js rather than letting the LLM guess relative millimeter offsets.

---

## 5. Banned Approaches (Never Re-Introduce)
1. **DO NOT use `llama3.2-vision` (`mllama` architecture):** Causes `llama-server process has terminated: unknown model architecture: 'mllama'` on the user's macOS setup and triggers 13GB RAM contention when paired with `llama3.1:8b`.
2. **DO NOT use local `llava` for supply detection:** Hallucinates non-existent tools (like "scissors") from scrapbooking priors and misses background cardstock colors.
3. **DO NOT use OpenAI SDK `/v1` compatibility wrapper for Ollama:** Calling Ollama via `http://localhost:11434/api/chat` natively is required for `format: 'json'`, `keep_alive`, and clean base64 handling.
4. **DO NOT ask an LLM to hand-write "SVG Digital Twins" for all stickers during supply scanning:** LLMs output cartoonish primitive `<rect rx="22"/>` pills and 5-circle blobs that destroy the user's real sticker artwork. Always use the 2-stage photographic crop + contour die-cut pixel filter for stickers, and reserve AI SVG generation strictly for on-demand `✦ Make Cuttable SVG` requests using cubic Bezier paths (`<path d="M... C... Z"/>`).
5. **DO NOT embed raw base64 image strings inside the SVG stored in LLM chat history:** Always use lightweight string tokens (`__PHOTO_DATA_photo_1__`, `__STICKER_DATA_sticker_1__`, `__VECTOR_SVG_svg_sticker_1__`) in the server SVG and inject the heavy DataURLs on the client during rendering.