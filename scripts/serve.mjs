// Rebuilds the demo on change and serves it at http://localhost:5173
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PORT ?? 5173);
spawn(process.execPath, ['scripts/build-ui.mjs', '--watch'], { stdio: 'inherit' });

createServer(async (req, res) => {
  if (req.url !== '/' && req.url !== '/index.html') {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(await readFile('dist/demo.html'));
  } catch {
    res.writeHead(503).end('Building, refresh in a moment');
  }
}).listen(port, () => console.log(`[serve] http://localhost:${port}`));
