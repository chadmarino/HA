#!/usr/bin/env node
// A small fake Home Assistant for developing and testing the app without a real server.
//   npm run dev  ->  http://localhost:8123/local/ha-app/   (token: mock-token, or use "Log in")
// Implements the parts of the WebSocket + REST + OAuth APIs the app uses.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8123);
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app');
const TOKEN = 'mock-token';
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Fake house
// ---------------------------------------------------------------------------
const areas = [
  { area_id: 'living_room', name: 'Living Room' },
  { area_id: 'kitchen', name: 'Kitchen' },
  { area_id: 'bedroom', name: 'Bedroom' },
  { area_id: 'outside', name: 'Outside' },
];
const devices = [{ id: 'dev_thermo', area_id: 'living_room', name: 'Thermostat' }];
const entityRegistry = [];
const states = {};
const history = {};

function add(entity_id, state, attributes = {}, area_id = null, extra = {}) {
  states[entity_id] = { entity_id, state: String(state), attributes, last_changed: now(), last_updated: now(), context: { id: 'x' } };
  entityRegistry.push({ entity_id, area_id, device_id: extra.device_id || null, hidden_by: null, disabled_by: null, entity_category: extra.entity_category || null });
}

add('light.living_room', 'on', { friendly_name: 'Living Room Lamp', brightness: 180, supported_color_modes: ['color_temp', 'hs'], color_mode: 'color_temp', color_temp_kelvin: 3000, min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500, rgb_color: [255, 200, 150] }, 'living_room');
add('light.kitchen', 'off', { friendly_name: 'Kitchen Lights', supported_color_modes: ['brightness'] }, 'kitchen');
add('light.bedroom', 'off', { friendly_name: 'Bedroom Light', supported_color_modes: ['onoff'] }, 'bedroom');
add('switch.coffee_maker', 'off', { friendly_name: 'Coffee Maker' }, 'kitchen');
add('fan.bedroom', 'off', { friendly_name: 'Ceiling Fan', percentage: 0, percentage_step: 33.33, supported_features: 1 }, 'bedroom');
add('cover.garage', 'closed', { friendly_name: 'Garage Door', device_class: 'garage' }, 'outside');
add('cover.blinds', 'open', { friendly_name: 'Living Room Blinds', current_position: 70 }, 'living_room');
add('climate.thermostat', 'heat', { friendly_name: 'Thermostat', current_temperature: 20.5, temperature: 21, hvac_modes: ['off', 'heat', 'cool', 'auto'], target_temp_step: 0.5 }, null, { device_id: 'dev_thermo' });
add('lock.front_door', 'locked', { friendly_name: 'Front Door' }, 'outside');
add('media_player.speaker', 'playing', { friendly_name: 'Kitchen Speaker', volume_level: 0.4, media_title: 'Morning Jazz' }, 'kitchen');
add('sensor.outside_temperature', '12.4', { friendly_name: 'Outside Temperature', unit_of_measurement: '°C', device_class: 'temperature' }, 'outside');
add('sensor.power', '412', { friendly_name: 'House Power', unit_of_measurement: 'W' });
add('sensor.wifi_signal', '-52', { friendly_name: 'Router Signal', unit_of_measurement: 'dBm' }, null, { entity_category: 'diagnostic' });
add('binary_sensor.front_door', 'off', { friendly_name: 'Front Door Contact', device_class: 'door' }, 'outside');
add('binary_sensor.motion_hall', 'off', { friendly_name: 'Hall Motion', device_class: 'motion' });
add('input_boolean.guest_mode', 'off', { friendly_name: 'Guest Mode' });
add('input_number.alarm_volume', '30', { friendly_name: 'Alarm Volume', min: 0, max: 100, step: 5, unit_of_measurement: '%' });
add('input_select.house_mode', 'Home', { friendly_name: 'House Mode', options: ['Home', 'Away', 'Night', 'Vacation'] });
add('scene.movie_night', 'unknown', { friendly_name: 'Movie Night', id: '1700000000001', entity_id: ['light.living_room', 'cover.blinds'] });
add('script.good_night', 'off', { friendly_name: 'Good Night', last_triggered: null });
add('vacuum.robot', 'docked', { friendly_name: 'Robot Vacuum' }, 'living_room');
add('person.alex', 'home', { friendly_name: 'Alex' });
add('sun.sun', 'above_horizon', { friendly_name: 'Sun' });
add('automation.porch_light_at_sunset', 'on', { friendly_name: 'Porch light at sunset', id: '1700000000100', last_triggered: new Date(Date.now() - 3600e3 * 20).toISOString() });
add('automation.yaml_only', 'off', { friendly_name: 'Legacy YAML automation', last_triggered: null });

