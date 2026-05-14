const fs = require('fs');

const file = 'shared/src/lib/executor.ts';
let content = fs.readFileSync(file, 'utf-8');

function extractFunction(name, isAsync = true) {
  const prefix = isAsync ? 'export async function ' : 'export function ';
  const regex = new RegExp(`^${prefix}${name}\\([\\s\\S]*?\\n}\\n`, 'm');
  const match = content.match(regex);
  if (match) {
    content = content.replace(regex, '');
    return match[0];
  }
  
  // Try non-exported
  const regex2 = new RegExp(`^async function ${name}\\([\\s\\S]*?\\n}\\n`, 'm');
  const match2 = content.match(regex2);
  if (match2) {
    content = content.replace(regex2, '');
    return match2[0];
  }
  
  const regex3 = new RegExp(`^function ${name}\\([\\s\\S]*?\\n}\\n`, 'm');
  const match3 = content.match(regex3);
  if (match3) {
    content = content.replace(regex3, '');
    return match3[0];
  }
  return null;
}

const checkDuplicate = extractFunction('checkDuplicatePosition');
const splitQty = extractFunction('splitQuantityForTPs');
const roundUp = extractFunction('roundUpToStep', false);
const runSignalCheck = extractFunction('runSignalCheck');

// 1. executor-quantity.ts
fs.writeFileSync('shared/src/lib/executor-quantity.ts', 
  `import { logExecutorInfo } from "./process-log";\n\n` + 
  (splitQty || '') + '\n' + (roundUp ? `export ${roundUp}` : '')
);

// 2. executor-position-mgmt.ts
fs.writeFileSync('shared/src/lib/executor-position-mgmt.ts',
  `import { Position } from "./database";\nimport { buildTPTargets } from "./database";\nimport { DuplicateCheckResult } from "./executor-types";\n\n` + 
  (checkDuplicate || '')
);

// 3. executor-signal-check.ts
fs.writeFileSync('shared/src/lib/executor-signal-check.ts',
  `import { connectDB, SignalMessage, ProcessedMessage, Position, DraftTrade, Account } from "./database";
import { getSignalConfig } from "./signal-config";
import { logExecutorInfo, logExecutorWarning, logExecutorError } from "./process-log";
import { resolvePositionPnlPercent } from "./executor-signal-utils";
import { calculateRiskBasedPosition } from "./risk-calc";
import { SourceContext } from "./executor-source-context";
import { AnalysisContext } from "./executor-analysis-context";
import { DuplicateCheckResult } from "./executor-types";
import { checkDuplicatePosition } from "./executor-position-mgmt";\n\n` +
  (runSignalCheck || '')
);

// Rewrite executor.ts with imports
const imports = `import { splitQuantityForTPs, roundUpToStep } from "./executor-quantity";
import { checkDuplicatePosition } from "./executor-position-mgmt";
import { runSignalCheck } from "./executor-signal-check";\n`;

const lines = content.split('\n');
const lastImportIndex = lines.map(l => l.startsWith('import')).lastIndexOf(true);
lines.splice(lastImportIndex + 1, 0, imports);

fs.writeFileSync(file, lines.join('\n'));
