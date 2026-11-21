// Runs the app against a simulated Home Assistant inside the page.
// Replaces WebSocket and fetch for the fake server's URL only.

import { createMockHA, MOCK_TOKEN } from './mock-core.js';

const DEMO_URL = 'https://demo-home.local';
const ha = createMockHA();
setInterval(() => ha.tick(), 5000);

const RealWebSocket = window.WebSocket;
const realFetch = window.fetch.bind(window);
const later = (fn) => setTimeout(fn, 15);

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) {
    if (!String(url).startsWith(DEMO_URL.replace(/^http/, 'ws'))) return new RealWebSocket(url);
    this.url = url;
    this.readyState = 0;
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    later(() => {
      this.readyState = 1;
      this.onopen?.({});
      this.client = ha.connect((m) => later(() => this.readyState === 1 && this.onmessage?.({ data: JSON.stringify(m) })));
    });
  }
  send(text) {
    const msg = JSON.parse(text);
    if (msg.type === 'auth') msg.access_token = MOCK_TOKEN; // demo accepts any token
    later(() => {
      this.client.receive(msg);
      if (this.client.wantsClose) this.close();
    });
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.client?.close();
    later(() => this.onclose?.({ code: 1000 }));
  }
}
window.WebSocket = FakeWebSocket;

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith(DEMO_URL)) return realFetch(input, init);
  const u = new URL(url);
  const headers = new Headers(init.headers || {});
  const body = init.body instanceof URLSearchParams ? init.body.toString() : init.body || '';
  await new Promise((r) => setTimeout(r, 60));
  const r = ha.http(init.method || 'GET', u.pathname, headers.get('Authorization'), body) || { status: 404, body: '{"message":"Not found"}', contentType: 'application/json' };
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.contentType } });
};

// The embedding frame blocks native confirm()/prompt(); in the demo, treat them as "yes".
window.confirm = () => true;
window.prompt = () => '1234';

window.HA_APP_DEMO = {
  url: DEMO_URL,
  auth: { mode: 'token', hassUrl: DEMO_URL, access_token: MOCK_TOKEN },
  // "Log in with Home Assistant" in the demo: skip the redirect and sign straight in.
  login(hassUrl) {
    window.HA_APP_DEMO.auth = { mode: 'token', hassUrl, access_token: MOCK_TOKEN };
    location.hash = '';
    location.reload();
  },
};