const configs = {
  automation: {
    '1700000000100': { id: '1700000000100', alias: 'Porch light at sunset', description: '', triggers: [{ trigger: 'sun', event: 'sunset' }], conditions: [], actions: [{ action: 'light.turn_on', target: { entity_id: 'light.living_room' } }], mode: 'single' },
  },
  script: { good_night: { alias: 'Good Night', sequence: [{ action: 'light.turn_off', target: { entity_id: 'all' } }, { action: 'lock.lock', target: { entity_id: 'lock.front_door' } }], mode: 'single' } },
  scene: { '1700000000001': { id: '1700000000001', name: 'Movie Night', entities: { 'light.living_room': { state: 'on', brightness: 60 }, 'cover.blinds': { state: 'closed' } } } },
};

// 24h of sensor history
for (const id of ['sensor.outside_temperature', 'sensor.power']) {
  const base = Number(states[id].state);
  history[id] = Array.from({ length: 48 }, (_, i) => ({ s: String(Math.round((base + Math.sin(i / 5) * base * 0.15) * 10) / 10), lu: (Date.now() - (48 - i) * 1800e3) / 1000 }));
}

const services = {
  light: { turn_on: { name: 'Turn on', description: 'Turn on one or more lights.', fields: { brightness_pct: { description: 'Brightness percentage', example: 50 }, rgb_color: { description: 'Color', example: [255, 100, 100] } } }, turn_off: { fields: {} }, toggle: { fields: {} } },
  switch: { turn_on: {}, turn_off: {}, toggle: {} },
  homeassistant: { restart: { description: 'Restart Home Assistant' }, turn_on: {}, turn_off: {}, toggle: {}, reload_all: {}, reload_core_config: {} },
  automation: { trigger: {}, turn_on: {}, turn_off: {}, reload: {} },
  script: { turn_on: {}, turn_off: {}, reload: {} },
  scene: { turn_on: {}, reload: {} },
  notify: { notify: { description: 'Send a notification', fields: { message: { required: true, description: 'Message', example: 'Hello' } } } },
};

// ---------------------------------------------------------------------------
// State mutation
// ---------------------------------------------------------------------------
const clients = new Set();

function setState(id, state, attrs = {}) {
  const old = states[id];
  const ns = { ...(old || { entity_id: id, attributes: {}, context: { id: 'x' } }), state: String(state ?? old?.state), attributes: { ...(old?.attributes || {}), ...attrs }, last_updated: now() };
  if (!old || old.state !== ns.state) ns.last_changed = now();
  states[id] = ns;
  broadcast({ event_type: 'state_changed', data: { entity_id: id, old_state: old || null, new_state: ns }, time_fired: now(), origin: 'LOCAL' });
}

function removeState(id) {
  const old = states[id];
  delete states[id];
  broadcast({ event_type: 'state_changed', data: { entity_id: id, old_state: old, new_state: null }, time_fired: now(), origin: 'LOCAL' });
}

function broadcast(event) {
  for (const c of clients) for (const [subId, type] of c.subs) if (type === event.event_type || type === '*') c.send({ id: subId, type: 'event', event });
}

