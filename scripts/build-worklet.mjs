// Bundles the AudioWorklet (and the DSP code it imports) into a single
// self-contained ES module served from /worklets. Run automatically before
// `start`, `build` and `test` via npm pre-scripts.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'src/app/core/audio/audio-worklet/sur-analysis.worklet.ts');
const outfile = resolve(root, 'public/worklets/sur-analysis.worklet.js');
const watch = process.argv.includes('--watch');

// Type-check the worklet and its DSP dependencies (esbuild only strips types).
if (!watch) {
  execFileSync(
    process.execPath,
    [
      resolve(root, 'node_modules/typescript/bin/tsc'),
      '-p',
      resolve(root, 'tsconfig.worklet.json'),
    ],
    {
      stdio: 'inherit',
    },
  );
}

mkdirSync(dirname(outfile), { recursive: true });
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
});
