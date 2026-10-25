// Compile the pure engine, then compare paired deals in both scoring scales.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const dir = mkdtempSync(join(process.cwd(), '.meld-arena-'));
try {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', 'src/engine/ai/arena.ts', '--outDir', dir, '--module', 'commonjs', '--target', 'es2023', '--skipLibCheck', '--esModuleInterop'], { stdio: 'inherit' });
  const { compareScoring } = createRequire(import.meta.url)(join(dir, 'engine/ai/arena.js'));
  console.log(JSON.stringify(compareScoring(Number(process.argv[2] ?? 300), Number(process.argv[3] ?? 0)), null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
