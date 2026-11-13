"use client";
import { useState } from "react";

const CANVAS_AREA_MM2 = 304.8 * 304.8;
const MAX_PHOTO_PCT = 50.0;

const SIZE_OPTIONS = [
  { label: '4x6" Portrait', w_in: 4, h_in: 6 },
  { label: '3x4" Portrait', w_in: 3, h_in: 4 },
  { label: '2x3" Portrait', w_in: 2, h_in: 3 },
  { label: '6x4" Landscape', w_in: 6, h_in: 4 },
  { label: '4x3" Landscape', w_in: 4, h_in: 3 },
  { label: '3x2" Landscape', w_in: 3, h_in: 2 },
  { label: '4x4" Square', w_in: 4, h_in: 4 },
  { label: '3x3" Square', w_in: 3, h_in: 3 },
];

export default function Home() {
  const [photos, setPhotos] = useState([
    { id: "photo_1", label: '4x3" Landscape', w_in: 4, h_in: 3, dataUrl: null },
    { id: "photo_2", label: '4x3" Landscape', w_in: 4, h_in: 3, dataUrl: null },
  ]);
  const [supplyImage, setSupplyImage] = useState(null);
  const [scanningSupplies, setScanningSupplies] = useState(false);
  const [activeModelBadge, setActiveModelBadge] = useState("");
  const [vectorizingId, setVectorizingId] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [viewMode, setViewMode] = useState("visual");
  const [input, setInput] = useState(
    "Arrange my photos nicely and place the Together title and floral cutouts around them."
  );
  const [messages, setMessages] = useState([]);
  const [rawSvg, setRawSvg] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const totalPhotoAreaMm2 = photos.reduce((sum, p) => {
    const outerW = p.w_in * 25.4 + 10;
    const outerH = p.h_in * 25.4 + 10;
    return sum + outerW * outerH;
  }, 0);

  const usedPct = (totalPhotoAreaMm2 / CANVAS_AREA_MM2) * 100;
  const isOverBudget = usedPct > MAX_PHOTO_PCT;

  const normalizeImageDataUrl = (rawFile) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1600;
          let w = img.naturalWidth;
          let h = img.naturalHeight;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.92));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(rawFile);
    });
  };

  // Helper to crop a [ymin, xmin, ymax, xmax] (0..1000) region into a clean DataURL
  const cropBoxToDataUrl = (sourceDataUrl, box2d) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const [ymin, xmin, ymax, xmax] = box2d || [0, 0, 1000, 1000];
        const sx = Math.max(0, Math.floor((xmin / 1000) * W));
        const sy = Math.max(0, Math.floor((ymin / 1000) * H));
        const sw = Math.max(32, Math.floor(((xmax - xmin) / 1000) * W));
        const sh = Math.max(32, Math.floor(((ymax - ymin) / 1000) * H));

        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(canvas.toDataURL("image/jpeg", 0.95));
      };
      img.src = sourceDataUrl;
    });
  };

  // Foreground-seeded Contour Die-Cut Filter:
  // 1. Measures the bright white/cream sheet backing color inside the crop.
  // 2. Identifies foreground ink/motif pixels that differ from the sheet backing AND ignores fragments stuck to the outer 3px edge (neighbor bleed).
  // 3. Wraps a smooth 6px cream die-cut contour border around the foreground ink so cursive script and florals look like real physical stickers!
  const createTrueStickerCutout = (ctx, w, h, dieCutBorderPx = 6) => {
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // 1. Estimate sheet background color from the top 25% brightest pixels in this crop
    const lumList = [];
    for (let i = 0; i < w * h; i += 4) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      lumList.push({ lum, r, g, b });
    }
    lumList.sort((a, b) => b.lum - a.lum);
    const topCount = Math.max(1, Math.floor(lumList.length * 0.25));
    let bgR = 0, bgG = 0, bgB = 0;
    for (let i = 0; i < topCount; i++) {
      bgR += lumList[i].r;
      bgG += lumList[i].g;
      bgB += lumList[i].b;
    }
    bgR = Math.round(bgR / topCount);
    bgG = Math.round(bgG / topCount);
    bgB = Math.round(bgB / topCount);

    // 2. Mark foreground ink/artwork pixels (distance > 22 from sheet backing)
    // Ignore the outer 3px margin so neighboring stickers clipped at the very edge don't seed the contour
    const isInk = new Uint8Array(w * h);
    const edgeMargin = 3;
    let inkCount = 0;

    for (let y = edgeMargin; y < h - edgeMargin; y++) {
      for (let x = edgeMargin; x < w - edgeMargin; x++) {
        const idx = (y * w + x) * 4;
        const dr = data[idx] - bgR;
        const dg = data[idx + 1] - bgG;
        const db = data[idx + 2] - bgB;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist > 22) {
          isInk[y * w + x] = 1;
          inkCount++;
        }
      }
    }

    // If a sticker is ultra-low-contrast (e.g. solid cream heart on white backing), lower threshold to 11
    if (inkCount < w * h * 0.015) {
      for (let y = edgeMargin; y < h - edgeMargin; y++) {
        for (let x = edgeMargin; x < w - edgeMargin; x++) {
          const idx = (y * w + x) * 4;
          const dr = data[idx] - bgR;
          const dg = data[idx + 1] - bgG;
          const db = data[idx + 2] - bgB;
          const dist = Math.sqrt(dr * dr + dg * dg + db * db);
          if (dist > 11) {
            isInk[y * w + x] = 1;
          }
        }
      }
    }

    // 3. Dilate foreground ink outward by `dieCutBorderPx` to create the contour-hugging sticker border
    const inSticker = new Uint8Array(w * h);
    const r2 = dieCutBorderPx * dieCutBorderPx;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (isInk[y * w + x]) {
          inSticker[y * w + x] = 1;
          continue;
        }
        let nearInk = false;
        const yMin = Math.max(0, y - dieCutBorderPx);
        const yMax = Math.min(h - 1, y + dieCutBorderPx);
        const xMin = Math.max(0, x - dieCutBorderPx);
        const xMax = Math.min(w - 1, x + dieCutBorderPx);

        for (let ny = yMin; ny <= yMax && !nearInk; ny++) {
          const dy = ny - y;
          for (let nx = xMin; nx <= xMax; nx++) {
            const dx = nx - x;
            if (dx * dx + dy * dy <= r2 && isInk[ny * w + nx]) {
              nearInk = true;
              break;
            }
          }
        }
        if (nearInk) inSticker[y * w + x] = 1;
      }
    }

    // 4. Also keep interior enclosed holes (like the inside of an 'o', 'g', oval badge, or framed tag)
    const isOutside = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;

    const tryEnqueueOutside = (x, y) => {
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      const pos = y * w + x;
      if (isOutside[pos] || inSticker[pos]) return;
      isOutside[pos] = 1;
      queue[tail++] = pos;
    };

    for (let x = 0; x < w; x++) {
      tryEnqueueOutside(x, 0);
      tryEnqueueOutside(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      tryEnqueueOutside(0, y);
      tryEnqueueOutside(w - 1, y);
    }

    while (head < tail) {
      const curr = queue[head++];
      const cx = curr % w;
      const cy = Math.floor(curr / w);
      tryEnqueueOutside(cx + 1, cy);
      tryEnqueueOutside(cx - 1, cy);
      tryEnqueueOutside(cx, cy + 1);
      tryEnqueueOutside(cx, cy - 1);
    }

    // Any pixel NOT reached from the outside is part of the sticker or its enclosed interior!
    for (let i = 0; i < w * h; i++) {
      if (isOutside[i]) {
        data[i * 4 + 3] = 0; // Transparent outside contour
      }
    }

    ctx.putImageData(imgData, 0, 0);
  };

  const cropCutoutsFromSheet = (sheetDataUrl, cutouts = []) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const padPx = 6;

        const enriched = cutouts.map((item) => {
          const [ymin, xmin, ymax, xmax] = item.box_2d || [100, 100, 250, 250];
          const sx = Math.max(0, Math.floor((xmin / 1000) * W) - padPx);
          const sy = Math.max(0, Math.floor((ymin / 1000) * H) - padPx);
          const ex = Math.min(W, Math.ceil((xmax / 1000) * W) + padPx);
          const ey = Math.min(H, Math.ceil((ymax / 1000) * H) + padPx);
          const sw = Math.max(20, ex - sx);
          const sh = Math.max(20, ey - sy);

          const canvas = document.createElement("canvas");
          canvas.width = sw;
          canvas.height = sh;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

          createTrueStickerCutout(ctx, sw, sh, 6);

          return {
            ...item,
            item_type: "sticker",
            cropUrl: canvas.toDataURL("image/png"),
          };
        });
        resolve(enriched);
      };
      img.src = sheetDataUrl;
    });
  };

  // Two-stage Supply Scan:
  // Pass 1: Locate the sticker sheet (crop away the wood table & cardstock) + extract cardstock hexes.
  // Pass 2: Detect individual stickers on the clean, cropped sticker sheet & contour-cut them.
  const handleSupplyUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanningSupplies(true);
    setErrorMsg("");

    try {
      const normalizedDataUrl = await normalizeImageDataUrl(file);
      setSupplyImage(normalizedDataUrl);

      // PASS 1: Locate sticker sheet box & cardstock palette
      const res1 = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "locate_sheet_and_papers",
          supplyImage: normalizedDataUrl,
        }),
      });
      const step1 = await res1.json();
      if (step1.error) throw new Error(step1.error);
      if (step1.usedModel) setActiveModelBadge(step1.usedModel);

      // Crop out the wood table and background cardstock so only the sticker sheet remains
      const cleanSheetDataUrl = await cropBoxToDataUrl(
        normalizedDataUrl,
        step1.sheet_box_2d || [50, 100, 850, 700]
      );

      // PASS 2: Detect stickers on the isolated sticker sheet
      const res2 = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "detect_stickers_on_sheet",
          sheetOnlyImage: cleanSheetDataUrl,
        }),
      });
      const step2 = await res2.json();
      if (step2.error) throw new Error(step2.error);

      const croppedCutouts = await cropCutoutsFromSheet(
        cleanSheetDataUrl,
        step2.cutouts || []
      );

      setInventory({
        theme: step1.theme || "Scrapbook Page",
        papers: step1.papers || [],
        cutouts: croppedCutouts,
      });
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setScanningSupplies(false);
      e.target.value = "";
    }
  };

  const handleVectorizeCutout = async (cutoutItem) => {
    if (!cutoutItem?.cropUrl) return;
    setVectorizingId(cutoutItem.id);
    setErrorMsg("");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "vectorize_cutout",
          cropImage: cutoutItem.cropUrl,
          label: cutoutItem.label,
          palette: inventory?.papers || [],
        }),
      });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(data.error);
      } else if (data.vector?.svg_inner) {
        const newSvgId = `svg_${cutoutItem.id}`;
        const newVectorItem = {
          id: newSvgId,
          label: `${data.vector.recognized_shape || cutoutItem.label} (Cut SVG)`,
          category: cutoutItem.category || "embellishment",
          item_type: "cut_svg",
          width_mm: cutoutItem.width_mm || 50,
          height_mm: cutoutItem.height_mm || 50,
          svgInner: data.vector.svg_inner,
        };

        setInventory((prev) => ({
          ...prev,
          cutouts: [
            newVectorItem,
            ...(prev.cutouts || []).filter((c) => c.id !== newSvgId),
          ],
        }));
      }
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setVectorizingId(null);
    }
  };

  const handlePhotoUpload = (e) => {
    const files = Array.from(e.target.files);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const ratio = img.naturalWidth / img.naturalHeight;
          let w_in = 4,
            h_in = 6,
            label = '4x6" Portrait';
          if (ratio > 1.15) {
            w_in = 4;
            h_in = 3;
            label = '4x3" Landscape';
          } else if (ratio >= 0.85 && ratio <= 1.15) {
            w_in = 4;
            h_in = 4;
            label = '4x4" Square';
          }
          setPhotos((prev) => {
            const realPhotosOnly = prev.filter((p) => p.dataUrl !== null);
            const updated = [
              ...realPhotosOnly,
              {
                id: `photo_${realPhotosOnly.length + 1}`,
                label,
                w_in,
                h_in,
                dataUrl: event.target.result,
              },
            ];
            return updated.map((p, idx) => ({ ...p, id: `photo_${idx + 1}` }));
          });
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const updatePhotoSize = (index, selectedLabel) => {
    const found = SIZE_OPTIONS.find((opt) => opt.label === selectedLabel);
    if (!found) return;
    setPhotos((prev) =>
      prev.map((p, idx) =>
        idx === index
          ? { ...p, label: found.label, w_in: found.w_in, h_in: found.h_in }
          : p
      )
    );
  };

  const removePhoto = (indexToRemove) => {
    setPhotos((prev) =>
      prev
        .filter((_, idx) => idx !== indexToRemove)
        .map((p, idx) => ({ ...p, id: `photo_${idx + 1}` }))
    );
  };

  const generateLayout = async () => {
    if (!input.trim() || isOverBudget || photos.length === 0) return;

    setLoading(true);
    setErrorMsg("");

    const newMessages = [...messages, { role: "user", content: input }];
    setMessages(newMessages);
    setInput("");

    const lastAssistantMessage = newMessages
      .filter((m) => m.role === "assistant")
      .pop();
    const currentLayout = lastAssistantMessage
      ? lastAssistantMessage.content
      : null;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_layout",
          messages: newMessages,
          currentLayout,
          photos: photos.map(({ id, w_in, h_in, label }) => ({
            id,
            w_in,
            h_in,
            label,
          })),
          extractedInventory: inventory
            ? {
                theme: inventory.theme,
                papers: inventory.papers,
                cutouts: inventory.cutouts.map(
                  ({ id, label, category, item_type, width_mm, height_mm }) => ({
                    id,
                    label,
                    category,
                    item_type: item_type || "sticker",
                    width_mm,
                    height_mm,
                  })
                ),
              }
            : null,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setErrorMsg(data.error);
      } else if (data.svg) {
        setRawSvg(data.svg);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.json },
        ]);
      }
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getRenderedSvg = () => {
    if (!rawSvg) return "";
    let finalSvg = rawSvg;

    photos.forEach((p) => {
      finalSvg = finalSvg.replace(
        `__PHOTO_DATA_${p.id}__`,
        p.dataUrl || ""
      );
    });

    if (inventory?.cutouts) {
      inventory.cutouts.forEach((c) => {
        if (c.item_type === "cut_svg") {
          finalSvg = finalSvg.replace(
            `__VECTOR_SVG_${c.id}__`,
            c.svgInner || ""
          );
        } else {
          finalSvg = finalSvg.replace(
            `__STICKER_DATA_${c.id}__`,
            c.cropUrl || ""
          );
        }
      });
    }

    const modeCss =
      viewMode === "visual"
        ? `<style>.blueprint-layer { display: none; }</style>`
        : `<style>.visual-layer { opacity: 0.18; } .blueprint-layer { display: inline; }</style>`;

    return finalSvg.replace("</defs>", `</defs>${modeCss}`);
  };

  return (
    <div className="flex h-screen bg-neutral-950 text-white font-sans overflow-hidden">
      {/* LEFT PANEL */}
      <div className="w-80 p-4 border-r border-neutral-800 flex flex-col overflow-hidden shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-bold text-neutral-100">Scrapbook AI</h1>
            {activeModelBadge && (
              <span className="text-[10px] font-mono text-emerald-400">
                Vision: {activeModelBadge}
              </span>
            )}
          </div>
          <button
            onClick={() => {
              setMessages([]);
              setRawSvg("");
              setErrorMsg("");
            }}
            className="text-xs px-2 py-1 bg-neutral-800 hover:bg-neutral-700 rounded border border-neutral-700"
          >
            Reset Page
          </button>
        </div>

        {/* 1. Photos */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 mb-3">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-semibold uppercase text-neutral-300">
              1. Photos ({photos.length})
            </span>
            <span
              className={`text-xs font-mono font-bold ${
                isOverBudget ? "text-red-400" : "text-emerald-400"
              }`}
            >
              {usedPct.toFixed(1)}% / 50%
            </span>
          </div>
          <div className="w-full h-1.5 bg-neutral-950 rounded-full overflow-hidden mb-2.5">
            <div
              className={`h-full ${
                isOverBudget ? "bg-red-500" : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(100, (usedPct / 50) * 100)}%` }}
            />
          </div>

          <div className="flex gap-1.5 mb-2">
            <label className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-500 rounded font-medium cursor-pointer">
              + Upload Photos
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotoUpload}
                className="hidden"
              />
            </label>
          </div>

          <div className="max-h-28 overflow-y-auto space-y-1.5">
            {photos.map((p, idx) => (
              <div
                key={p.id}
                className="flex items-center justify-between text-xs bg-neutral-950 px-2 py-1 rounded border border-neutral-800 gap-1.5"
              >
                <span className="font-bold text-blue-400">#{idx + 1}</span>
                {p.dataUrl && (
                  <img
                    src={p.dataUrl}
                    alt=""
                    className="w-5 h-5 object-cover rounded"
                  />
                )}
                <select
                  value={p.label}
                  onChange={(e) => updatePhotoSize(idx, e.target.value)}
                  className="bg-neutral-900 text-neutral-200 text-xs rounded px-1 py-0.5 border border-neutral-700 flex-1 truncate"
                >
                  {SIZE_OPTIONS.map((opt) => (
                    <option key={opt.label} value={opt.label}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => removePhoto(idx)}
                  className="text-neutral-500 hover:text-red-400 px-1"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 2. Scan & Cut Supplies */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 mb-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-neutral-300">
              2. Scan &amp; Cut Supplies
            </span>
            <label className="text-xs px-2.5 py-1 bg-purple-600 hover:bg-purple-500 rounded font-medium cursor-pointer">
              {scanningSupplies
                ? "Cutting..."
                : supplyImage
                ? "Rescan Sheet"
                : "Upload Sheet"}
              <input
                type="file"
                accept="image/*"
                onChange={handleSupplyUpload}
                className="hidden"
                disabled={scanningSupplies}
              />
            </label>
          </div>
          {scanningSupplies && (
            <p className="text-[11px] text-purple-300 mt-2 animate-pulse">
              Stage 1: Isolating sticker sheet from table... Stage 2: Contour-cutting real stickers...
            </p>
          )}
        </div>

        {/* Chat Log */}
        <div className="flex-1 overflow-y-auto mb-3 space-y-2 pr-1">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`p-2 rounded text-xs ${
                msg.role === "user"
                  ? "bg-blue-950/60 border border-blue-800/50 ml-4"
                  : "bg-neutral-900 border border-neutral-800 mr-4"
              }`}
            >
              {msg.role === "user"
                ? msg.content
                : "✓ Updated layout using real contour-cut stickers."}
            </div>
          ))}
          {errorMsg && (
            <div className="p-2 rounded text-xs bg-red-950/80 border border-red-700 text-red-200">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Command Input */}
        <div className="pt-2 border-t border-neutral-800">
          <textarea
            className="w-full p-2.5 bg-neutral-900 rounded border border-neutral-700 text-xs resize-none h-20 mb-2 outline-none focus:border-blue-500"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g., Move sticker_1 above photo_1..."
          />
          <button
            onClick={generateLayout}
            disabled={loading || scanningSupplies || isOverBudget}
            className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded text-xs font-semibold disabled:opacity-40"
          >
            {loading ? "Designing Page..." : "Design / Update Canvas"}
          </button>
        </div>
      </div>

      {/* CENTER PANEL */}
      <div className="flex-1 p-6 flex flex-col items-center justify-center bg-black relative">
        <div className="flex items-center gap-2 mb-4 bg-neutral-900 p-1 rounded-lg border border-neutral-800">
          <button
            onClick={() => setViewMode("visual")}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition ${
              viewMode === "visual"
                ? "bg-blue-600 text-white"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Visual Design (What You See)
          </button>
          <button
            onClick={() => setViewMode("blueprint")}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition ${
              viewMode === "blueprint"
                ? "bg-amber-600 text-white"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Blueprint &amp; Cut Lines (Behind the Scenes)
          </button>
        </div>

        <div className="w-full max-w-xl aspect-square bg-neutral-900 rounded-lg border border-neutral-800 shadow-2xl overflow-hidden flex items-center justify-center">
          {loading ? (
            <div className="animate-pulse text-neutral-400 text-xs">
              Placing photos, cardstock mats, and real contour-cut stickers...
            </div>
          ) : rawSvg ? (
            <div
              dangerouslySetInnerHTML={{ __html: getRenderedSvg() }}
              className="w-full h-full"
            />
          ) : (
            <div className="text-neutral-600 text-xs text-center px-6">
              Click &ldquo;Rescan Sheet&rdquo; in Step 2 to run the two-stage Gemini 3.8 Flash sheet isolator &amp; contour cutter.
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL: Real Cropped & Contour-Masked Stickers */}
      <div className="w-80 p-4 border-l border-neutral-800 bg-neutral-900/40 flex flex-col overflow-hidden shrink-0">
        <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-300 mb-3">
          Extracted Inventory Tray
        </h2>

        {!inventory ? (
          <div className="text-xs text-neutral-500 leading-relaxed">
            No supplies scanned yet. Upload your sticker &amp; cardstock photo to isolate the sheet and contour-cut your real stickers.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {/* Detected Papers */}
            <div>
              <span className="text-[11px] font-semibold uppercase text-neutral-400 block mb-1.5">
                Cardstock &amp; Papers ({inventory.papers?.length || 0})
              </span>
              <div className="space-y-1.5">
                {inventory.papers?.map((paper) => (
                  <div
                    key={paper.id}
                    className="flex items-center gap-2 bg-neutral-900 p-1.5 rounded border border-neutral-800 text-xs"
                  >
                    <div
                      className="w-5 h-5 rounded border border-white/20 shrink-0"
                      style={{ backgroundColor: paper.hex }}
                    />
                    <div className="truncate flex-1">
                      <div className="font-medium text-neutral-200 truncate">
                        {paper.name}
                      </div>
                      <div className="text-[10px] text-neutral-400 font-mono">
                        {paper.hex} &bull; {paper.role}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Real Cropped Stickers & Optional Cut SVGs */}
            <div>
              <span className="text-[11px] font-semibold uppercase text-neutral-400 block mb-1.5">
                Stickers &amp; Cutouts ({inventory.cutouts?.length || 0})
              </span>
              <div className="grid grid-cols-2 gap-2">
                {inventory.cutouts?.map((item) => (
                  <div
                    key={item.id}
                    className={`border rounded p-2 flex flex-col items-center text-center ${
                      item.item_type === "cut_svg"
                        ? "bg-emerald-950/30 border-emerald-700/60"
                        : "bg-neutral-900 border-neutral-800"
                    }`}
                  >
                    <div
                      className="w-full h-16 rounded flex items-center justify-center overflow-hidden mb-1.5 p-1"
                      style={{
                        backgroundImage:
                          "linear-gradient(45deg, #1f2937 25%, transparent 25%), linear-gradient(-45deg, #1f2937 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1f2937 75%), linear-gradient(-45deg, transparent 75%, #1f2937 75%)",
                        backgroundSize: "10px 10px",
                        backgroundPosition: "0 0, 0 5px, 5px -5px, -5px 0",
                        backgroundColor: "#111827",
                      }}
                    >
                      {item.item_type === "cut_svg" ? (
                        <svg
                          viewBox="0 0 100 100"
                          className="w-12 h-12 overflow-visible"
                          dangerouslySetInnerHTML={{ __html: item.svgInner }}
                        />
                      ) : (
                        item.cropUrl && (
                          <img
                            src={item.cropUrl}
                            alt={item.label}
                            className="max-h-full max-w-full object-contain"
                          />
                        )
                      )}
                    </div>

                    <span
                      className={`text-[10px] font-mono font-bold ${
                        item.item_type === "cut_svg"
                          ? "text-emerald-400"
                          : "text-purple-400"
                      }`}
                    >
                      {item.id}
                    </span>
                    <span className="text-[11px] text-neutral-200 line-clamp-1 mb-1">
                      {item.label}
                    </span>

                    {item.item_type !== "cut_svg" ? (
                      <button
                        onClick={() => handleVectorizeCutout(item)}
                        disabled={vectorizingId === item.id}
                        className="w-full mt-auto text-[10px] py-1 px-1.5 bg-neutral-800 hover:bg-emerald-700 text-neutral-200 hover:text-white rounded border border-neutral-700 transition disabled:opacity-50"
                      >
                        {vectorizingId === item.id
                          ? "Tracing SVG..."
                          : "✦ Make Cuttable SVG"}
                      </button>
                    ) : (
                      <span className="mt-auto text-[10px] px-1.5 py-0.5 bg-emerald-900/60 text-emerald-300 rounded">
                        ✓ Cardstock Cut SVG
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}