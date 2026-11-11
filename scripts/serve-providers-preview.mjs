import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('artifacts/verification/providers-admin');
const port = Number(process.env.PORT) || 9141;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

http.createServer((req, res) => {
  const raw = (req.url || '/').split('?')[0];
  const name = raw === '/' ? '/providers-panel.html' : raw;
  const file = path.join(root, decodeURIComponent(name));
  try {
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}/`));
