// Minimal, dependency-free Home Assistant client.
// - WebSocket API: auth, request/response, subscriptions, auto-reconnect.
// - REST API helper (used for automation/script/scene config editing).

export class AuthError extends Error {}

export class HAConnection extends EventTarget {
  /**
   * @param {object} opts
   * @param {string} opts.url       Base URL of Home Assistant, e.g. http://homeassistant.local:8123
   * @param {() => Promise<string>} opts.getToken  Returns a valid access token (refreshing if needed)
   */
  constructor({ url, getToken }) {
    super();
    this.url = url.replace(/\/+$/, '');
    this.getToken = getToken;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map(); // id -> {resolve, reject}
    this.subs = new Map(); // id -> {msg, cb}
    this.connected = false;
    this.closedByUser = false;
    this.retry = 0;
    this.haVersion = null;
  }

  get wsUrl() {
    return this.url.replace(/^http/, 'ws') + '/api/websocket';
  }

  /** Connect and authenticate. Resolves once auth_ok is received. */
  async connect() {
    this.closedByUser = false;
    const token = await this.getToken();
    await new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(this.wsUrl);
      } catch (e) {
        reject(e);
        return;
      }
      let authed = false;
      ws.onmessage = (ev) => {
        let data;
        try {
          data = JSON.parse(ev.data);
        } catch {
          return;
        }
        for (const msg of Array.isArray(data) ? data : [data]) {
          if (msg.type === 'auth_required') {
            ws.send(JSON.stringify({ type: 'auth', access_token: token }));
          } else if (msg.type === 'auth_ok') {
            authed = true;
            this.ws = ws;
            this.haVersion = msg.ha_version;
            this.connected = true;
            this.retry = 0;
            resolve();
          } else if (msg.type === 'auth_invalid') {
            reject(new AuthError(msg.message || 'Invalid authentication'));
            ws.close();
          } else {
            this._handle(msg);
          }
        }
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        if (!authed) {
          reject(new Error(`Could not connect to ${this.wsUrl}`));
          return;
        }
        this._onClose();
      };
    });
    await this._resubscribe();
    this.dispatchEvent(new Event('ready'));
  }

  close() {
    this.closedByUser = true;
    if (this.ws) this.ws.close();
  }

  _handle(msg) {
    if (msg.type === 'result') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.success) p.resolve(msg.result);
      else {
        const err = new Error(msg.error?.message || 'Request failed');
        err.code = msg.error?.code;
        p.reject(err);
      }
    } else if (msg.type === 'event') {
      const sub = this.subs.get(msg.id);
      if (sub) sub.cb(msg.event);
    } else if (msg.type === 'pong') {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        p.resolve();
      }
    }
  }

  _onClose() {
    this.connected = false;
    this.ws = null;
    for (const p of this.pending.values()) p.reject(new Error('Connection lost'));
    this.pending.clear();
    this.dispatchEvent(new Event('disconnected'));
    if (this.closedByUser) return;
    const delay = Math.min(30000, 1000 * 2 ** this.retry++);
    setTimeout(() => this._reconnect(), delay);
  }

  async _reconnect() {
    if (this.closedByUser) return;
    try {
      await this.connect();
    } catch (e) {
      if (e instanceof AuthError) {
        this.dispatchEvent(new CustomEvent('auth-invalid', { detail: e }));
        return;
      }
      const delay = Math.min(30000, 1000 * 2 ** this.retry++);
      setTimeout(() => this._reconnect(), delay);
    }
  }

  async _resubscribe() {
    const old = [...this.subs.entries()];
    this.subs.clear();
    for (const [, sub] of old) {
      try {
        const id = this._send(sub.msg);
        this.subs.set(id, sub);
        sub.id = id;
      } catch {
        /* will retry on next reconnect */
      }
    }
  }

  _send(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Not connected');
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ ...msg, id }));
    return id;
  }

  /** Send a command and wait for its result. */
  send(msg) {
    return new Promise((resolve, reject) => {
      let id;
      try {
        id = this._send(msg);
      } catch (e) {
        reject(e);
        return;
      }
      this.pending.set(id, { resolve, reject });
    });
  }

  /**
   * Start a subscription. Returns an async unsubscribe function.
   * Subscriptions are re-established automatically after reconnects.
   */
  async subscribe(msg, cb, unsubType = 'unsubscribe_events') {
    const sub = { msg, cb, id: null };
    await new Promise((resolve, reject) => {
      let id;
      try {
        id = this._send(msg);
      } catch (e) {
        reject(e);
        return;
      }
      sub.id = id;
      this.subs.set(id, sub);
      this.pending.set(id, {
        resolve,
        reject: (e) => {
          this.subs.delete(id);
          reject(e);
        },
      });
    });
    return async () => {
      this.subs.delete(sub.id);
      if (this.connected) {
        try {
          await this.send({ type: unsubType, subscription: sub.id });
        } catch {
          /* ignore */
        }
      }
    };
  }

  // ---- Convenience wrappers ----
  getStates() {
    return this.send({ type: 'get_states' });
  }
  getConfig() {
    return this.send({ type: 'get_config' });
  }
  getServices() {
    return this.send({ type: 'get_services' });
  }
  subscribeEvents(eventType, cb) {
    return this.subscribe({ type: 'subscribe_events', event_type: eventType }, cb);
  }
  callService(domain, service, data = {}, target, returnResponse = false) {
    const msg = { type: 'call_service', domain, service, service_data: data };
    if (target) msg.target = target;
    if (returnResponse) msg.return_response = true;
    return this.send(msg);
  }
  ping() {
    return this.send({ type: 'ping' });
  }

  /** REST API call, returns parsed JSON (or text). */
  async rest(method, path, body) {
    const token = await this.getToken();
    const res = await fetch(this.url + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg = (data && data.message) || (typeof data === 'string' && data) || res.statusText;
      const err = new Error(`${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
}

// ---------------------------------------------------------------------------
// Authentication: long-lived tokens or Home Assistant's OAuth2 login flow.
// ---------------------------------------------------------------------------

const AUTH_KEY = 'ha-app-auth';

export function loadAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY)) || null;
  } catch {
    return null;
  }
}

export function saveAuth(auth) {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  } catch {
    /* storage unavailable: stay logged in for this page load only */
  }
}

export function clearAuth() {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    /* ignore */
  }
}

export function normalizeUrl(url) {
  url = (url || '').trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
  return url;
}

function defaultClientId() {
  return location.origin + '/';
}

function redirectUri() {
  return location.origin + location.pathname;
}

/** Redirect the browser to Home Assistant's login page. */
export function startOAuthLogin(hassUrl) {
  if (window.HA_APP_DEMO?.login) return window.HA_APP_DEMO.login(hassUrl);
  const state = btoa(JSON.stringify({ hassUrl, clientId: defaultClientId() }));
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: defaultClientId(),
    redirect_uri: redirectUri(),
    state,
  });
  location.href = `${hassUrl}/auth/authorize?${qs}`;
}

async function tokenRequest(hassUrl, params) {
  const res = await fetch(`${hassUrl}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    credentials: 'same-origin',
  });
  if (!res.ok) throw new AuthError(`Token request failed (${res.status})`);
  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || params.refresh_token,
    expires: Date.now() + (data.expires_in || 1800) * 1000,
  };
}

