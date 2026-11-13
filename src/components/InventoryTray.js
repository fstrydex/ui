"use client";

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
