"use client";

function WashiStripPreview({ item }) {
  const primary = item.primary_hex || "#9E222B";
  const secondary = item.secondary_hex || "#C2B29C";
  const pattern = item.pattern_type || "solid";
  const clipId = `tray_clip_${item.id}`;
  const patId = `tray_pat_${item.id}`;
  const torn =
    "M 6 6 L 94 6 L 91 9 L 95 12 L 90 16 L 95 19 L 92 22 L 6 22 L 4 19 L 8 16 L 4 12 L 8 9 Z";

  return (
    <svg viewBox="0 0 100 28" className="w-full h-7 overflow-visible pointer-events-none">
      <defs>
        <clipPath id={clipId}>
          <path d={torn} />
        </clipPath>
        {pattern === "plaid" && (
          <pattern id={patId} width="12" height="12" patternUnits="userSpaceOnUse">
            <rect width="12" height="12" fill="transparent" />
            <rect x="0" y="2" width="12" height="3" fill={secondary} opacity="0.6" />
            <rect x="2" y="0" width="3" height="12" fill={secondary} opacity="0.6" />
            <rect x="0" y="8" width="12" height="1.2" fill="#2b1815" opacity="0.35" />
            <rect x="8" y="0" width="1.2" height="12" fill="#2b1815" opacity="0.35" />
          </pattern>
        )}
        {pattern === "striped" && (
          <pattern id={patId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect x="0" y="0" width="3" height="8" fill={secondary} opacity="0.58" />
          </pattern>
        )}
        {(pattern === "speckled" || pattern === "polka") && (
          <pattern id={patId} width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="3" r="1.2" fill={secondary} opacity="0.7" />
            <circle cx="7" cy="7" r="1" fill={secondary} opacity="0.6" />
          </pattern>
        )}
      </defs>
      <path d={torn} fill={primary} fillOpacity="0.9" />
      {(pattern === "plaid" || pattern === "striped" || pattern === "speckled" || pattern === "polka") && (
        <rect x="2" y="5" width="96" height="18" fill={`url(#${patId})`} clipPath={`url(#${clipId})`} />
      )}
      <path d={torn} fill="none" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="0.6" />
    </svg>
  );
}

export default function InventoryTray({
  inventory,
  vectorizingId,
  onVectorizeCutout,
}) {
  const handleDragStart = (e, item) => {
    const payload = JSON.stringify({ id: item.id });
    e.dataTransfer.setData("application/json", payload);
    e.dataTransfer.setData("text/plain", payload);
    e.dataTransfer.effectAllowed = "copy";
  };

  const washiItems = inventory?.cutouts?.filter((c) => c.item_type === "washi_tape") || [];
  const stickerItems = inventory?.cutouts?.filter((c) => c.item_type !== "washi_tape") || [];

  return (
    <div className="w-80 p-4 border-l border-neutral-800 bg-neutral-900/40 flex flex-col overflow-hidden shrink-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-300">
          Extracted Inventory Tray
        </h2>
        {inventory?.cutouts?.length > 0 && (
          <span className="text-[10px] text-neutral-500">Drag onto canvas</span>
        )}
      </div>

      {!inventory ? (
        <div className="text-xs text-neutral-500 leading-relaxed">
          No supplies scanned yet. Upload your sticker &amp; cardstock photo to isolate all sticker sheets, loose tags, washi tape, and paper swatches.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Detected Papers */}
          <div>
            <span className="text-[11px] font-semibold uppercase text-neutral-400 block mb-1.5">
              Cardstock &amp; Papers ({inventory.papers?.length || 0})
            </span>
            <div className="space-y-1.5">
              {inventory.papers?.map((paper) => {
                const colorLabel =
                  paper.color_name && paper.color_name !== paper.name
                    ? `${paper.name} (${paper.color_name})`
                    : paper.name;
                return (
                  <div
                    key={paper.id}
                    className="flex items-center gap-2 bg-neutral-900 p-1.5 rounded border border-neutral-800 text-xs"
                  >
                    <div className="relative w-7 h-7 rounded border border-white/20 shrink-0 overflow-hidden bg-neutral-950">
                      {paper.swatchUrl ? (
                        <img
                          src={paper.swatchUrl}
                          alt={paper.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full" style={{ backgroundColor: paper.hex }} />
                      )}
                      <span
                        title={`Color: ${paper.hex}`}
                        className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-tl border-t border-l border-white/40"
                        style={{ backgroundColor: paper.hex }}
                      />
                    </div>
                    <div className="truncate flex-1">
                      <div className="font-medium text-neutral-200 truncate" title={colorLabel}>
                        {colorLabel}
                      </div>
                      <div className="text-[10px] text-neutral-400 font-mono truncate">
                        {paper.hex}
                        {paper.secondary_hex ? ` / ${paper.secondary_hex}` : ""} &bull;{" "}
                        {paper.pattern_type || "solid"} &bull; {paper.role}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Washi Tape Rolls -> Torn Corner Strips */}
          {washiItems.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold uppercase text-neutral-400">
                  Washi Tape Rolls ({washiItems.length})
                </span>
              </div>
              <p className="text-[10px] text-neutral-500 mb-1.5">
                Drag to photo corners &bull; Hover ends to lengthen/shorten
              </p>
              <div className="space-y-1.5">
                {washiItems.map((item) => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, item)}
                    title="Drag a torn strip onto any photo corner or canvas area"
                    className="bg-neutral-900 border border-neutral-800 hover:border-amber-500/70 rounded p-2 cursor-grab active:cursor-grabbing transition"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {item.rollThumbUrl && (
                        <img
                          src={item.rollThumbUrl}
                          alt={item.label}
                          draggable={false}
                          className="w-6 h-6 rounded-full object-cover border border-white/20 shrink-0 pointer-events-none"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-neutral-200 truncate">
                          {item.label}
                        </div>
                        <div className="text-[10px] font-mono text-neutral-400 truncate">
                          {item.color_name} &bull; {item.primary_hex}
                          {item.secondary_hex && item.pattern_type !== "solid"
                            ? ` / ${item.secondary_hex}`
                            : ""}
                        </div>
                      </div>
                    </div>
                    <WashiStripPreview item={item} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Real Cropped Stickers, Loose Ephemera & Cut SVGs */}
          <div>
            <span className="text-[11px] font-semibold uppercase text-neutral-400 block mb-1.5">
              Stickers, Tags &amp; Ephemera ({stickerItems.length})
            </span>
            <div className="grid grid-cols-2 gap-2">
              {stickerItems.map((item) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                  title="Drag onto the 12x12 canvas"
                  className={`border rounded p-2 flex flex-col items-center text-center cursor-grab active:cursor-grabbing transition hover:border-purple-500/70 ${
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
                        className="w-12 h-12 overflow-visible pointer-events-none"
                        dangerouslySetInnerHTML={{ __html: item.svgInner }}
                      />
                    ) : (
                      item.cropUrl && (
                        <img
                          src={item.cropUrl}
                          alt={item.label}
                          draggable={false}
                          className="max-h-full max-w-full object-contain pointer-events-none"
                        />
                      )
                    )}
                  </div>

                  <div className="flex items-center gap-1 max-w-full">
                    <span
                      className={`text-[10px] font-mono font-bold ${
                        item.item_type === "cut_svg"
                          ? "text-emerald-400"
                          : item.supply_origin === "loose"
                          ? "text-amber-400"
                          : "text-purple-400"
                      }`}
                    >
                      {item.id}
                    </span>
                    {item.category && (
                      <span className="text-[9px] px-1 py-0.2 bg-neutral-800 text-neutral-400 rounded truncate">
                        {item.category}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-neutral-200 line-clamp-1 mb-1">
                    {item.label}
                  </span>

                  {item.item_type !== "cut_svg" ? (
                    <button
                      onClick={() => onVectorizeCutout(item)}
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
  );
}
