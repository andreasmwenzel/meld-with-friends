// Fuzz the engine and bots: random rules, full games, invariants checked after every move.
// Usage: node scripts/fuzz.mjs [games=200] [prefix=fuzz]
// Failures are written to .dev/states/fuzz-*.json; open one with /dev/lab?state=<name> to step through it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const dir = mkdtempSync(join(process.cwd(), '.meld-fuzz-'));
try {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', 'src/engine/fuzz.ts', '--outDir', dir, '--module', 'commonjs', '--target', 'es2023', '--skipLibCheck', '--esModuleInterop'], { stdio: 'inherit' });
  const { fuzz } = createRequire(import.meta.url)(join(dir, 'engine/fuzz.js'));
  const games = Number(process.argv[2] ?? 200), prefix = process.argv[3] ?? 'fuzz';
  const t0 = Date.now();
  const result = fuzz(games, prefix);
  console.log(`${result.played} games, ${result.actions} actions, ${result.failures.length} failures in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (result.failures.length) {
    mkdirSync('.dev/states', { recursive: true });
    for (const f of result.failures) {
      const name = `fuzz-${f.seed.replace(/[^\w-]/g, '-')}`;
      writeFileSync(`.dev/states/${name}.json`, JSON.stringify({ base: f.base, actions: f.actions, error: f.error, rules: f.rules }, null, 1));
      console.log(`  ${name}: ${f.error}\n    /dev/lab?state=${name}`);
    }
    process.exitCode = 1;
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
