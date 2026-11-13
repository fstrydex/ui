"use client";
import { useState } from "react";
import CanvasStage from "@/components/CanvasStage";
import IntakeSidebar, { SIZE_OPTIONS } from "@/components/IntakeSidebar";
import InventoryTray from "@/components/InventoryTray";
import { cropBoxToDataUrl, cropCutoutsFromSheet, normalizeImageDataUrl } from "@/lib/contourCutter";
import { CANVAS_SIZE_MM, MAX_PHOTO_AREA_PCT, compileLayoutToSvg, injectAssetsIntoSvg, upsertCutoutInLayout } from "@/lib/svgCompiler";

const DEFAULT_LAYOUT_PROMPT = "Arrange my photos nicely and place the Together title and floral cutouts around them.";
const DEFAULT_ANALYZE_PROMPT = "Analyze my photos and recommend a scrapbook theme & cardstock palette.";

async function postGenerate(payload) {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export default function Home() {
  const [photos, setPhotos] = useState([
    { id: "photo_1", label: '4x3" Landscape', w_in: 4, h_in: 3, dataUrl: null },
    { id: "photo_2", label: '4x3" Landscape', w_in: 4, h_in: 3, dataUrl: null },
  ]);
  const [suppliesUnlocked, setSuppliesUnlocked] = useState(false);
  const [themeRecommendation, setThemeRecommendation] = useState(null);
  const [supplyImage, setSupplyImage] = useState(null);
  const [scanningSupplies, setScanningSupplies] = useState(false);
  const [analyzingPhotos, setAnalyzingPhotos] = useState(false);
  const [activeModelBadge, setActiveModelBadge] = useState("");
  const [vectorizingId, setVectorizingId] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [viewMode, setViewMode] = useState("visual");
  const [input, setInput] = useState(DEFAULT_LAYOUT_PROMPT);
  const [messages, setMessages] = useState([]);
  const [currentLayoutObj, setCurrentLayoutObj] = useState(null);
  const [rawSvg, setRawSvg] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const totalPhotoAreaMm2 = photos.reduce((sum, p) => sum + (p.w_in * 25.4 + 10) * (p.h_in * 25.4 + 10), 0);
  const usedPct = (totalPhotoAreaMm2 / (CANVAS_SIZE_MM * CANVAS_SIZE_MM)) * 100;
  const isOverBudget = usedPct > MAX_PHOTO_AREA_PCT;
  const defaultMatHex = inventory?.papers?.[1]?.hex || inventory?.papers?.[0]?.hex || themeRecommendation?.recommended_palette?.[1]?.hex || "#F2EFE4";

  const runAsync = async (setBusy, fn) => {
    setBusy(true);
    setErrorMsg("");
    try { await fn(); } catch (err) { setErrorMsg(err.message); } finally { setBusy(false); }
  };

  const handleAnalyzePhotos = () => {
    const realPhotos = photos.filter((p) => Boolean(p.dataUrl));
    if (realPhotos.length === 0) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: "Analyze my photos for theme and palette." },
        { role: "assistant", content: "", isLayout: false, displayText: "Photo-based theme & palette recommendation requires real photo uploads. Step 2 (Scan & Cut Supplies) is now unlocked." },
      ]);
      setSuppliesUnlocked(true);
      setInput(DEFAULT_LAYOUT_PROMPT);
      return;
    }
    setMessages((prev) => [...prev, { role: "user", content: input.trim() || DEFAULT_ANALYZE_PROMPT }]);
    runAsync(setAnalyzingPhotos, async () => {
      const data = await postGenerate({ action: "analyze_photos", photos: realPhotos.map(({ id, dataUrl }) => ({ id, dataUrl })) });
      if (data.usedModel) setActiveModelBadge(data.usedModel);
      setThemeRecommendation(data);
      setMessages((prev) => [...prev, { role: "assistant", content: "", isLayout: false, displayText: `Theme: ${data.theme}. ${data.summary}` }]);
      setSuppliesUnlocked(true);
      setInput(DEFAULT_LAYOUT_PROMPT);
    });
  };

  const handleSupplyUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await runAsync(setScanningSupplies, async () => {
      const normalized = await normalizeImageDataUrl(file);
      setSupplyImage(normalized);
      const step1 = await postGenerate({ action: "locate_sheet_and_papers", supplyImage: normalized });
      if (step1.usedModel) setActiveModelBadge(step1.usedModel);
      const cleanSheet = await cropBoxToDataUrl(normalized, step1.sheet_box_2d || [50, 100, 850, 700]);
      const step2 = await postGenerate({ action: "detect_stickers_on_sheet", sheetOnlyImage: cleanSheet });
      const cutouts = await cropCutoutsFromSheet(cleanSheet, step2.cutouts || []);
      setInventory({ theme: step1.theme || "Scrapbook Page", papers: step1.papers || [], cutouts });
      setSuppliesUnlocked(true);
    });
  };

  const handleVectorizeCutout = (cutoutItem) => {
    if (!cutoutItem?.cropUrl) return;
    runAsync((busy) => setVectorizingId(busy ? cutoutItem.id : null), async () => {
      const data = await postGenerate({ action: "vectorize_cutout", cropImage: cutoutItem.cropUrl, label: cutoutItem.label, palette: inventory?.papers || [] });
      if (data.vector?.svg_inner) {
        const newSvgId = `svg_${cutoutItem.id}`;
        const newVector = { id: newSvgId, label: `${data.vector.recognized_shape || cutoutItem.label} (Cut SVG)`, category: cutoutItem.category || "embellishment", item_type: "cut_svg", width_mm: cutoutItem.width_mm || 50, height_mm: cutoutItem.height_mm || 50, svgInner: data.vector.svg_inner };
        setInventory((prev) => ({ ...prev, cutouts: [newVector, ...(prev.cutouts || []).filter((c) => c.id !== newSvgId)] }));
      }
    });
  };

  const handlePhotoUpload = (e) => {
    Array.from(e.target.files || []).forEach(async (file) => {
      const dataUrl = await normalizeImageDataUrl(file);
      const img = new Image();
      img.onload = () => {
        const ratio = img.naturalWidth / img.naturalHeight;
        const size = ratio > 1.15 ? { w_in: 4, h_in: 3, label: '4x3" Landscape' } : ratio >= 0.85 ? { w_in: 4, h_in: 4, label: '4x4" Square' } : { w_in: 4, h_in: 6, label: '4x6" Portrait' };
        setPhotos((prev) => [...prev.filter((p) => p.dataUrl !== null), { ...size, dataUrl }].map((p, idx) => ({ ...p, id: `photo_${idx + 1}` })));
        setInput((cur) => (!suppliesUnlocked && !currentLayoutObj && cur === DEFAULT_LAYOUT_PROMPT ? DEFAULT_ANALYZE_PROMPT : cur));
      };
      img.src = dataUrl;
    });
    e.target.value = "";
  };

  const handleLayoutChange = (updatedLayout, commitHistory = true) => {
    setCurrentLayoutObj(updatedLayout);
    setRawSvg(compileLayoutToSvg(updatedLayout, defaultMatHex));
    if (!commitHistory) return;
    const jsonStr = JSON.stringify(updatedLayout, null, 2);
    setMessages((prev) => {
      const lastLayoutIdx = prev.findLastIndex((m) => m.role === "assistant" && m.isLayout);
      if (lastLayoutIdx === -1) return [...prev, { role: "assistant", content: jsonStr, isLayout: true, displayText: "✓ Updated layout via canvas interaction." }];
      return prev.map((m, i) => (i === lastLayoutIdx ? { ...m, content: jsonStr } : m));
    });
  };

  const handleDropInventoryItem = (itemId, xMm, yMm) => {
    const item = inventory?.cutouts?.find((c) => c.id === itemId);
    if (!item) return;
    const baseColor = inventory?.papers?.[0]?.hex || themeRecommendation?.recommended_palette?.[0]?.hex || "#24344D";
    const nextLayout = upsertCutoutInLayout({ currentLayoutObj, item, xMm, yMm, photos, baseColor, defaultMatHex });
    handleLayoutChange(nextLayout, true);
  };

  const generateLayout = () => {
    if (!input.trim() || isOverBudget || photos.length === 0) return;
    const newMessages = [...messages, { role: "user", content: input }];
    setMessages(newMessages);
    setInput("");
    const fallbackPapers = themeRecommendation?.recommended_palette?.map((p, idx) => ({ id: `paper_${idx + 1}`, ...p }));
    const extractedInventory = inventory
      ? { theme: inventory.theme, papers: inventory.papers, cutouts: inventory.cutouts.map(({ id, label, category, item_type, width_mm, height_mm }) => ({ id, label, category, item_type: item_type || "sticker", width_mm, height_mm })) }
      : fallbackPapers?.length ? { theme: themeRecommendation.theme, papers: fallbackPapers, cutouts: [] } : null;
    runAsync(setLoading, async () => {
      const data = await postGenerate({ action: "generate_layout", messages: newMessages, currentLayout: currentLayoutObj ? JSON.stringify(currentLayoutObj) : null, photos: photos.map(({ id, w_in, h_in, label }) => ({ id, w_in, h_in, label })), extractedInventory });
      if (data.svg) {
        setRawSvg(data.svg);
        setCurrentLayoutObj(JSON.parse(data.json));
        setMessages((prev) => [...prev, { role: "assistant", content: data.json, isLayout: true, displayText: "✓ Updated layout using real contour-cut stickers." }]);
      }
    });
  };

  const handleReset = () => {
    setMessages([]); setRawSvg(""); setCurrentLayoutObj(null); setErrorMsg("");
    setThemeRecommendation(null); setSuppliesUnlocked(Boolean(inventory || supplyImage));
  };
  const handleAddPlaceholder = () => setPhotos((p) => [...p, { id: `photo_${p.length + 1}`, label: '4x3" Landscape', w_in: 4, h_in: 3, dataUrl: null }]);
  const handleUpdatePhotoSize = (i, lbl) => {
    const found = SIZE_OPTIONS.find((o) => o.label === lbl);
    if (found) setPhotos((p) => p.map((x, idx) => (idx === i ? { ...x, ...found } : x)));
  };
  const handleRemovePhoto = (i) => setPhotos((p) => p.filter((_, idx) => idx !== i).map((x, idx) => ({ ...x, id: `photo_${idx + 1}` })));

  return (
    <div className="flex h-screen bg-neutral-950 text-white font-sans overflow-hidden">
      <IntakeSidebar
        photos={photos} usedPct={usedPct} isOverBudget={isOverBudget} activeModelBadge={activeModelBadge}
        suppliesUnlocked={suppliesUnlocked} themeRecommendation={themeRecommendation} supplyImage={supplyImage}
        scanningSupplies={scanningSupplies} analyzingPhotos={analyzingPhotos} inventory={inventory}
        messages={messages} errorMsg={errorMsg} input={input} loading={loading} onInputChange={setInput}
        onReset={handleReset} onPhotoUpload={handlePhotoUpload} onAddPlaceholder={handleAddPlaceholder}
        onUpdatePhotoSize={handleUpdatePhotoSize} onRemovePhoto={handleRemovePhoto}
        onAnalyzePhotos={handleAnalyzePhotos} onSkipToSupplies={() => { setSuppliesUnlocked(true); setInput(DEFAULT_LAYOUT_PROMPT); }}
        onSupplyUpload={handleSupplyUpload} onGenerateLayout={generateLayout}
      />
      <CanvasStage
        viewMode={viewMode} onViewModeChange={setViewMode} loading={loading}
        renderedSvg={injectAssetsIntoSvg(rawSvg, photos, inventory?.cutouts || [], viewMode)}
        currentLayout={currentLayoutObj} onUpdateLayout={handleLayoutChange} onDropInventoryItem={handleDropInventoryItem}
      />
      <InventoryTray inventory={inventory} vectorizingId={vectorizingId} onVectorizeCutout={handleVectorizeCutout} />
    </div>
  );
}
