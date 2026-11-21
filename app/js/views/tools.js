// Developer / admin tools: call any action, render templates, browse states, system controls.

import yaml from '../../vendor/js-yaml.mjs';
import { h, clear, attempt, toast, debounce } from '../dom.js';
import { store } from '../store.js';
import { nameOf } from '../cards.js';
import { showDetails } from './details.js';

export function toolsView(root) {
  const tabs = [
    ['actions', 'Actions', actionsTool],
    ['template', 'Template', templateTool],
    ['states', 'States', statesTool],
    ['system', 'System', systemTool],
  ];
  let current = store.prefs.toolTab || 'actions';
  let cleanup = null;
  const seg = h('div', { class: 'seg', role: 'tablist' }, tabs.map(([k, label]) => h('button', { role: 'tab', 'data-k': k, onclick: () => show(k) }, label)));
  const body = h('div', { class: 'tool-body' });
  root.append(h('div', { class: 'toolbar' }, seg), body);

  function show(k) {
    current = k;
    store.prefs.toolTab = k;
    for (const b of seg.children) b.setAttribute('aria-selected', String(b.dataset.k === k));
    if (cleanup) cleanup();
    clear(body);
    cleanup = tabs.find((t) => t[0] === k)[2](body) || null;
  }
  show(current);
  return () => cleanup && cleanup();
}

function entityDatalist(id) {
  return h('datalist', { id }, Object.keys(store.states).sort().map((e) => h('option', { value: e }, nameOf(store.states[e]))));
}

function actionsTool(root) {
  const services = store.services || {};
  const all = Object.entries(services).flatMap(([d, svcs]) => Object.keys(svcs).map((s) => `${d}.${s}`)).sort();
  const svcInput = h('input', { list: 'svc-list', placeholder: 'light.turn_on', 'aria-label': 'Action', autocomplete: 'off' });
  const target = h('input', { list: 'ent-list', placeholder: 'light.kitchen (optional, comma separated)', 'aria-label': 'Target entities' });
  const data = h('textarea', { class: 'code', rows: 6, spellcheck: 'false', 'aria-label': 'Data (YAML)', placeholder: 'brightness_pct: 50' });
  const wantResponse = h('input', { type: 'checkbox', id: 'ret-resp' });
  const help = h('div', { class: 'svc-help muted' });
  const out = h('pre', { class: 'output', hidden: true });

  const describe = () => {
    const [d, s] = svcInput.value.split('.');
    const def = services[d]?.[s];
    clear(help);
    if (!def) return;
    if (def.description) help.append(h('p', null, def.description));
    const fields = Object.entries(def.fields || {}).filter(([, f]) => f && typeof f === 'object' && !f.fields);
    if (fields.length)
      help.append(
        h('table', { class: 'attrs' }, fields.map(([k, f]) => h('tr', null, h('th', null, k + (f.required ? ' *' : '')), h('td', null, f.description || f.name || '', f.example != null ? h('code', null, ` e.g. ${JSON.stringify(f.example)}`) : null)))),
        h('button', { class: 'btn small', onclick: () => (data.value = yaml.dump(Object.fromEntries(fields.filter(([, f]) => f.example != null).map(([k, f]) => [k, f.example])))) }, 'Fill examples'),
      );
  };
  svcInput.addEventListener('input', debounce(describe, 150));

  const run = async () => {
    const [d, s] = svcInput.value.trim().split('.');
    if (!d || !s) return toast('Enter an action like light.turn_on', 'error');
    let payload = {};
    try {
      payload = data.value.trim() ? yaml.load(data.value) || {} : {};
    } catch (e) {
      return toast(`YAML error: ${e.message.split('\n')[0]}`, 'error');
    }
    const ids = target.value.split(',').map((x) => x.trim()).filter(Boolean);
    const res = await attempt(() => store.conn.callService(d, s, payload, ids.length ? { entity_id: ids } : undefined, wantResponse.checked), `Called ${d}.${s}`);
    if (res !== undefined) {
      out.hidden = false;
      out.textContent = res?.response ? yaml.dump(res.response) : 'OK';
    }
  };

  root.append(
    h('datalist', { id: 'svc-list' }, all.map((s) => h('option', { value: s }))),
    entityDatalist('ent-list'),
    h('div', { class: 'form' }, h('label', null, 'Action', svcInput), help, h('label', null, 'Targets', target), h('label', null, 'Data (YAML)', data), h('label', { class: 'inline' }, wantResponse, ' Return response'), h('div', null, h('button', { class: 'btn primary', onclick: run }, 'Perform action'))),
    out,
  );
}

