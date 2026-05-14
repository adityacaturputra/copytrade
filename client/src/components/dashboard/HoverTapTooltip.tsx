import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { Log, Message, formatCompactDateTime, getLogLevelBadgeClass } from './types';

export function HoverTapTooltip({
  trigger,
  content,
  wrapperClassName = "",
  triggerClassName = "",
  tooltipClassName = "",
}: {
  trigger: ReactNode;
  content: ReactNode;
  wrapperClassName?: string;
  triggerClassName?: string;
  tooltipClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutside = (event: MouseEvent | TouchEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [isOpen]);

  return (
    <span
      ref={wrapperRef}
      className={`relative inline-flex ${isOpen ? "z-30" : "z-0"} ${wrapperClassName}`}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className={`appearance-none border-0 bg-transparent p-0 text-inherit ${triggerClassName}`}
        aria-expanded={isOpen}
      >
        {trigger}
      </button>
      <div
        className={`absolute bottom-full mb-2 z-[100] rounded-xl border border-slate-600/90 bg-slate-900 px-4 py-3 text-xs text-slate-100 shadow-[0_0_20px_rgba(0,0,0,0.8)] whitespace-normal break-words leading-relaxed ${isOpen ? "block" : "hidden"} ${tooltipClassName}`}
      >
        {content}
      </div>
    </span>
  );
}
