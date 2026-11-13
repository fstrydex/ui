# Scrapbook AI — Engineering Decision & Debugging Log

This document records every technical roadblock encountered during initial prototyping, why specific approaches failed, and the exact engineering solution adopted.

---

## 1. Local Vision & Model Architecture Decisions

### 1.1 Rejected: `qwen3.5` for Spatial Layout Math
- **Problem:** Early tests considered Qwen (`qwen3.5:4b` / `qwen3.5:9b`) for generating layout coordinates.
- **Why It Failed:** Poor adherence to strict JSON schemas and frequent spatial coordinate hallucinations.
- **Resolution:** Standardized on local `llama3.1:8b` (`format: 'json'`) for deterministic JSON schema adherence and spatial layout math.

### 1.2 Rejected: Dual Local Models in Memory Simultaneously (`llama3.2-vision` + `llama3.1:8b`)
- **Problem:** Calling `llama3.2-vision:latest` (7.8 GB) and `llama3.1:8b` (4.9 GB) in the same API route spiked `llama-server` unified memory usage to ~12.7–13 GB, causing severe memory contention. Additionally, passing base64 DataURLs through the OpenAI SDK `/v1` compatibility layer threw 400 parsing errors that were masked by a generic `catch` block (`"Vision model not found locally"`).
- **Why Single-Model `llama3.2-vision` Also Failed:** Switching to native `/api/chat` with `llama3.2-vision:latest` crashed with:
  `Ollama Error (500): llama-server process has terminated: exit status 1: error loading model: unknown model architecture: 'mllama'`. Even after reinstalling the latest macOS Ollama app, `mllama` failed on this hardware/OS combination.
- **Temporary Workaround (`llava` with `keep_alive: 0`):** Used `llava` with `keep_alive: 0` so Ollama purged the vision model from RAM the millisecond it finished scanning supplies, leaving `llama3.1:8b` (`keep_alive: '15m'`) alone in memory.

### 1.3 Rejected: Local `llava` for Craft Supply Detection
- **Problem:** When scanning the wedding sticker sheet and navy/light-blue cardstock, `llava` outputted inconsistent results across runs, completely missed the navy and light blue cardstock (reporting `"White, black, gold"`), and hallucinated `"scissors"` and `"punches"` simply because its training weights associate scrapbooking with scissors.
- **Resolution (The Hybrid Cloud Director + Local Draftsman Pattern):** Moved vision and aesthetic analysis to Google's Gemini API while keeping coordinate math and delta-patching on local `llama3.1:8b` + Node.js.

### 1.4 Gemini API Billing (`402`) & Deprecated Endpoints (`404`)
- **Problem 1 (`402 Prepayment credits depleted`):** Initial API key was tied to a Google Cloud project with an empty prepaid wallet. Resolved by generating a fresh key in a clean project / active tier.
- **Problem 2 (`404 models/gemini-1.5-flash is not found for API version v1beta`):** Google retired the `1.5-flash` endpoint.
- **Resolution:** Upgraded to modern Flash endpoints via a resilient model cascade (`['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash']`) inside `callGeminiJson()`.

---

## 2. Layout Geometry & State Persistence Decisions

### 2.1 Follow-Up Drift vs. Delta Patching + Relational Solver
- **Problem:** When asking the AI on turn 2 to `"move the flower centered above photo 1"`, regenerating the entire layout caused untouched photos to drift or swap positions, and the LLM miscalculated inverted SVG Y-coordinates (`Y=0` is top) or bounding-box half-widths.
- **Resolution:**
  1. Split `route.js` into **Initial Turn** (full layout generation) and **Follow-Up Turn** (delta patching via an `updates` array that only touches requested object IDs).
  2. Built a deterministic **Relational Solver** in Node.js: when the user asks for relative placement (`above`, `below`, `left`, `right`, `overlap_top_right`, etc.), the LLM outputs `"relative_to": "photo_1", "position": "above"`, and Node.js computes the exact millimeter center using the objects' true outer dimensions (`photo_width + 10`, `photo_height + 10`).

### 2.2 The "Two 6x4 Landscape Photos Always Stack" Bug
- **Problem:** Every initial run with two `6x4"` landscape photos (`152.4mm × 101.6mm` each) stacked them right on top of each other in the center of the page.
- **Root Cause:**
  1. A `6x4"` landscape photo plus its `10mm` mat has an outer width of `162.4mm`. Two side-by-side require `324.8mm`, which exceeds the `274.8mm` usable width of the canvas (`304.8mm - 30mm` margins). When the LLM placed one on the left and one on the right at the same `center_y`, the `15mm` border clamp pushed both inward toward the center, forcing a `50mm` horizontal overlap.
  2. Removing the collision loop during the delta-patching refactor left initial turns unprotected.
