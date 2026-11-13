"use client";

export const SIZE_OPTIONS = [
  { label: '4x6" Portrait', w_in: 4, h_in: 6 },
  { label: '3x4" Portrait', w_in: 3, h_in: 4 },
  { label: '2x3" Portrait', w_in: 2, h_in: 3 },
  { label: '6x4" Landscape', w_in: 6, h_in: 4 },
  { label: '4x3" Landscape', w_in: 4, h_in: 3 },
  { label: '3x2" Landscape', w_in: 3, h_in: 2 },
  { label: '4x4" Square', w_in: 4, h_in: 4 },
  { label: '3x3" Square', w_in: 3, h_in: 3 },
];

export default function IntakeSidebar({
  photos, usedPct, isOverBudget, activeModelBadge, suppliesUnlocked,
  themeRecommendation, supplyImage, scanningSupplies, analyzingPhotos,
  inventory, messages, errorMsg, input, loading, onInputChange, onReset,
  onPhotoUpload, onAddPlaceholder, onUpdatePhotoSize, onRemovePhoto,
  onAnalyzePhotos, onSkipToSupplies, onSupplyUpload, onGenerateLayout,
}) {
  const showSupplies = Boolean(suppliesUnlocked || inventory || supplyImage);
  const hasRealPhotos = photos.some((p) => Boolean(p.dataUrl));
  const isStageAPhotoPrompt = !showSupplies && hasRealPhotos && /analyz|theme|palette/i.test(input);
  const handlePrimarySubmit = () => (isStageAPhotoPrompt ? onAnalyzePhotos() : onGenerateLayout());

  return (
    <div className="w-80 p-4 border-r border-neutral-800 flex flex-col overflow-hidden shrink-0">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-bold text-neutral-100">Scrapbook AI</h1>
          {activeModelBadge && (
            <span className="text-[10px] font-mono text-emerald-400">Vision: {activeModelBadge}</span>
          )}
        </div>
        <button
          onClick={onReset}
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
          <span className={`text-xs font-mono font-bold ${isOverBudget ? "text-red-400" : "text-emerald-400"}`}>
            {usedPct.toFixed(1)}% / 50%
          </span>
        </div>
        <div className="w-full h-1.5 bg-neutral-950 rounded-full overflow-hidden mb-2.5">
          <div
            className={`h-full ${isOverBudget ? "bg-red-500" : "bg-emerald-500"}`}
            style={{ width: `${Math.min(100, (usedPct / 50) * 100)}%` }}
          />
        </div>

        <div className="flex gap-1.5 mb-2">
          <label className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-500 rounded font-medium cursor-pointer">
            + Upload Photos
            <input type="file" accept="image/*" multiple onChange={onPhotoUpload} className="hidden" />
          </label>
          <button
            onClick={onAddPlaceholder}
            className="text-xs px-2 py-1 bg-neutral-800 hover:bg-neutral-700 rounded border border-neutral-700 text-neutral-300"
          >
            + Placeholder
          </button>
        </div>

        <div className="max-h-28 overflow-y-auto space-y-1.5">
          {photos.map((p, idx) => (
            <div
              key={p.id}
              className="flex items-center justify-between text-xs bg-neutral-950 px-2 py-1 rounded border border-neutral-800 gap-1.5"
            >
              <span className="font-bold text-blue-400">#{idx + 1}</span>
              {p.dataUrl && <img src={p.dataUrl} alt="" className="w-5 h-5 object-cover rounded" />}
              <select
                value={p.label}
                onChange={(e) => onUpdatePhotoSize(idx, e.target.value)}
                className="bg-neutral-900 text-neutral-200 text-xs rounded px-1 py-0.5 border border-neutral-700 flex-1 truncate"
              >
                {SIZE_OPTIONS.map((opt) => (
                  <option key={opt.label} value={opt.label}>{opt.label}</option>
                ))}
              </select>
              <button onClick={() => onRemovePhoto(idx)} className="text-neutral-500 hover:text-red-400 px-1">
                &times;
              </button>
            </div>
          ))}
        </div>

        {!showSupplies && (
          <div className="mt-2.5 pt-2 border-t border-neutral-800 flex gap-1.5">
            <button
              onClick={onAnalyzePhotos}
              disabled={analyzingPhotos || photos.length === 0}
              className="flex-1 text-[11px] py-1.5 px-2 bg-emerald-700 hover:bg-emerald-600 rounded font-medium disabled:opacity-40"
            >
              {analyzingPhotos ? "Scanning Photos..." : "✦ Scan Photos for Theme"}
            </button>
            <button
              onClick={onSkipToSupplies}
              className="text-[11px] py-1.5 px-2 bg-neutral-800 hover:bg-neutral-700 rounded border border-neutral-700 text-neutral-300"
            >
              Skip →
            </button>
          </div>
        )}
      </div>

      {/* AI Theme Recommendation Banner */}
      {themeRecommendation && (
        <div className="bg-emerald-950/30 border border-emerald-800/60 rounded-lg p-2.5 mb-3 text-xs">
          <div className="font-semibold text-emerald-300 mb-1">Theme: {themeRecommendation.theme}</div>
          {themeRecommendation.recommended_palette?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              {themeRecommendation.recommended_palette.map((c, idx) => (
                <div key={idx} className="flex items-center gap-1 bg-neutral-900/80 px-1.5 py-0.5 rounded border border-neutral-800">
                  <span className="w-3 h-3 rounded-sm border border-white/20" style={{ backgroundColor: c.hex }} />
                  <span className="text-[10px] text-neutral-300">{c.name}</span>
                </div>
              ))}
            </div>
          )}
          {themeRecommendation.summary && (
            <p className="text-[11px] text-neutral-400 leading-snug">{themeRecommendation.summary}</p>
          )}
        </div>
      )}

      {/* 2. Scan & Cut Supplies (Progressive) */}
      {showSupplies && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 mb-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-neutral-300">
              2. Scan &amp; Cut Supplies
            </span>
            <label className="text-xs px-2.5 py-1 bg-purple-600 hover:bg-purple-500 rounded font-medium cursor-pointer">
              {scanningSupplies ? "Cutting..." : supplyImage ? "Rescan Sheet" : "Upload Sheet"}
              <input
                type="file"
                accept="image/*"
                onChange={onSupplyUpload}
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
      )}

      {/* Chat Log */}
      <div className="flex-1 overflow-y-auto mb-3 space-y-2 pr-1">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`p-2 rounded text-xs ${
              msg.role === "user"
                ? "bg-blue-950/60 border border-blue-800/50 ml-4"
                : "bg-neutral-900 border border-neutral-800 mr-4 text-neutral-200"
            }`}
          >
            {msg.role === "user" ? msg.content : msg.displayText || "✓ Updated layout using real contour-cut stickers."}
          </div>
        ))}
        {errorMsg && (
          <div className="p-2 rounded text-xs bg-red-950/80 border border-red-700 text-red-200">{errorMsg}</div>
        )}
      </div>

      {/* Command Input */}
      <div className="pt-2 border-t border-neutral-800">
        <textarea
          className="w-full p-2.5 bg-neutral-900 rounded border border-neutral-700 text-xs resize-none h-20 mb-2 outline-none focus:border-blue-500"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="e.g., Move sticker_1 above photo_1..."
        />
        <button
          onClick={handlePrimarySubmit}
          disabled={loading || scanningSupplies || analyzingPhotos || isOverBudget}
          className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded text-xs font-semibold disabled:opacity-40"
        >
          {loading ? "Designing Page..." : analyzingPhotos ? "Analyzing Photos..." : isStageAPhotoPrompt ? "Analyze Photos" : "Design / Update Canvas"}
        </button>
      </div>
    </div>
  );
}
