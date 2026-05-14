const fs = require('fs');
const path = require('path');

const inputFile = 'server/src/lib/agent/tooling/definitions.ts';
const outputDir = 'server/src/lib/agent/tooling/categories';

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

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

for (let i = 0; i < categories.length; i++) {
  const cat = categories[i];
  const nextCat = categories[i + 1];
  
  const startMarker = `// ─── ${cat.header}`;
  let startIndex = content.indexOf(startMarker);
  
  if (startIndex === -1) {
    console.error(`Could not find start marker for ${cat.name}`);
    continue;
  }

  // Find the start of the first tool object after the header
  startIndex = content.indexOf('{', startIndex);
  
  let endIndex;
  if (nextCat) {
    const nextMarker = `// ─── ${nextCat.header}`;
    endIndex = content.indexOf(nextMarker, startIndex);
    // Go back to the last closing brace and comma before the next header
    endIndex = content.lastIndexOf('},', endIndex);
    if (endIndex === -1) {
       // Try without comma
       endIndex = content.lastIndexOf('}', endIndex);
    } else {
       endIndex += 1; // Include the brace
    }
  } else {
    endIndex = content.lastIndexOf('},');
    if (endIndex === -1) {
      endIndex = content.lastIndexOf('}');
    } else {
      endIndex += 1;
    }
  }

  let toolBlock = content.substring(startIndex, endIndex).trim();
  
  // Ensure the block is valid JSON-like array content
  const fileContent = `import OpenAI from "openai";\n\nexport const ${cat.name.replace(/-/g, '_')}Tools: OpenAI.ChatCompletionTool[] = [\n  ${toolBlock}\n];\n`;
  
  fs.writeFileSync(path.join(outputDir, `${cat.name}.ts`), fileContent);
}

// Generate new definitions.ts
const imports = categories.map(cat => `import { ${cat.name.replace(/-/g, '_')}Tools } from "./categories/${cat.name}";`).join('\n');
const combined = `import OpenAI from "openai";\n${imports}\n\nexport const agentTools: OpenAI.ChatCompletionTool[] = [\n  ${categories.map(cat => `...${cat.name.replace(/-/g, '_')}Tools`).join(',\n  ')}\n];\n`;

fs.writeFileSync(inputFile, combined);
console.log('Successfully split definitions.ts');
