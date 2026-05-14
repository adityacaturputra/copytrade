const fs = require('fs');

const file = 'client/src/app/page.tsx';
let content = fs.readFileSync(file, 'utf-8');

const componentsToExtract = [
  'SignalsTab',
  'LogsTab',
  'InlineLogDetails',
  'HoverTapTooltip',
  'ProcessLogsAccordion'
];

let imports = new Set();
let newFiles = {};

for (const comp of componentsToExtract) {
  const regex = new RegExp(`function ${comp}\\([\\s\\S]*?\\n}\\n`, 'm');
  const match = content.match(regex);
  if (match) {
    const componentCode = match[0];
    let fileContent = `import React from 'react';\n`;
    fileContent += `import { Log, Message, formatCompactDateTime, getLogLevelBadgeClass } from './types';\n`;
    
    if (comp === 'LogsTab') {
      fileContent += `import { InlineLogDetails } from './InlineLogDetails';\n`;
    }
    if (comp === 'InlineLogDetails' || comp === 'ProcessLogsAccordion') {
      fileContent += `import { HoverTapTooltip } from './HoverTapTooltip';\n`;
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
