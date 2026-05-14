import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Position, DraftTrade, formatUsd, formatCompactDateTime, getPositionSourceLabel, getPositionKey, formatPositionTakeProfitTargets, calculatePositionPnlUsd, estimatePositionMargin, formatMarginMode, resolvePositionPnlUsd, resolvePositionPnlPercent, DraftAction } from './types';
import { PaginationBar } from './PaginationBar';
import { StatusBadge } from './StatusBadge';
import { ProcessLogsAccordion } from './ProcessLogsAccordion';

export function ImageModal({
  urls,
  initialIndex,
  onClose,
}: {
  urls: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const modalRef = useRef<HTMLDivElement>(null);

  const currentUrl = urls[index];
  const isVideo = /\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i.test(currentUrl);

  const goNext = () => {
    setIndex((i) => (i + 1) % urls.length);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const goPrev = () => {
    setIndex((i) => (i - 1 + urls.length) % urls.length);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setZoom((z) => Math.min(Math.max(z + delta, 0.5), 5));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({
      x: panStart.current.x + dx,
      y: panStart.current.y + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(z + 0.25, 5));
      if (e.key === "-" || e.key === "_")
        setZoom((z) => Math.max(z - 0.25, 0.5));
      if (e.key === "0") resetView();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === modalRef.current) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-white text-sm font-medium">
            {index + 1} / {urls.length}
          </span>
          {isVideo && (
            <span className="text-xs bg-purple-700/60 text-purple-200 px-2 py-0.5 rounded">
              🎬 Video
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setZoom((z) => Math.min(z + 0.25, 5));
            }}
            className="bg-white/10 hover:bg-white/20 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm transition"
            title="Zoom in (+)"
          >
            +
          </button>
          <span className="text-white/70 text-xs font-mono min-w-[3rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setZoom((z) => Math.max(z - 0.25, 0.5));
            }}
            className="bg-white/10 hover:bg-white/20 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm transition"
            title="Zoom out (-)"
          >
            −
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              resetView();
            }}
            className="bg-white/10 hover:bg-white/20 text-white w-8 h-8 rounded-lg flex items-center justify-center text-xs transition"
            title="Reset zoom (0)"
          >
            1:1
          </button>
          <div className="w-px h-5 bg-white/20 mx-1" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="bg-white/10 hover:bg-red-600/60 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm transition"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Prev button */}
      {urls.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white w-10 h-10 rounded-full flex items-center justify-center text-xl transition"
          title="Previous (←)"
        >
          ‹
        </button>
      )}

      {/* Next button */}
      {urls.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white w-10 h-10 rounded-full flex items-center justify-center text-xl transition"
          title="Next (→)"
        >
          ›
        </button>
      )}

      {/* Media content */}
      <div
        className="relative z-[5] flex items-center justify-center w-full h-full p-12 pt-16 pb-4"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default",
        }}
      >
        <div
          className="transition-transform duration-150 ease-out"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        >
          {isVideo ? (
            <video
              src={currentUrl}
              controls
              autoPlay
              className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={currentUrl}
              alt={`Attachment ${index + 1}`}
              className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl object-contain"
              draggable={false}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      </div>

      {/* Bottom hint */}
      <div className="absolute bottom-3 left-0 right-0 z-10 text-center">
        <p className="text-white/30 text-xs">
          Scroll to zoom • Drag to pan • Arrow keys to navigate • Esc to close
        </p>
      </div>
    </div>
  );
}
