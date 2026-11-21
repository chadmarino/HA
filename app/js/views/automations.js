// Automations, scripts and scenes: list, enable/disable, run, create, edit (YAML), delete.

import yaml from '../../vendor/js-yaml.mjs';
import { h, clear, attempt, modal, relativeTime, toast, debounce } from '../dom.js';
import { store, onChange } from '../store.js';
import { nameOf, domainOf } from '../cards.js';

const KINDS = {
  automation: { label: 'Automations', single: 'automation', api: 'automation' },
  script: { label: 'Scripts', single: 'script', api: 'script' },
  scene: { label: 'Scenes', single: 'scene', api: 'scene' },
};

/** The config id used by HA's config API for an entity, or null if not UI-editable. */
function configId(st) {
  const d = domainOf(st.entity_id);
  if (d === 'script') return st.entity_id.split('.')[1];
  return st.attributes.id != null ? String(st.attributes.id) : null;
}

function slug(s) {
  return (
    String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || `script_${Date.now()}`
  );
}

function firstEntity(domain, fallback) {
  return Object.keys(store.states).find((id) => id.startsWith(domain + '.')) || fallback;
}

function template(kind) {
  if (kind === 'automation')
    return {
      alias: 'New automation',
      description: '',
      triggers: [{ trigger: 'state', entity_id: firstEntity('binary_sensor', 'binary_sensor.front_door'), to: 'on' }],
      conditions: [],
      actions: [{ action: 'light.turn_on', target: { entity_id: firstEntity('light', 'light.hallway') } }],
      mode: 'single',
    };
  if (kind === 'script')
    return {
      alias: 'New script',
      sequence: [{ action: 'light.turn_on', target: { entity_id: firstEntity('light', 'light.hallway') } }],
      mode: 'single',
    };
  const light = firstEntity('light', 'light.hallway');
  return { name: 'New scene', entities: { [light]: { state: 'on', brightness: 128 } } };
}

export function automationsView(root) {
  let kind = store.prefs.autoKind || 'automation';
  let query = '';
  const tabs = h(
    'div',
    { class: 'seg', role: 'tablist' },
    Object.entries(KINDS).map(([k, v]) =>
      h('button', { role: 'tab', 'data-kind': k, onclick: () => ((kind = k), (store.prefs.autoKind = k), render()) }, v.label),
    ),
  );
  const search = h('input', { type: 'search', placeholder: 'Search…', 'aria-label': 'Search', oninput: debounce((e) => ((query = e.target.value.toLowerCase()), render()), 120) });
  const newBtn = h('button', { class: 'btn primary', onclick: () => openEditor(kind, null) }, '+ New');
  const list = h('div', { class: 'list' });
  root.append(h('div', { class: 'toolbar' }, tabs, search, newBtn), list);

  const rows = new Map();

  function render() {
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.kind === kind));
    newBtn.textContent = `+ New ${KINDS[kind].single}`;
    rows.clear();
    clear(list);
    const items = Object.values(store.states)
      .filter((s) => domainOf(s.entity_id) === kind)
      .filter((s) => !query || nameOf(s).toLowerCase().includes(query) || s.entity_id.includes(query))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    if (!items.length) {
      list.append(h('p', { class: 'empty' }, query ? 'Nothing matches.' : `No ${KINDS[kind].label.toLowerCase()} yet.`));
      return;
    }
    for (const s of items) {
      const row = buildRow(s);
      rows.set(s.entity_id, row);
      list.append(row.el);
    }
  }

  function buildRow(st) {
    const id = st.entity_id;
    const d = domainOf(id);
    const name = h('strong');
    const sub = h('span', { class: 'muted' });
    const toggle = d === 'automation' ? h('input', { type: 'checkbox', class: 'toggle', 'aria-label': 'Enabled', onchange: (e) => attempt(() => store.conn.callService('automation', e.target.checked ? 'turn_on' : 'turn_off', {}, { entity_id: id })) }) : null;
    const runLabel = d === 'scene' ? 'Activate' : 'Run';
    const run = h(
      'button',
      {
        class: 'btn',
        title: d === 'automation' ? 'Run actions now (skips triggers and conditions)' : '',
        onclick: () =>
          attempt(
            () =>
              d === 'automation'
                ? store.conn.callService('automation', 'trigger', { skip_condition: true }, { entity_id: id })
                : store.conn.callService(d, 'turn_on', {}, { entity_id: id }),
            `${runLabel}: ${nameOf(store.states[id])}`,
          ),
      },
      runLabel,
    );
    const edit = h('button', { class: 'btn', onclick: () => openEditor(d, store.states[id]) }, 'Edit');
    const el = h('div', { class: 'row', 'data-entity': id }, h('div', { class: 'row-text' }, name, sub), h('div', { class: 'row-actions' }, run, edit, toggle));
    const update = (s) => {
      name.textContent = nameOf(s);
      const bits = [];
      if (d === 'automation') bits.push(s.state === 'on' ? 'Enabled' : s.state === 'off' ? 'Disabled' : s.state);
      if (d === 'script' && s.state === 'on') bits.push('Running');
      const last = s.attributes.last_triggered || (d === 'scene' && s.state !== 'unknown' ? s.state : null);
      bits.push(last ? `Last run ${relativeTime(last)}` : 'Never run');
      if (!configId(s)) bits.push('YAML-only (read-only)');
      sub.textContent = bits.join(' · ');
      if (toggle) toggle.checked = s.state === 'on';
      el.classList.toggle('disabled', d === 'automation' && s.state === 'off');
    };
    update(st);
    return { el, update };
  }

  render();
  let count = 0;
  const off = onChange((ids) => {
    const c = Object.keys(store.states).filter((i) => domainOf(i) === kind).length;
    if (ids === null || c !== count) {
      count = c;
      render();
      return;
    }
    for (const id of ids) rows.get(id)?.update(store.states[id]);
  });
  return () => off();
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