- **Resolution:** Added a **Deterministic 2D Grid Collision Solver** that runs *only* on the Initial Turn (`!currentLayout || isStartOver`). It checks `placedPhotoBoxes` with a `10mm` gap and scans the canvas in `15mm` steps to stagger overlapping photos vertically, while also preventing stickers from being placed over the inner 75% core of any photo. Default landscape photo intake size was also adjusted to `4x3"` (`101.6mm × 76.2mm`) so two landscape photos can sit side-by-side or diagonally with generous breathing room.

### 2.3 Broken Image Icon on Canvas
- **Problem:** A broken image icon appeared on the corner of `photo_1`.
- **Root Cause:** `llama3.1:8b` occasionally invented a sticker ID (e.g., `sticker_11` or `flower_1`) not present in `inventory.cutouts`, leaving an unreplaced `__STICKER_DATA_...__` placeholder in the `<image href="...">` tag.
- **Resolution:** Added strict server-side object validation that filters `layout.objects` against `lockedPhotos` and `stickerCatalog`, discarding any hallucinated IDs and guaranteeing all locked photos are present.

---

## 3. Sticker Cropping & Contour Die-Cut Decisions

### 3.1 Why Initial Sticker Crops Grabbed the Wood Table (`cutout_1`, `cutout_3`, `cutout_7`)
- **Problem:** First pass of `box_2d` sticker cropping produced boxes shifted to the left, showing strips of brown wood table grain instead of the stickers.
- **Root Cause:**
  1. Phone photos (`PXL_...`) contain EXIF orientation metadata and high aspect ratios that caused coordinate drift between raw base64 bytes sent to the vision model and the browser's `<canvas>` draw calls.
  2. Asking the vision model to detect 10 small sticker bounding boxes on the *full table photo* (which included the wood desk and angled blue cardstock sheets) degraded its `0..1000` coordinate precision.
- **Resolution (Two-Stage Sheet Isolation):**
  1. Added `normalizeImageDataUrl()` on the client to draw the uploaded file onto a standard `<canvas>` (max `1600px`) *before* sending it to the API, stripping EXIF orientation quirks.
  2. Split scanning into two stages: **Pass 1 (`locate_sheet_and_papers`)** finds `sheet_box_2d` of the white/cream sticker sheet alone and crops away the wooden table and cardstock on the client. **Pass 2 (`detect_stickers_on_sheet`)** runs sticker detection exclusively on the cropped, wood-free sticker sheet image.

### 3.2 Why "SVG Digital Twins" Were Rejected for General Sticker Scanning
- **Problem:** To avoid pixel-cropping artifacts on tone-on-tone cream stickers, we tested having the LLM generate inline SVG re-creations (`svg_twin`) for all 8 stickers during the scan pass.
- **Why It Failed:** Text LLMs cannot hand-write complex calligraphy or botanical line art for 8 stickers in a single JSON payload; it produced oversimplified cartoon pills (`<rect rx="22"/>` with Georgia text) and 5-circle blobs that looked like hallucinations rather than the user's real stickers.
- **Resolution:** Reverted to **real photographic sticker crops** for all stickers in the tray, and reserved SVG generation strictly for the explicit per-item **`✦ Make Cuttable SVG`** button (which sends a single high-res sticker crop to the vision model and prompts for cubic Bezier `<path d="M... C... Z"/>` cardstock cut layers).

### 3.3 Edge Flood-Fill vs. Foreground-Seeded Contour Die-Cut
- **Problem:** Standard edge flood-fill (flooding inward from the crop perimeter to remove the cream backing paper) failed in two ways:
  1. For low-contrast cream stickers (like a cream heart on a cream sheet), the flood-fill bled right through the sticker and erased it.
  2. When a neighboring sticker touched the crop border, it blocked the flood-fill or left half-cut neighbor fragments (such as the top half of the two flowers directly underneath `"together"`).
- **Resolution (`createTrueStickerCutout` + Connected-Component Pruning):**
  1. Estimate the sheet backing color from the top 25% brightest pixels in the crop.
  2. Seed the sticker from the **foreground ink pixels** (`dist > 22`, or `dist > 11` for low-contrast motifs) inside the crop (ignoring the outer `3px` frame).
  3. Run connected-component pruning to drop disconnected neighbor fragments near the crop perimeter (eliminating the cut-off flowers under `"together"`).
  4. Dilate the surviving foreground motif outward by `6px` to create a smooth, contour-hugging cream die-cut border, and flood-fill transparency from the outside so interior letter loops remain intact.