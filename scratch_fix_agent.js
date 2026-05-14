const fs = require('fs');
const path = require('path');

const file = 'client/src/app/agent/page.tsx';
let content = fs.readFileSync(file, 'utf-8');

const lines = content.split('\n');

const typesStart = lines.findIndex(l => l.includes('interface AgentStep {'));
const typesEnd = lines.findIndex(l => l.includes('const API_BASE ='));

if (typesStart !== -1 && typesEnd !== -1) {
  const extractedLines = lines.slice(typesStart, typesEnd);
  
  const typesContent = extractedLines.join('\n').replace(/interface/g, 'export interface').replace(/type /g, 'export type ');
  
  fs.writeFileSync('client/src/app/agent/types.ts', typesContent);
  
  // Replace in page.tsx
  const newLines = [
    ...lines.slice(0, typesStart),
    `import { AgentStep, AgentApproval, ChatMessage, AgentRole, HistoryItem } from "./types";`,
    ...lines.slice(typesEnd)
  ];
  
  fs.writeFileSync(file, newLines.join('\n'));
}

// Fix imports in components
const componentsDir = 'client/src/app/agent/components';

for (const comp of ['ApprovalCard', 'StepCard']) {
  const compPath = path.join(componentsDir, `${comp}.tsx`);
  if (!fs.existsSync(compPath)) continue;
  
  let compContent = fs.readFileSync(compPath, 'utf-8');
  // Replace the broken shared import with local type import
  compContent = compContent.replace(
    `import { AgentStep, ActionApprovalRequest, ApprovalDecision } from '@copytrade/shared/lib/agent/types';`,
    `import { AgentStep, AgentApproval } from '../types';`
  );
  fs.writeFileSync(compPath, compContent);
}
