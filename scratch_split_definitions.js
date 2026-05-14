const fs = require('fs');
const path = require('path');

const inputFile = 'server/src/lib/agent/tooling/definitions.ts';
const outputDir = 'server/src/lib/agent/tooling/categories';

const content = fs.readFileSync(inputFile, 'utf-8');

const categories = [
  { name: 'account-market', header: 'Account & Market' },
  { name: 'orders-trading', header: 'Orders & Trading' },
  { name: 'order-mgmt', header: 'Order Management' },
  { name: 'drafts', header: 'Drafts' },
  { name: 'signal-sources', header: 'Signal Sources' },
  { name: 'position-ops', header: 'Position Ops' },
  { name: 'database-logs', header: 'Database & Logs' },
  { name: 'settings-risk', header: 'Settings' }
];

let currentIndex = 0;
const results = [];

for (let i = 0; i < categories.length; i++) {
  const cat = categories[i];
  const nextCat = categories[i + 1];
  
  const startHeader = `// ─── ${cat.header} ───`;
  const endHeader = nextCat ? `// ─── ${nextCat.header} ───` : '];';
  
  let startIndex = content.indexOf(startHeader);
  if (startIndex === -1) {
    console.error(`Could not find start header for ${cat.name}`);
    continue;
  }
  
  let endIndex = content.indexOf(endHeader, startIndex + startHeader.length);
  if (endIndex === -1) {
    endIndex = content.lastIndexOf('];');
  }
  
  let toolBlock = content.substring(startIndex, endIndex).trim();
  
  // Clean up trailing commas if needed
  if (toolBlock.endsWith(',')) {
    toolBlock = toolBlock.slice(0, -1);
  }

  const fileContent = `import OpenAI from "openai";\n\nexport const ${cat.name.replace(/-/g, '_')}Tools: OpenAI.ChatCompletionTool[] = [\n  ${toolBlock.replace(`// ─── ${cat.header} ──────────────────────────────────────────`, '').trim()}\n];`;
  
  fs.writeFileSync(path.join(outputDir, `${cat.name}.ts`), fileContent);
  results.push(cat.name);
}

// Generate new definitions.ts
const imports = categories.map(cat => `import { ${cat.name.replace(/-/g, '_')}Tools } from "./categories/${cat.name}";`).join('\n');
const combined = `import OpenAI from "openai";\n${imports}\n\nexport const agentTools: OpenAI.ChatCompletionTool[] = [\n  ${categories.map(cat => `...${cat.name.replace(/-/g, '_')}Tools`).join(',\n  ')}\n];\n`;

fs.writeFileSync(inputFile, combined);
console.log('Successfully split definitions.ts into:', results.join(', '));
