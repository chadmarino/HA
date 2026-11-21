// App bootstrap: auth → connect → load data → render views.

import { HAConnection, AuthError, loadAuth, saveAuth, clearAuth, handleOAuthCallback, importFrontendTokens, tokenProvider } from './ha.js';
import { h, clear, toast } from './dom.js';
import { store, notify, savePrefs } from './store.js';
import { homeView } from './views/home.js';
import { automationsView } from './views/automations.js';
import { toolsView } from './views/tools.js';
import { settingsView, loginScreen, applyTheme } from './views/settings.js';

const app = document.getElementById('app');
let auth = null;
let viewCleanup = null;
let currentView = store.prefs.lastView || 'home';

applyTheme();

const VIEWS = {
  home: { label: 'Home', icon: '🏠', render: homeView },
  automations: { label: 'Automations', icon: '🤖', render: automationsView },
  tools: { label: 'Tools', icon: '🛠️', render: toolsView, admin: true },
  settings: { label: 'Settings', icon: '⚙️', render: (root) => settingsView(root, { auth, onLogout: logout }) },
};

async function start() {
  let error = null;
  try {
    auth = (await handleOAuthCallback()) || loadAuth() || importFrontendTokens();
  } catch (e) {
    error = e.message;
  }
  if (!auth) return showLogin(error);
  await connect();
}

function showLogin(error) {
  if (viewCleanup) viewCleanup();
  clear(app);
  loginScreen(app, {
    error,
    onToken: async (hassUrl, token) => {
      auth = { mode: 'token', hassUrl, access_token: token };
      saveAuth(auth);
      await connect();
    },
  });
}

function logout() {
  if (!confirm('Log out of Home Assistant on this device?')) return;
  store.conn?.close();
  clearAuth();
  auth = null;
  showLogin();
}

async function connect() {
  clear(app);
  app.append(h('div', { class: 'splash' }, h('div', { class: 'spinner' }), h('p', null, `Connecting to ${auth.hassUrl}…`)));
  const conn = new HAConnection({ url: auth.hassUrl, getToken: tokenProvider(auth) });
  store.conn = conn;
  try {
    await conn.connect();
  } catch (e) {
    if (e instanceof AuthError) {
      clearAuth();
      return showLogin(`Login rejected: ${e.message}. Please log in again.`);
    }
    return showLogin(`${e.message}. Check the URL, and that this page and Home Assistant use the same http/https scheme.`);
  }
  conn.addEventListener('disconnected', () => setStatus('offline'));
  conn.addEventListener('ready', () => {
    setStatus('online');
    loadAll().catch((e) => toast(e.message, 'error'));
  });
  conn.addEventListener('auth-invalid', () => {
    clearAuth();
    showLogin('Your session expired. Please log in again.');
  });

  await conn.subscribeEvents('state_changed', (ev) => {
    const { entity_id, new_state } = ev.data;
    if (new_state) store.states[entity_id] = new_state;
    else delete store.states[entity_id];
    notify(entity_id);
  });
  await conn.subscribeEvents('entity_registry_updated', () => loadRegistries().then(() => notify(null)));
  await loadAll();
  renderShell();
}

async function loadRegistries() {
  const safe = (p) => p.catch(() => null);
  const [areas, devices, entities] = await Promise.all([
    safe(store.conn.send({ type: 'config/area_registry/list' })),
    safe(store.conn.send({ type: 'config/device_registry/list' })),
    safe(store.conn.send({ type: 'config/entity_registry/list' })),
  ]);
  store.isAdmin = entities !== null;
  store.areas = Object.fromEntries((areas || []).map((a) => [a.area_id, a]));
  store.devices = Object.fromEntries((devices || []).map((d) => [d.id, d]));
  store.entities = Object.fromEntries((entities || []).map((e) => [e.entity_id, e]));
}

async function loadAll() {
  const [states, config, services] = await Promise.all([store.conn.getStates(), store.conn.getConfig(), store.conn.getServices().catch(() => ({}))]);
  store.states = Object.fromEntries(states.map((s) => [s.entity_id, s]));
  store.config = config;
  store.services = services;
  await loadRegistries();
  notify(null);
}

let statusEl;
function setStatus(s) {
  if (!statusEl) return;
  statusEl.className = `status ${s}`;
  statusEl.title = s === 'online' ? 'Connected' : 'Reconnecting…';
  statusEl.textContent = s === 'online' ? '' : 'Reconnecting…';
}

function renderShell() {
  clear(app);
  statusEl = h('span', { class: 'status online', title: 'Connected' });
  const nav = h('nav', { class: 'tabs', 'aria-label': 'Main' });
  const main = h('main', { id: 'view' });
  const header = h('header', { class: 'top' }, h('img', { src: 'icon.svg', alt: '', width: 28, height: 28 }), h('h1', null, store.config?.location_name || 'Home'), statusEl);
  app.append(header, main, nav);

  for (const [key, v] of Object.entries(VIEWS)) {
    if (v.admin && !store.isAdmin) continue;
    nav.append(h('button', { 'data-view': key, onclick: () => go(key) }, h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, v.icon), h('span', null, v.label)));
  }

  function go(key) {
    if (!VIEWS[key] || (VIEWS[key].admin && !store.isAdmin)) key = 'home';
    currentView = key;
    store.prefs.lastView = key;
    savePrefs();
    if (location.hash !== '#' + key) history.replaceState(null, '', '#' + key);
    for (const b of nav.children) b.setAttribute('aria-current', b.dataset.view === key ? 'page' : 'false');
    if (viewCleanup) viewCleanup();
    clear(main);
    viewCleanup = VIEWS[key].render(main) || null;
    main.scrollTop = 0;
  }
  go(location.hash.slice(1) || currentView);
  window.onhashchange = () => go(location.hash.slice(1));
}

start();
