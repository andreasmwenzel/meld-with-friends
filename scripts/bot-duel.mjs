// Paired head-to-head: the working tree's bots against the bots at a git ref (default origin/main).
// Usage: node scripts/bot-duel.mjs [deals=100] [ref=origin/main] [budgetMs=0]
// Each deal is played twice with the teams swapped; "a" is the working tree, "b" is the ref.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const [deals = '100', ref = 'origin/main', budget = '0'] = process.argv.slice(2);
const dir = mkdtempSync(join(process.cwd(), '.meld-duel-'));
const tsc = (entry, out) => execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', entry, '--outDir', out, '--module', 'commonjs', '--target', 'es2023', '--skipLibCheck', '--esModuleInterop', '--ignoreConfig'], { stdio: 'inherit' });
try {
  mkdirSync(join(dir, 'ref'));
  execFileSync('tar', ['-x', '-C', join(dir, 'ref')], { input: execFileSync('git', ['archive', ref, 'src/engine', 'src/lib/settings.ts'], { maxBuffer: 1 << 28 }) });
  tsc('src/engine/ai/arena.ts', join(dir, 'head'));
  tsc(join(dir, 'ref/src/engine/ai/index.ts'), join(dir, 'ref-out'));
  const require = createRequire(import.meta.url);
  const { duel } = require(join(dir, 'head/engine/ai/arena.js'));
  const { chooseAction: head } = require(join(dir, 'head/engine/ai/index.js'));
  const { chooseAction: base } = require(join(dir, 'ref-out/engine/ai/index.js'));
  const started = Date.now();
  const result = duel(Number(deals), head, base, Number(budget));
  console.log(JSON.stringify({ ref, budgetMs: Number(budget), seconds: (Date.now() - started) / 1000, ...result }, null, 2));
} finally { rmSync(dir, { recursive: true, force: true }); }
