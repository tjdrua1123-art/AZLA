import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
export function createAppServer() {
  return createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (rel.split('/').some(p => p.startsWith('.')) || !/^(index\.html|style\.css|app\.js|device-config\.json|(?:src|sdk|assets)\/[^\0]+)$/.test(rel)) {
        res.writeHead(404).end('Not found'); return;
      }
      const target = resolve(root, rel);
      if (!target.startsWith(root + sep) && !target.startsWith(root)) { res.writeHead(403).end(); return; }
      if (!(await stat(target)).isFile()) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(await readFile(target));
    } catch { res.writeHead(404).end('Not found'); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8768);
  const server = createAppServer();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Close the other server first.` : error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`AZLA Equalizer server started on port ${port}. Open in Chrome or Edge.`));
}
