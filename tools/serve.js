// Servidor estático para probar la interfaz en un navegador (modo web, sin Electron)
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'src');
const port = +process.env.PORT || 5180;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const p = path.normalize(path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname === '/' ? '/index.html' : new URL(req.url, 'http://x').pathname)));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(port, '127.0.0.1', () => console.log(`Nexura DJ Studio (web) → http://localhost:${port}`));