function templateTool(root) {
  const tpl = h('textarea', { class: 'code', rows: 8, spellcheck: 'false', 'aria-label': 'Template' });
  tpl.value = store.prefs.lastTemplate || "{{ states('sun.sun') }}\n{{ states.light | selectattr('state','eq','on') | map(attribute='name') | list }}";
  const out = h('pre', { class: 'output' });
  let unsub = null;
  const render = debounce(async () => {
    store.prefs.lastTemplate = tpl.value;
    if (unsub) {
      const u = unsub;
      unsub = null;
      u();
    }
    out.textContent = '…';
    try {
      unsub = await store.conn.subscribe(
        { type: 'render_template', template: tpl.value, report_errors: true, strict: false },
        (ev) => {
          if (ev.error) out.textContent = `Error: ${ev.error}`;
          else out.textContent = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result, null, 2);
        },
        'unsubscribe_events',
      );
    } catch (e) {
      out.textContent = `Error: ${e.message}`;
    }
  }, 400);
  tpl.addEventListener('input', render);
  render();
  root.append(h('p', { class: 'muted' }, 'Jinja2 templates render live on your Home Assistant.'), tpl, out);
  return () => unsub && unsub();
}

function statesTool(root) {
  let q = '';
  const input = h('input', { type: 'search', placeholder: 'Filter entity id, name or state…', 'aria-label': 'Filter', oninput: debounce((e) => ((q = e.target.value.toLowerCase()), draw()), 120) });
  const table = h('table', { class: 'states' });
  const draw = () => {
    const rows = Object.values(store.states)
      .filter((s) => !q || s.entity_id.includes(q) || nameOf(s).toLowerCase().includes(q) || String(s.state).toLowerCase().includes(q))
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
      .slice(0, 500);
    table.replaceChildren(
      h('tr', null, h('th', null, 'Entity'), h('th', null, 'State')),
      ...rows.map((s) => h('tr', { onclick: () => showDetails(s.entity_id), class: 'clickable' }, h('td', null, h('div', null, nameOf(s)), h('code', { class: 'muted' }, s.entity_id)), h('td', null, s.state))),
    );
  };
  draw();
  root.append(h('p', { class: 'muted' }, `${Object.keys(store.states).length} entities. Click one for details.`), input, table);
}

function systemTool(root) {
  const cfg = store.config || {};
  const result = h('pre', { class: 'output', hidden: true });
  const svc = (d, s, msg) => () => attempt(() => store.conn.callService(d, s), msg);
  const check = async () => {
    const r = await attempt(() => store.conn.rest('POST', '/api/config/core/check_config'));
    if (!r) return;
    result.hidden = false;
    result.textContent = r.result === 'valid' ? '✅ Configuration is valid.' : `❌ ${r.errors || 'Invalid configuration'}`;
    return r.result === 'valid';
  };
  const restart = async () => {
    if (!confirm('Restart Home Assistant? Your home will be unresponsive for a minute.')) return;
    if ((await check()) === false && !confirm('Config check failed. Restart anyway?')) return;
    attempt(() => store.conn.callService('homeassistant', 'restart'), 'Restarting…');
  };
  root.append(
    h(
      'dl',
      { class: 'info' },
      h('dt', null, 'Name'), h('dd', null, cfg.location_name || '—'),
      h('dt', null, 'Version'), h('dd', null, cfg.version || store.conn.haVersion || '—'),
      h('dt', null, 'Time zone'), h('dd', null, cfg.time_zone || '—'),
      h('dt', null, 'Units'), h('dd', null, cfg.unit_system?.temperature || '—'),
      h('dt', null, 'Entities'), h('dd', null, String(Object.keys(store.states).length)),
      h('dt', null, 'Areas'), h('dd', null, String(Object.keys(store.areas).length)),
    ),
    h('h3', null, 'Reload'),
    h(
      'div',
      { class: 'btn-row wrap' },
      h('button', { class: 'btn', onclick: svc('automation', 'reload', 'Automations reloaded') }, 'Automations'),
      h('button', { class: 'btn', onclick: svc('script', 'reload', 'Scripts reloaded') }, 'Scripts'),
      h('button', { class: 'btn', onclick: svc('scene', 'reload', 'Scenes reloaded') }, 'Scenes'),
      h('button', { class: 'btn', onclick: svc('homeassistant', 'reload_core_config', 'Core config reloaded') }, 'Core config'),
      h('button', { class: 'btn', onclick: svc('homeassistant', 'reload_all', 'Reloaded all YAML') }, 'All YAML'),
    ),
    h('h3', null, 'Server'),
    h('div', { class: 'btn-row wrap' }, h('button', { class: 'btn', onclick: check }, 'Check configuration'), h('button', { class: 'btn danger', onclick: restart }, 'Restart Home Assistant')),
    result,
  );
}
