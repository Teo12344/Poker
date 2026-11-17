// Zero-dependency HTTP + Server-Sent Events server. Run: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const G = require('./game.js');

const PORT = Number(process.env.PORT) || 3000;
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const clients = new Map(); // roomId -> Set<{res, token}>

function send(res, data) { res.write(`data: ${JSON.stringify(data)}\n\n`); }
function broadcast(room) {
  const set = clients.get(room.id);
  if (!set) return;
  for (const c of set) send(c.res, G.view(room, c.token));
}
G.setOnChange(broadcast);

setInterval(() => { for (const set of clients.values()) for (const c of set) c.res.write(': ping\n\n'); }, 20000);

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/events' && req.method === 'GET') {
    const room = G.getRoom(url.searchParams.get('room'));
    const token = url.searchParams.get('token') || '';
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    const client = { res, token };
    if (!clients.has(room.id)) clients.set(room.id, new Set());
    clients.get(room.id).add(client);
    if (token) G.setConnected(room, token, true);
    send(res, G.view(room, token));
    req.on('close', () => {
      const set = clients.get(room.id);
      set.delete(client);
      if (token && ![...set].some((c) => c.token === token)) G.setConnected(room, token, false);
    });
    return;
  }

  if (p === '/ping') return json(res, 200, { ok: true });

  if (p.startsWith('/api/') && req.method === 'POST') {
    const body = await readBody(req);
    const room = G.getRoom(body.room);
    const t = String(body.token || '');
    let r;
    switch (p.slice(5)) {
      case 'join': r = G.join(room, t, body.name, Number.isInteger(body.seat) ? body.seat : undefined); break;
      case 'action': r = G.act(room, t, String(body.action), body.amount); break;
      case 'start': r = G.start(room); break;
      case 'leave': r = G.leave(room, t); break;
      case 'sitout': r = G.toggleSitOut(room, t); break;
      case 'rebuy': r = G.rebuy(room, t); break;
      default: return json(res, 404, { error: 'not found' });
    }
    return json(res, r && r.error ? 400 : 200, r || { ok: true });
  }

  if (req.method === 'GET') {
    const file = path.normalize(path.join(PUB, p === '/' ? 'index.html' : decodeURIComponent(p)));
    if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
    return;
  }
  res.writeHead(405); res.end();
});

server.listen(PORT, () => {
  const nets = require('os').networkInterfaces();
  const ips = Object.values(nets).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  console.log(`\n♠ 포커 서버 실행 중`);
  console.log(`  내 컴퓨터:   http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`  같은 와이파이: http://${ip}:${PORT}`));
  console.log('');
});
