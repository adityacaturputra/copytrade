const fs = require('fs');
const path = require('path');

const dir = 'client/src/components/dashboard';

const fixes = {
  'DraftCard.tsx': [
    `import { calculateRisk } from "@copytrade/shared/lib/risk-calc";`,
    `import { autoCalculateTPFromRR } from "@copytrade/shared/lib/executor-signal-utils";`,
    `import { RiskConfig } from './types';`
  ],
  'DraftsTab.tsx': [
    `import { RiskConfig } from './types';`
  ],
  'PositionsTab.tsx': [
    `import { HoverTapTooltip } from './HoverTapTooltip';`,
    `import { getCompactDateTimeParts } from './types';`
  ],
  'PositionSummaryPanel.tsx': [
    `import { HoverTapTooltip } from './HoverTapTooltip';`,
    `import { getCompactDateTimeParts } from './types';`
  ]
};

for (const [file, linesToAdd] of Object.entries(fixes)) {
  const filePath = path.join(dir, file);
  if (!fs.existsSync(filePath)) continue;
  
  let content = fs.readFileSync(filePath, 'utf-8');
  
  const toAdd = linesToAdd.join('\n') + '\n';
  fs.writeFileSync(filePath, toAdd + content);
}

// Special fixes
const dcPath = path.join(dir, 'DraftCard.tsx');
let dcContent = fs.readFileSync(dcPath, 'utf-8');
dcContent = dcContent.replace(`{autoTPs.map((tp, idx) => (`, `{autoTPs.map((tp: number, idx: number) => (`);
fs.writeFileSync(dcPath, dcContent);

const pspPath = path.join(dir, 'PositionSummaryPanel.tsx');
let pspContent = fs.readFileSync(pspPath, 'utf-8');
pspContent = pspContent.replace(`import React, { useState, useEffect, useCallback, useRef } from 'react';`, `import React, { useState, useEffect, useCallback, useRef, ReactNode } from 'react';`);
fs.writeFileSync(pspPath, pspContent);

