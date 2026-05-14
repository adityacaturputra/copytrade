import React from 'react';
import { Log, Message, formatCompactDateTime, getLogLevelBadgeClass } from './types';
import { HoverTapTooltip } from './HoverTapTooltip';

export function InlineLogDetails({ text }: { text?: string | null }) {
  if (!text) return null;

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");

  let startIndex = -1;
  let endIndex = -1;

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    startIndex = firstBrace;
    endIndex = lastBrace;
  } else if (
    firstBracket !== -1 &&
    lastBracket !== -1 &&
    lastBracket > firstBracket
  ) {
    startIndex = firstBracket;
    endIndex = lastBracket;
  }

  if (startIndex !== -1 && endIndex !== -1) {
    const possibleJson = text.slice(startIndex, endIndex + 1);
    try {
      const obj = JSON.parse(possibleJson);
      const formatted = JSON.stringify(obj, null, 2);
      const prefix = text.slice(0, startIndex);
      const suffix = text.slice(endIndex + 1);

      return (
        <span className="break-words">
          {prefix}
          <HoverTapTooltip
            wrapperClassName="mx-1 align-middle"
            triggerClassName="bg-emerald-950/60 text-emerald-300 text-[9px] px-1.5 py-0.5 rounded border border-emerald-800/80 hover:bg-emerald-900/70 transition-colors whitespace-nowrap"
            tooltipClassName="min-w-[250px] max-w-[85vw] md:max-w-[600px] left-0 sm:left-1/2 sm:-translate-x-1/2 font-mono whitespace-pre-wrap text-left"
            trigger={<>...{"{ }"} JSON</>}
            content={formatted}
          />
          {suffix}
        </span>
      );
    } catch {
      // not valid json
    }
  }

  return <span className="break-words">{text}</span>;
}
