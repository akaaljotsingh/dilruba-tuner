// Minimal static server for the production build with SPA fallback.
// For local PWA/offline testing only – http://localhost counts as a secure
// context, so the microphone and service worker work. Use real HTTPS hosting
// for deployment.
//   npm run build && npm run serve:prod   → http://localhost:8080
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist/dilruba-tuner/browser');
const port = Number(process.env.PORT ?? 8080);
// Mount path, e.g. BASE=/dilruba-tuner/ to mimic GitHub Pages (build with --base-href to match).
const base = (process.env.BASE ?? '/').replace(/\/?$/, '/');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

if (!existsSync(root)) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith(base) && url.pathname + '/' !== base) {
    res.writeHead(302, { Location: base }).end();
    return;
  }
  const path = url.pathname.slice(base.length - 1) || '/';
  let file = normalize(join(root, decodeURIComponent(path)));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // SPA fallback for client routes; real 404 for missing assets.
    if (extname(path)) {
      res.writeHead(404).end('Not found');
      return;
    }
    file = join(root, 'index.html');
  }
  const ext = extname(file);
  const immutable = /-[A-Za-z0-9_]{8,}\.(js|css)$/.test(file);
  res.writeHead(200, {
    'Content-Type': types[ext] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}${base}`));
