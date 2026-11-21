#!/usr/bin/env node
// A fake Home Assistant for developing and testing the app without a real server.
//   npm run dev  ->  http://localhost:8123/local/ha-app/   (token: mock-token, or use "Log in")
// The simulated house and API logic live in demo/mock-core.js (shared with the browser demo).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createMockHA, MOCK_TOKEN } from '../demo/mock-core.js';

const PORT = Number(process.env.PORT || 8123);
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app');
const ha = createMockHA();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png' };

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === '/' || p === '/local/ha-app') {
    res.writeHead(302, { Location: '/local/ha-app/' });
    return res.end();
  }

  if (p.startsWith('/local/ha-app/')) {
    const rel = decodeURIComponent(p.slice('/local/ha-app/'.length)) || 'index.html';
    const file = path.join(APP_DIR, rel);
    if (!file.startsWith(APP_DIR)) {
      res.writeHead(403);
      return res.end();
    }
    return fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  }

  // OAuth: a fake login page with a single "Log in" link.
  if (p === '/auth/authorize') {
    const redirect = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    const code = 'code-' + Math.random().toString(36).slice(2);
    const target = `${redirect}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<!doctype html><title>Mock HA login</title><body style="font-family:system-ui;display:grid;place-items:center;height:100vh"><div><h1>Mock Home Assistant</h1><a id="approve" href="${target}">Log in</a></div></body>`);
  }

  const body = req.method === 'POST' ? await readBody(req) : '';
  const r = ha.http(req.method, p, req.headers.authorization, body);
  if (r) {
    res.writeHead(r.status, { 'Content-Type': r.contentType });
    return res.end(r.body);
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"message":"Not found"}');
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/api/websocket') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    const client = ha.connect((m) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(m));
    });
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      client.receive(msg);
      if (client.wantsClose) ws.close();
    });
    ws.on('close', () => client.close());
  });
});

setInterval(() => ha.tick(), 5000);

server.listen(PORT, () => {
  console.log(`Mock Home Assistant on http://localhost:${PORT}`);
  console.log(`App: http://localhost:${PORT}/local/ha-app/   (token: ${MOCK_TOKEN})`);
});
