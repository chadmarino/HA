// Settings view and the login screen.

import { h } from '../dom.js';
import { store, savePrefs, notify } from '../store.js';
import { normalizeUrl, startOAuthLogin } from '../ha.js';

// Only touch data-theme when we set it, so a theme chosen by a host page (e.g. when embedded) is kept.
let themeSetByApp = false;
export function applyTheme() {
  const t = store.prefs.theme;
  const root = document.documentElement;
  if (t === 'auto') {
    if (themeSetByApp) root.removeAttribute('data-theme');
    themeSetByApp = false;
  } else {
    root.setAttribute('data-theme', t);
    themeSetByApp = true;
  }
}

const lastUrl = {
  get() {
    try {
      return localStorage.getItem('ha-app-last-url') || '';
    } catch {
      return '';
    }
  },
  set(u) {
    try {
      localStorage.setItem('ha-app-last-url', u);
    } catch {
      /* ignore */
    }
  },
};

export function settingsView(root, { auth, onLogout }) {
  const theme = h(
    'select',
    {
      'aria-label': 'Theme',
      onchange: (e) => {
        store.prefs.theme = e.target.value;
        savePrefs();
        applyTheme();
      },
    },
    ['auto', 'light', 'dark'].map((t) => h('option', { value: t, selected: store.prefs.theme === t }, t[0].toUpperCase() + t.slice(1))),
  );
  const hidden = h('input', {
    type: 'checkbox',
    class: 'toggle',
    checked: store.prefs.showHidden,
    onchange: (e) => {
      store.prefs.showHidden = e.target.checked;
      savePrefs();
      notify(null);
    },
  });
  root.append(
    h(
      'div',
      { class: 'form narrow' },
      h('h2', null, 'Connection'),
      h('dl', { class: 'info' }, h('dt', null, 'Server'), h('dd', null, auth.hassUrl), h('dt', null, 'Login'), h('dd', null, auth.mode === 'token' ? 'Long-lived access token' : 'Home Assistant login'), h('dt', null, 'Version'), h('dd', null, store.conn?.haVersion || '—')),
      h('button', { class: 'btn danger', onclick: onLogout }, 'Log out'),
      h('h2', null, 'Display'),
      h('label', { class: 'row-label' }, 'Theme', theme),
      h('label', { class: 'row-label' }, 'Show hidden & diagnostic entities', hidden),
      h('label', { class: 'row-label' }, `Favorites (${store.prefs.favorites.length})`, h('button', { class: 'btn small', onclick: () => confirm('Clear all favorites?') && ((store.prefs.favorites = []), savePrefs(), notify(null)) }, 'Clear')),
      h('h2', null, 'About'),
      h('p', { class: 'muted' }, 'HA App — a lightweight custom control app for Home Assistant. Tap ☆ on any device to pin it to Favorites.'),
    ),
  );
}

export function loginScreen(root, { error, onToken }) {
  const servedFromHA = /\/local\//.test(location.pathname);
  const url = h('input', { type: 'url', required: true, placeholder: 'http://homeassistant.local:8123', value: window.HA_APP_DEMO?.url || (servedFromHA ? location.origin : lastUrl.get()), 'aria-label': 'Home Assistant URL' });
  const token = h('textarea', { rows: 3, placeholder: 'Paste a long-lived access token', 'aria-label': 'Access token', class: 'code' });
  const err = h('p', { class: 'error', hidden: !error }, error || '');
  const getUrl = () => {
    const u = normalizeUrl(url.value);
    if (!u) {
      err.textContent = 'Enter your Home Assistant URL';
      err.hidden = false;
      return null;
    }
    lastUrl.set(u);
    return u;
  };
  root.append(
    h(
      'div',
      { class: 'login' },
      h('div', { class: 'login-card' },
        h('img', { src: 'icon.svg', alt: '', width: 64, height: 64 }),
        h('h1', null, 'Connect to Home Assistant'),
        err,
        h('label', null, 'Server URL', url),
        h('button', { class: 'btn primary block', onclick: () => { const u = getUrl(); if (u) startOAuthLogin(u); } }, 'Log in with Home Assistant'),
        h('details', null,
          h('summary', null, 'Use a long-lived access token instead'),
          h('p', { class: 'muted small' }, 'Create one in Home Assistant: your profile → Security → Long-lived access tokens. It is stored only in this browser.'),
          token,
          h('button', { class: 'btn block', onclick: () => { const u = getUrl(); if (!u) return; if (!token.value.trim()) { err.textContent = 'Paste a token'; err.hidden = false; return; } onToken(u, token.value.trim()); } }, 'Connect with token'),
        ),
      ),
    ),
  );
}