async function loadConfig(kind, st) {
  const cid = configId(st);
  if (cid) {
    try {
      return { config: await store.conn.rest('GET', `/api/config/${KINDS[kind].api}/config/${encodeURIComponent(cid)}`), id: cid, editable: true };
    } catch (e) {
      if (e.status !== 404 && e.status !== 400) throw e;
    }
  }
  // Not managed by the UI config files: fetch read-only via WebSocket where supported.
  if (kind === 'automation' || kind === 'script') {
    const r = await store.conn.send({ type: `${kind}/config`, entity_id: st.entity_id });
    return { config: r.config, id: cid, editable: false };
  }
  return { config: { entities: Object.fromEntries((st.attributes.entity_id || []).map((e) => [e, {}])) }, id: cid, editable: false };
}

export async function openEditor(kind, st) {
  let loaded;
  if (st) {
    loaded = await attempt(() => loadConfig(kind, st));
    if (!loaded) return;
  } else {
    loaded = { config: template(kind), id: null, editable: true };
  }

  const textarea = h('textarea', { class: 'code', spellcheck: 'false', rows: 20, 'aria-label': 'YAML' });
  textarea.value = yaml.dump(loaded.config, { lineWidth: 120, noRefs: true });
  const err = h('p', { class: 'error', hidden: true });
  textarea.addEventListener('input', () => {
    try {
      yaml.load(textarea.value);
      err.hidden = true;
    } catch (e) {
      err.textContent = e.message.split('\n')[0];
      err.hidden = false;
    }
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      textarea.setRangeText('  ', textarea.selectionStart, textarea.selectionEnd, 'end');
    }
  });

  const builder = kind === 'automation' && !st ? quickBuilder((cfg) => (textarea.value = yaml.dump(cfg, { lineWidth: 120 }))) : null;

  const notice = loaded.editable
    ? null
    : h('p', { class: 'notice' }, 'This one is defined in YAML outside the UI-managed files, so it is read-only here. Copy it into your config to change it.');

  const content = h('div', { class: 'editor' }, notice, builder, textarea, err, h('p', { class: 'muted small' }, 'Tip: Tab inserts spaces. Ctrl/⌘+S saves.'));

  const save = async () => {
    let cfg;
    try {
      cfg = yaml.load(textarea.value);
    } catch (e) {
      toast(`YAML error: ${e.message.split('\n')[0]}`, 'error');
      return;
    }
    if (!cfg || typeof cfg !== 'object') {
      toast('Config must be a YAML mapping', 'error');
      return;
    }
    let id = loaded.id;
    if (!id) id = kind === 'script' ? slug(cfg.alias) : String(Date.now());
    if (kind !== 'script') cfg.id = id;
    else delete cfg.id;
    const ok = await attempt(() => store.conn.rest('POST', `/api/config/${KINDS[kind].api}/config/${encodeURIComponent(id)}`, cfg), 'Saved');
    if (ok !== undefined) dlg.close();
  };

  const del = async () => {
    if (!confirm(`Delete "${nameOf(st)}"? This cannot be undone.`)) return;
    const ok = await attempt(() => store.conn.rest('DELETE', `/api/config/${KINDS[kind].api}/config/${encodeURIComponent(loaded.id)}`), 'Deleted');
    if (ok !== undefined) dlg.close();
  };

  const actions = [];
  if (st && loaded.editable) actions.push(h('button', { class: 'btn danger', onclick: del }, 'Delete'));
  actions.push(h('span', { class: 'spacer' }));
  if (loaded.editable) actions.push(h('button', { class: 'btn primary', onclick: save }, 'Save'));

  const dlg = modal(st ? `Edit ${nameOf(st)}` : `New ${KINDS[kind].single}`, content, actions);
  dlg.el.classList.add('wide');
  dlg.el.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (loaded.editable) save();
    }
  });
}

