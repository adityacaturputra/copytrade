const fs = require('fs');
const path = require('path');

const libDir = 'shared/src/lib';
const files = fs.readdirSync(libDir);

const exportsList = [];

for (const file of files) {
  if (file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts') && file !== 'index.ts') {
    const baseName = file.replace('.ts', '');
    const namespaceName = baseName.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    // Use standard export * for everything EXCEPT we use namespace for database and enums if we want?
    // Actually, namespace everything:
    exportsList.push(`export * as ${namespaceName} from './${baseName}';`);
  }
}

fs.writeFileSync(path.join(libDir, 'index.ts'), exportsList.join('\n') + '\n');
