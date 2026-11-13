"use client";

import { useRef, useState } from "react";
import { CANVAS_SIZE_MM, clampToMargin } from "@/lib/svgCompiler";

function clientToSvgCoords(containerEl, clientX, clientY) {
  const svgEl = containerEl?.querySelector("svg");
  if (svgEl && typeof svgEl.getScreenCTM === "function") {
    const ctm = svgEl.getScreenCTM();
    if (ctm) {
      const pt = svgEl.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const svgPt = pt.matrixTransform(ctm.inverse());
      return { x: svgPt.x, y: svgPt.y };
    }
  }
  const rect = containerEl?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) {
    return { x: CANVAS_SIZE_MM / 2, y: CANVAS_SIZE_MM / 2 };
  }
  return {
    x: ((clientX - rect.left) / rect.width) * CANVAS_SIZE_MM,
    y: ((clientY - rect.top) / rect.height) * CANVAS_SIZE_MM,
  };
}

export default function CanvasStage({
  viewMode,
  onViewModeChange,
  loading,
  renderedSvg,
  currentLayout,
  onUpdateLayout,
  onDropInventoryItem,
}) {
  const containerRef = useRef(null);
  const dragRef = useRef(null);
  const [draggingId, setDraggingId] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handlePointerDown = (e) => {
    if (!currentLayout?.objects || loading) return;
    const group = e.target.closest('g[data-draggable="true"][id]');
    if (!group) return;

    const objId = group.getAttribute("id");
    const targetObj = currentLayout.objects.find((o) => o.id === objId);
    if (!targetObj) return;

    const startSvg = clientToSvgCoords(containerRef.current, e.clientX, e.clientY);
    dragRef.current = {
      id: objId,
      startSvg,
      origX: targetObj.center_x,
      origY: targetObj.center_y,
      latestLayout: currentLayout,
      moved: false,
    };
    setDraggingId(objId);
    containerRef.current?.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const handlePointerMove = (e) => {
    const active = dragRef.current;
    if (!active) return;

    const pos = clientToSvgCoords(containerRef.current, e.clientX, e.clientY);
    const dx = pos.x - active.startSvg.x;
    const dy = pos.y - active.startSvg.y;

    const updatedObjects = active.latestLayout.objects.map((obj) => {
      if (obj.id !== active.id) return obj;
      const movedObj = {
        ...obj,
        center_x: active.origX + dx,
        center_y: active.origY + dy,
      };
      clampToMargin(movedObj);
      return movedObj;
    });

    const nextLayout = { ...active.latestLayout, objects: updatedObjects };
    active.latestLayout = nextLayout;
    active.moved = true;
    onUpdateLayout(nextLayout, false);
  };

  const finishPointerDrag = (e) => {
    const active = dragRef.current;
    if (!active) return;
    if (containerRef.current?.hasPointerCapture?.(e.pointerId)) {
      containerRef.current.releasePointerCapture(e.pointerId);
    }
    if (active.moved) {
      onUpdateLayout(active.latestLayout, true);
    }
    dragRef.current = null;
    setDraggingId(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const raw =
      e.dataTransfer.getData("application/json") ||
      e.dataTransfer.getData("text/plain");
    if (!raw || !containerRef.current) return;

    try {
      const payload = JSON.parse(raw);
      if (!payload?.id) return;
      const coords = clientToSvgCoords(containerRef.current, e.clientX, e.clientY);
      onDropInventoryItem(payload.id, coords.x, coords.y);
    } catch {
      // Ignore invalid external drag payloads
    }
  };

  return (
    <div className="flex-1 p-6 flex flex-col items-center justify-center bg-black relative">
      <div className="flex items-center gap-2 mb-4 bg-neutral-900 p-1 rounded-lg border border-neutral-800">
        <button
          onClick={() => onViewModeChange("visual")}
          className={`text-xs px-3 py-1.5 rounded-md font-medium transition ${
            viewMode === "visual"
              ? "bg-blue-600 text-white"
              : "text-neutral-400 hover:text-white"
          }`}
        >
          Visual Design (What You See)
        </button>
        <button
          onClick={() => onViewModeChange("blueprint")}
          className={`text-xs px-3 py-1.5 rounded-md font-medium transition ${
            viewMode === "blueprint"
              ? "bg-amber-600 text-white"
              : "text-neutral-400 hover:text-white"
          }`}
        >
          Blueprint &amp; Cut Lines (Behind the Scenes)
        </button>
      </div>

      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerDrag}
        onPointerCancel={finishPointerDrag}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`w-full max-w-xl aspect-square bg-neutral-900 rounded-lg border shadow-2xl overflow-hidden flex items-center justify-center select-none transition ${
          isDragOver
            ? "border-purple-400 ring-2 ring-purple-500/40"
            : "border-neutral-800"
        } ${draggingId ? "cursor-grabbing" : ""}`}
      >
        {loading ? (
          <div className="animate-pulse text-neutral-400 text-xs">
            Placing photos, cardstock mats, and real contour-cut stickers...
          </div>
        ) : renderedSvg ? (
          <div
            dangerouslySetInnerHTML={{ __html: renderedSvg }}
            className="w-full h-full"
          />
        ) : (
          <div className="text-neutral-500 text-xs text-center px-6 leading-relaxed">
            Upload photos &amp; scan supplies in the left sidebar, then generate a layout or drag stickers from the right tray onto this 12&times;12&quot; canvas.
          </div>
        )}
      </div>
    </div>
  );
}
