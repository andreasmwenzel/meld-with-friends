// Compile the pure engine into a temporary directory, then run it with Node.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const dir=mkdtempSync(join(process.cwd(),'.meld-arena-'));
try {
  execFileSync(process.execPath,['node_modules/typescript/bin/tsc','src/engine/ai/arena.ts','--ignoreConfig','--outDir',dir,'--module','commonjs','--target','es2023','--skipLibCheck','--esModuleInterop'],{stdio:'inherit'});
  const {arena}=createRequire(import.meta.url)(join(dir,'engine/ai/arena.js'));
  console.log(JSON.stringify(arena(Number(process.argv[2]??50),Number(process.argv[3]??3)),null,2));
} finally { rmSync(dir,{recursive:true,force:true}); }
