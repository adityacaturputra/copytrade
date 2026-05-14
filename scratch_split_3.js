const fs = require('fs');

const file = 'client/src/app/page.tsx';
let content = fs.readFileSync(file, 'utf-8');

const componentsToExtract = [
  'PositionsTab',
  'DraftsTab',
  'DraftCard',
  'PositionSummaryPanel',
  'ImageModal'
];

let imports = new Set();
let newFiles = {};

for (const comp of componentsToExtract) {
  const regex = new RegExp(`function ${comp}\\([\\s\\S]*?\\n}\\n`, 'm');
  const match = content.match(regex);
  if (match) {
    const componentCode = match[0];
    let fileContent = `import React, { useState, useEffect, useCallback, useRef } from 'react';\n`;
    fileContent += `import { Position, DraftTrade, formatUsd, formatCompactDateTime, getPositionSourceLabel, getPositionKey, formatPositionTakeProfitTargets, calculatePositionPnlUsd, estimatePositionMargin, formatMarginMode, resolvePositionPnlUsd, resolvePositionPnlPercent, DraftAction } from './types';\n`;
    fileContent += `import { PaginationBar } from './PaginationBar';\n`;
    fileContent += `import { StatusBadge } from './StatusBadge';\n`;
    fileContent += `import { ProcessLogsAccordion } from './ProcessLogsAccordion';\n`;
    
    if (comp === 'PositionsTab') {
      fileContent += `import { PositionSummaryPanel } from './PositionSummaryPanel';\n`;
      fileContent += `import { ImageModal } from './ImageModal';\n`;
    }
    if (comp === 'DraftsTab') {
      fileContent += `import { DraftCard } from './DraftCard';\n`;
    }
    if (comp === 'DraftCard') {
      fileContent += `import { ImageModal } from './ImageModal';\n`;
    }

    fileContent += `\nexport ${componentCode}`;
    newFiles[comp] = fileContent;
    content = content.replace(regex, '');
    imports.add(`import { ${comp} } from "@/components/dashboard/${comp}";`);
  }
}

// Add imports to the top
const lines = content.split('\n');
const importIndex = lines.findIndex(l => l.includes('// ==================== Component ===================='));
lines.splice(importIndex, 0, ...Array.from(imports));

fs.writeFileSync(file, lines.join('\n'));

for (const [name, code] of Object.entries(newFiles)) {
  fs.writeFileSync(`client/src/components/dashboard/${name}.tsx`, code);
}