function targets(msg) {
  let ids = msg.target?.entity_id ?? msg.service_data?.entity_id ?? [];
  if (typeof ids === 'string') ids = [ids];
  if (ids.includes('all')) ids = Object.keys(states).filter((i) => i.startsWith(msg.domain + '.'));
  return ids.filter((i) => states[i]);
}

function callService(msg) {
  const { domain, service } = msg;
  const data = msg.service_data || {};
  if (!services[domain]?.[service] && !['set_percentage', 'open_cover', 'close_cover', 'stop_cover', 'set_cover_position', 'set_temperature', 'set_hvac_mode', 'lock', 'unlock', 'media_play_pause', 'media_next_track', 'media_previous_track', 'volume_set', 'set_value', 'select_option', 'start', 'pause', 'return_to_base', 'press'].includes(service))
    throw Object.assign(new Error(`Action ${domain}.${service} not found.`), { code: 'not_found' });
  for (const id of targets(msg)) {
    const d = id.split('.')[0];
    const s = states[id];
    if (service === 'turn_on' && d === 'automation') setState(id, 'on');
    else if (service === 'turn_off' && d === 'automation') setState(id, 'off');
    else if (service === 'trigger') setState(id, s.state, { last_triggered: now() });
    else if (d === 'scene') setState(id, now());
    else if (d === 'script' && service === 'turn_on') {
      setState(id, 'on', { last_triggered: now() });
      setTimeout(() => setState(id, 'off'), 1500);
    } else if (service === 'turn_on') {
      const attrs = {};
      if (data.brightness_pct != null) attrs.brightness = Math.round((data.brightness_pct / 100) * 255);
      else if (d === 'light' && s.attributes.brightness == null && s.attributes.supported_color_modes?.some((m) => m !== 'onoff')) attrs.brightness = 255;
      if (data.color_temp_kelvin) attrs.color_temp_kelvin = data.color_temp_kelvin;
      if (data.rgb_color) attrs.rgb_color = data.rgb_color;
      setState(id, 'on', attrs);
    } else if (service === 'turn_off') setState(id, 'off', d === 'light' ? { brightness: null } : {});
    else if (service === 'toggle') setState(id, s.state === 'on' ? 'off' : 'on');
    else if (service === 'set_percentage') setState(id, data.percentage > 0 ? 'on' : 'off', { percentage: data.percentage });
    else if (service === 'open_cover') setState(id, 'open', s.attributes.current_position != null ? { current_position: 100 } : {});
    else if (service === 'close_cover') setState(id, 'closed', s.attributes.current_position != null ? { current_position: 0 } : {});
    else if (service === 'set_cover_position') setState(id, data.position > 0 ? 'open' : 'closed', { current_position: data.position });
    else if (service === 'set_temperature') setState(id, s.state, { temperature: data.temperature });
    else if (service === 'set_hvac_mode') setState(id, data.hvac_mode);
    else if (service === 'lock') setState(id, 'locked');
    else if (service === 'unlock') setState(id, 'unlocked');
    else if (service === 'media_play_pause') setState(id, s.state === 'playing' ? 'paused' : 'playing');
    else if (service === 'volume_set') setState(id, s.state, { volume_level: data.volume_level });
    else if (service === 'set_value') setState(id, data.value);
    else if (service === 'select_option') setState(id, data.option);
    else if (service === 'start') setState(id, 'cleaning');
    else if (service === 'pause') setState(id, 'paused');
    else if (service === 'return_to_base') setState(id, 'returning');
  }
  return { context: { id: 'ctx' }, ...(msg.return_response ? { response: { ok: true } } : {}) };
}

function renderTemplate(t) {
  return t
    .replace(/\{\{\s*states\(['"]([^'"]+)['"]\)\s*\}\}/g, (_, id) => states[id]?.state ?? 'unknown')
    .replace(/\{\{\s*now\(\)\s*\}\}/g, now())
    .replace(/\{\{([^}]*)\}\}/g, (_, expr) => `[mock: ${expr.trim()}]`);
}

