const fs = require('fs');
const content = fs.readFileSync('client/src/app/page.tsx', 'utf-8').split('\n');

const extract = content.slice(16, 357); // lines 17 to 357 (0-indexed 16 to 356)
const processed = extract.map(line => {
  if (line.startsWith('interface ') || line.startsWith('type ') || line.startsWith('function ') || line.startsWith('const ')) {
    return 'export ' + line;
  }
  return line;
});

const header = `import { calculateRisk } from "@copytrade/shared/lib/risk-calc";
import { autoCalculateTPFromRR } from "@copytrade/shared/lib/executor-signal-utils";\n\n`;

fs.writeFileSync('client/src/components/dashboard/types.ts', header + processed.join('\n'));
