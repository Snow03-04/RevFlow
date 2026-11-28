// Update only supplier parsing/planning/sync in the downloaded production worker.
// Its queue and other accounting code include independent changes that must survive.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const expected = {
  sheet: '81a912e3d786f567d5ae4b415c8b3ae12513f3412554c6073035e26c1aea2618',
  plan: '5b20f81e7c9c49f2a0c68b97330f33a011706e576839578ba8bb54866ff74727',
  sync: '6a05e0a3538b218a4bebc64455324e587e664aa7130032815ddfc726db94ebef',
};
function block(source, name) {
  const marker = `// src/lib/supplier/${name}.ts\n`;
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + 1) >= 0) throw Error(`Expected one ${name} module`);
  const end = source.indexOf('\n// src/', start + marker.length);
  if (end < 0) throw Error(`Missing end of ${name} module`);
  return source.slice(start, end);
}
function compile(name) {
  let source = fs.readFileSync(path.join(root, `src/lib/supplier/${name}.ts`), 'utf8');
  const ast = ts.createSourceFile(name + '.ts', source, ts.ScriptTarget.Latest, true);
  const imports = ast.statements.filter(ts.isImportDeclaration);
  for (const node of [...imports].reverse()) source = source.slice(0, node.getFullStart()) + source.slice(node.end);
  if (name === 'sync') {
    source = source.replace(/\binFlight\b/g, 'inFlight2'); // Preserve the bundle's unique map name.
    const refresh = 'await refreshCostDependents(db, userId, { storeId });';
    if (source.split(refresh).length !== 2) throw Error('Unknown supplier refresh shape');
    source = source.replace(refresh, 'if (options.deferRefresh) await options.deferRefresh();\n    else ' + refresh);
  }
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: false,
  } }).outputText.replace(/^export (?=(?:async )?(?:function|const|let|class)\b)/gm, '')
    .replace(/^export \{\};?\s*$/gm, '');
  return `// src/lib/supplier/${name}.ts\n${code.trim()}\n`;
}
function patchHostedSupplierCurrencies(source) {
  source = source.replace(/\r\n/g, '\n');
  const replacements = Object.keys(expected).map(name => {
    const before = block(source, name), after = compile(name);
    if (before !== after && createHash('sha256').update(before).digest('hex') !== expected[name])
      throw Error(`Deployed ${name} differs from the reviewed baseline; review before patching`);
    return { before, after };
  });
  let updated = source;
  for (const { before, after } of replacements) updated = updated.replace(before, after);
  const currency = compile('currency');
  const marker = '// src/lib/supplier/currency.ts\n';
  if (updated.includes(marker)) {
    if (block(updated, 'currency') !== currency) throw Error('Unexpected existing currency helpers');
  } else updated = updated.replace('// src/lib/supplier/plan.ts\n', currency + '\n// src/lib/supplier/plan.ts\n');
  return updated;
}
module.exports = { patchHostedSupplierCurrencies, block, compile };
if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || path.resolve(input) === path.resolve(output)) throw Error('Use distinct input/output paths');
  const updated = patchHostedSupplierCurrencies(fs.readFileSync(input, 'utf8'));
  fs.writeFileSync(output, updated);
  console.log('Updated supplier currency modules; remaining deployed worker preserved.');
}