// ---------------------------------------------------------------------------
// WebSocket API
// ---------------------------------------------------------------------------
const issuedTokens = new Set([TOKEN]);

function handleWs(ws) {
  const client = { subs: new Map(), send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)) };
  let authed = false;
  ws.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.11.0-mock' }));
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!authed) {
      if (msg.type === 'auth' && issuedTokens.has(msg.access_token)) {
        authed = true;
        clients.add(client);
        client.send({ type: 'auth_ok', ha_version: '2026.11.0-mock' });
      } else {
        client.send({ type: 'auth_invalid', message: 'Invalid access token or password' });
        ws.close();
      }
      return;
    }
    const ok = (result = null) => client.send({ id: msg.id, type: 'result', success: true, result });
    const fail = (code, message) => client.send({ id: msg.id, type: 'result', success: false, error: { code, message } });
    try {
      switch (msg.type) {
        case 'ping': return client.send({ id: msg.id, type: 'pong' });
        case 'get_states': return ok(Object.values(states));
        case 'get_config': return ok({ location_name: 'Mock Home', version: '2026.11.0-mock', time_zone: 'America/New_York', unit_system: { temperature: '°C' }, components: [] });
        case 'get_services': return ok(services);
        case 'config/area_registry/list': return ok(areas);
        case 'config/device_registry/list': return ok(devices);
        case 'config/entity_registry/list': return ok(entityRegistry);
        case 'subscribe_events': client.subs.set(msg.id, msg.event_type || '*'); return ok();
        case 'unsubscribe_events': client.subs.delete(msg.subscription); return ok();
        case 'call_service': return ok(callService(msg));
        case 'render_template':
          ok();
          return client.send({ id: msg.id, type: 'event', event: { result: renderTemplate(msg.template), listeners: {} } });
        case 'history/history_during_period': {
          const out = {};
          for (const id of msg.entity_ids || []) out[id] = history[id] || [{ s: states[id]?.state, lu: Date.now() / 1000 - 3600 }, { s: states[id]?.state, lu: Date.now() / 1000 }];
          return ok(out);
        }
        case 'automation/config':
        case 'script/config': {
          const kind = msg.type.split('/')[0];
          const st = states[msg.entity_id];
          if (!st) return fail('not_found', 'Entity not found');
          const cid = kind === 'script' ? msg.entity_id.split('.')[1] : st.attributes.id;
          return ok({ config: configs[kind][cid] || { alias: st.attributes.friendly_name, triggers: [{ trigger: 'homeassistant', event: 'start' }], actions: [] } });
        }
        default:
          return fail('unknown_command', `Unknown command: ${msg.type}`);
      }
    } catch (e) {
      fail(e.code || 'home_assistant_error', e.message);
    }
  });
  ws.on('close', () => clients.delete(client));
}

// ---------------------------------------------------------------------------
// HTTP: static app, REST config API, OAuth
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png' };

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function applyConfig(kind, id, cfg) {
  configs[kind][id] = cfg;
  if (kind === 'automation') {
    const existing = Object.values(states).find((s) => s.entity_id.startsWith('automation.') && s.attributes.id === id);
    const eid = existing?.entity_id || `automation.${slug(cfg.alias || id)}`;
    setState(eid, existing?.state || 'on', { friendly_name: cfg.alias || id, id, last_triggered: existing?.attributes.last_triggered ?? null });
  } else if (kind === 'script') {
    setState(`script.${id}`, 'off', { friendly_name: cfg.alias || id, last_triggered: states[`script.${id}`]?.attributes.last_triggered ?? null });
  } else {
    const existing = Object.values(states).find((s) => s.entity_id.startsWith('scene.') && s.attributes.id === id);
    setState(existing?.entity_id || `scene.${slug(cfg.name || id)}`, existing?.state || 'unknown', { friendly_name: cfg.name || id, id, entity_id: Object.keys(cfg.entities || {}) });
  }
}

