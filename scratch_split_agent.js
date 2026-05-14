const fs = require('fs');

const file = 'client/src/app/agent/page.tsx';
let content = fs.readFileSync(file, 'utf-8');

const componentsToExtract = [
  'ApprovalCard',
  'StepCard'
];

let imports = new Set();
let newFiles = {};

for (const comp of componentsToExtract) {
  const regex = new RegExp(`function ${comp}\\([\\s\\S]*?\\n}\\n`, 'm');
  const match = content.match(regex);
  if (match) {
    const componentCode = match[0];
    let fileContent = `import React from 'react';\n`;
    fileContent += `import { AgentStep, ActionApprovalRequest, ApprovalDecision } from '@copytrade/shared/lib/agent/types';\n`;

    fileContent += `\nexport ${componentCode}`;
    newFiles[comp] = fileContent;
    content = content.replace(regex, '');
    imports.add(`import { ${comp} } from "./components/${comp}";`);
  }
}

// Add imports to the top
const lines = content.split('\n');
const importIndex = lines.findIndex(l => l.includes('export default function AgentChatPage()'));
if(importIndex !== -1) {
    lines.splice(importIndex, 0, ...Array.from(imports));
} else {
    lines.unshift(...Array.from(imports));
}

fs.writeFileSync(file, lines.join('\n'));

fs.mkdirSync('client/src/app/agent/components', { recursive: true });
for (const [name, code] of Object.entries(newFiles)) {
  fs.writeFileSync(`client/src/app/agent/components/${name}.tsx`, code);
}