/** If the page was opened as an OAuth redirect, finish the login. Returns auth or null. */
export async function handleOAuthCallback() {
  const qs = new URLSearchParams(location.search);
  const code = qs.get('code');
  const state = qs.get('state');
  if (!code || !state) return null;
  history.replaceState(null, '', location.pathname + location.hash);
  let parsed;
  try {
    parsed = JSON.parse(atob(state));
  } catch {
    throw new AuthError('Invalid login state');
  }
  const tokens = await tokenRequest(parsed.hassUrl, {
    grant_type: 'authorization_code',
    code,
    client_id: parsed.clientId,
  });
  const auth = { mode: 'oauth', hassUrl: parsed.hassUrl, clientId: parsed.clientId, ...tokens };
  saveAuth(auth);
  return auth;
}

/**
 * When this app is served from Home Assistant itself (/local/...), the HA
 * frontend's login tokens are in the same localStorage. Reuse them so no
 * separate login is needed.
 */
export function importFrontendTokens() {
  try {
    const t = JSON.parse(localStorage.getItem('hassTokens'));
    if (!t || !t.refresh_token || !t.hassUrl) return null;
    if (normalizeUrl(t.hassUrl) !== location.origin) return null;
    const auth = {
      mode: 'oauth',
      hassUrl: normalizeUrl(t.hassUrl),
      clientId: t.clientId,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires: t.expires || 0,
    };
    saveAuth(auth);
    return auth;
  } catch {
    return null;
  }
}

/** Returns a getToken() function for an auth object, refreshing OAuth tokens as needed. */
export function tokenProvider(auth) {
  let refreshing = null;
  return async () => {
    if (auth.mode === 'token') return auth.access_token;
    if (auth.access_token && auth.expires - 60000 > Date.now()) return auth.access_token;
    if (!refreshing) {
      refreshing = tokenRequest(auth.hassUrl, {
        grant_type: 'refresh_token',
        refresh_token: auth.refresh_token,
        client_id: auth.clientId,
      })
        .then((t) => {
          Object.assign(auth, t);
          saveAuth(auth);
          return auth.access_token;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    return refreshing;
  };
}