/** A small "When … then …" form that generates automation YAML. */
function quickBuilder(onGenerate) {
  const ids = Object.keys(store.states).sort();
  const listId = 'qb-entities';
  const datalist = h('datalist', { id: listId }, ids.map((i) => h('option', { value: i }, nameOf(store.states[i]))));

  const triggerType = h('select', { 'aria-label': 'Trigger type' }, [
    h('option', { value: 'state' }, 'An entity changes to…'),
    h('option', { value: 'time' }, 'At a time of day'),
    h('option', { value: 'sunset' }, 'At sunset'),
    h('option', { value: 'sunrise' }, 'At sunrise'),
  ]);
  const trigEntity = h('input', { list: listId, placeholder: 'binary_sensor.front_door', 'aria-label': 'Trigger entity' });
  const trigTo = h('input', { placeholder: 'on', 'aria-label': 'Changes to', size: 8 });
  const trigTime = h('input', { type: 'time', value: '07:00', 'aria-label': 'Time' });
  const actEntity = h('input', { list: listId, placeholder: 'light.hallway', 'aria-label': 'Action entity' });
  const actService = h('select', { 'aria-label': 'Action' }, ['turn_on', 'turn_off', 'toggle'].map((s) => h('option', { value: s }, s.replace('_', ' '))));
  const name = h('input', { placeholder: 'Name (optional)', 'aria-label': 'Name' });

  const stateBits = h('span', { class: 'qb-state' }, trigEntity, ' to ', trigTo);
  const sync = () => {
    stateBits.hidden = triggerType.value !== 'state';
    trigTime.hidden = triggerType.value !== 'time';
  };
  triggerType.addEventListener('change', sync);
  sync();

  const generate = () => {
    let trigger;
    if (triggerType.value === 'state') {
      if (!trigEntity.value) return toast('Pick a trigger entity', 'error');
      trigger = { trigger: 'state', entity_id: trigEntity.value.trim() };
      if (trigTo.value.trim()) trigger.to = trigTo.value.trim();
    } else if (triggerType.value === 'time') trigger = { trigger: 'time', at: `${trigTime.value}:00` };
    else trigger = { trigger: 'sun', event: triggerType.value };
    if (!actEntity.value) return toast('Pick an entity to control', 'error');
    const target = actEntity.value.trim();
    const domain = target.split('.')[0];
    const svc = ['light', 'switch', 'fan', 'input_boolean', 'media_player', 'climate', 'humidifier', 'siren'].includes(domain) ? domain : 'homeassistant';
    const label = name.value.trim() || `${nameOf(store.states[target]) || target} ${actService.value.replace('_', ' ')}`;
    onGenerate({ alias: label, description: 'Created with HA App quick builder', triggers: [trigger], conditions: [], actions: [{ action: `${svc}.${actService.value}`, target: { entity_id: target } }], mode: 'single' });
  };

  return h(
    'details',
    { class: 'builder', open: true },
    h('summary', null, 'Quick builder'),
    datalist,
    h('div', { class: 'qb-row' }, h('span', null, 'When'), triggerType, stateBits, trigTime),
    h('div', { class: 'qb-row' }, h('span', null, 'Then'), actService, actEntity),
    h('div', { class: 'qb-row' }, name, h('button', { class: 'btn', onclick: generate }, 'Generate YAML ↓')),
  );
}
