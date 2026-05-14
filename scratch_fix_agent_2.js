const fs = require('fs');

const file = 'client/src/app/agent/page.tsx';
let content = fs.readFileSync(file, 'utf-8');

const regex = new RegExp(`function formatToolResult\\([\\s\\S]*?\\n}\\n`, 'm');
const match = content.match(regex);
if (match) {
  content = content.replace(regex, '');
  fs.writeFileSync(file, content);
  
  const utilCode = `export ${match[0]}`;
  fs.writeFileSync('client/src/app/agent/utils.ts', utilCode);
}

const stepCardFile = 'client/src/app/agent/components/StepCard.tsx';
let stepContent = fs.readFileSync(stepCardFile, 'utf-8');
stepContent = `import { formatToolResult } from '../utils';\n` + stepContent;
fs.writeFileSync(stepCardFile, stepContent);