function deleteConfig(kind, id) {
  delete configs[kind][id];
  const st = Object.values(states).find((s) => s.entity_id.startsWith(kind + '.') && (kind === 'script' ? s.entity_id === `script.${id}` : s.attributes.id === id));
  if (st) removeState(st.entity_id);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === '/' || p === '/local/ha-app') {
    res.writeHead(302, { Location: '/local/ha-app/' });
    return res.end();
  }

  if (p.startsWith('/local/ha-app/')) {
    let rel = decodeURIComponent(p.slice('/local/ha-app/'.length)) || 'index.html';
    const file = path.join(APP_DIR, rel);
    if (!file.startsWith(APP_DIR)) return json(res, 403, { message: 'Forbidden' });
    return fs.readFile(file, (err, buf) => {
      if (err) return json(res, 404, { message: 'Not found' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  }

  // OAuth: a fake login page that immediately offers to approve.
  if (p === '/auth/authorize') {
    const redirect = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    const code = 'code-' + Math.random().toString(36).slice(2);
    const target = `${redirect}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<!doctype html><title>Mock HA login</title><body style="font-family:system-ui;display:grid;place-items:center;height:100vh"><div><h1>Mock Home Assistant</h1><p>Client: ${url.searchParams.get('client_id')}</p><a id="approve" href="${target}">Log in</a></div></body>`);
  }
  if (p === '/auth/token' && req.method === 'POST') {
    const params = new URLSearchParams(await readBody(req));
    if (!['authorization_code', 'refresh_token'].includes(params.get('grant_type'))) return json(res, 400, { error: 'unsupported_grant_type' });
    const access = 'acc-' + Math.random().toString(36).slice(2);
    issuedTokens.add(access);
    return json(res, 200, { access_token: access, token_type: 'Bearer', expires_in: 1800, refresh_token: params.get('refresh_token') || 'ref-' + Math.random().toString(36).slice(2) });
  }

  if (p.startsWith('/api/')) {
    const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!issuedTokens.has(auth)) return json(res, 401, { message: 'Unauthorized' });
    if (p === '/api/') return json(res, 200, { message: 'API running.' });
    if (p === '/api/config/core/check_config' && req.method === 'POST') return json(res, 200, { result: 'valid', errors: null });
    const m = p.match(/^\/api\/config\/(automation|script|scene)\/config\/([^/]+)$/);
    if (m) {
      const [, kind, rawId] = m;
      const id = decodeURIComponent(rawId);
      if (req.method === 'GET') return configs[kind][id] ? json(res, 200, configs[kind][id]) : json(res, 404, { message: 'Resource not found' });
      if (req.method === 'POST') {
        let cfg;
        try {
          cfg = JSON.parse(await readBody(req));
        } catch {
          return json(res, 400, { message: 'Invalid JSON' });
        }
        if (kind === 'automation' && !(cfg.triggers || cfg.trigger)) return json(res, 400, { message: 'Message malformed: required key not provided @ data[\'triggers\']' });
        applyConfig(kind, id, cfg);
        return json(res, 200, { result: 'ok' });
      }
      if (req.method === 'DELETE') {
        if (!configs[kind][id]) return json(res, 404, { message: 'Resource not found' });
        deleteConfig(kind, id);
        return json(res, 200, { result: 'ok' });
      }
    }
    return json(res, 404, { message: 'Not found' });
  }
  json(res, 404, { message: 'Not found' });
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/api/websocket') return socket.destroy();
  wss.handleUpgrade(req, socket, head, handleWs);
});

// Make the fake house feel alive.
setInterval(() => {
  const t = states['sensor.power'];
  setState('sensor.power', String(Math.round(350 + Math.random() * 200)));
  if (Math.random() < 0.3) setState('binary_sensor.motion_hall', states['binary_sensor.motion_hall'].state === 'on' ? 'off' : 'on');
  void t;
}, 5000);

server.listen(PORT, () => {
  console.log(`Mock Home Assistant on http://localhost:${PORT}`);
  console.log(`App: http://localhost:${PORT}/local/ha-app/   (token: ${TOKEN})`);
});
