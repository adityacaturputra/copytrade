const fs = require('fs');
const path = require('path');

const dir = 'client/src/components/dashboard';

const fixes = {
  'ProcessLogsAccordion.tsx': [
    `import React, { useState, useEffect, useCallback, useRef } from 'react';`,
    `import { LOG_LEVEL_FILTERS } from './types';`
  ],
  'SignalsTab.tsx': [
    `import React, { useState, useEffect, useCallback } from 'react';`,
    `import { PaginationBar } from './PaginationBar';`,
    `import { StatusBadge } from './StatusBadge';`
  ],
  'LogsTab.tsx': [
    `import React, { useState, useEffect, useCallback } from 'react';`,
    `import { PaginationBar } from './PaginationBar';`
  ],
  'HoverTapTooltip.tsx': [
    `import React, { useState, useEffect, useRef } from 'react';`
  ]
};

for (const [file, linesToAdd] of Object.entries(fixes)) {
  const filePath = path.join(dir, file);
  if (!fs.existsSync(filePath)) continue;
  
  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.replace(`import React from 'react';\n`, '');
  
  const toAdd = linesToAdd.join('\n') + '\n';
  fs.writeFileSync(filePath, toAdd + content);
}
