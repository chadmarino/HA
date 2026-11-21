// Entity cards: one card per entity with controls appropriate to its domain.
// Each card is built once and then updated in place when its state changes,
// so sliders aren't reset while the user is dragging them.

import { h, attempt, relativeTime } from './dom.js';
import { store, toggleFavorite } from './store.js';

export const HOME_DOMAINS = new Set([
  'light', 'switch', 'fan', 'cover', 'climate', 'lock', 'media_player', 'scene', 'script',
  'button', 'input_button', 'input_boolean', 'input_number', 'input_select', 'select', 'number',
  'vacuum', 'sensor', 'binary_sensor', 'person', 'device_tracker', 'alarm_control_panel',
  'humidifier', 'water_heater', 'valve', 'siren', 'weather', 'camera', 'lawn_mower', 'update',
]);

const ICONS = {
  light: '💡', switch: '🔌', fan: '🌀', cover: '🪟', climate: '🌡️', lock: '🔒', media_player: '🎵',
  scene: '🎬', script: '📜', button: '🔘', input_button: '🔘', input_boolean: '🔘', input_number: '🔢',
  input_select: '📋', select: '📋', number: '🔢', vacuum: '🧹', sensor: '📈', binary_sensor: '⚪',
  person: '🧑', device_tracker: '📍', alarm_control_panel: '🛡️', humidifier: '💧', water_heater: '♨️',
  valve: '🚰', siren: '🚨', weather: '⛅', camera: '📷', lawn_mower: '🌱', update: '⬆️', automation: '🤖',
};

const BINARY_LABELS = {
  door: ['Closed', 'Open'], window: ['Closed', 'Open'], garage_door: ['Closed', 'Open'], opening: ['Closed', 'Open'],
  motion: ['Clear', 'Detected'], occupancy: ['Clear', 'Detected'], presence: ['Away', 'Home'],
  moisture: ['Dry', 'Wet'], smoke: ['Clear', 'Detected'], gas: ['Clear', 'Detected'], lock: ['Locked', 'Unlocked'],
  battery: ['Normal', 'Low'], connectivity: ['Disconnected', 'Connected'], plug: ['Unplugged', 'Plugged in'],
  problem: ['OK', 'Problem'], safety: ['Safe', 'Unsafe'], vibration: ['Clear', 'Detected'],
};

export const domainOf = (id) => id.split('.')[0];
export const nameOf = (st) => st?.attributes?.friendly_name || st?.entity_id || '';
const isOff = (s) => ['off', 'unavailable', 'unknown', 'closed', 'locked', 'idle', 'standby', 'docked'].includes(s);

export function iconFor(st) {
  const d = domainOf(st.entity_id);
  if (d === 'lock') return st.state === 'unlocked' ? '🔓' : '🔒';
  return ICONS[d] || '◻️';
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s).replace(/_/g, ' ');

export function stateText(st) {
  if (!st) return '';
  const a = st.attributes || {};
  const d = domainOf(st.entity_id);
  if (st.state === 'unavailable') return 'Unavailable';
  if (d === 'binary_sensor') {
    const lbl = BINARY_LABELS[a.device_class];
    if (lbl) return st.state === 'on' ? lbl[1] : st.state === 'off' ? lbl[0] : st.state;
  }
  if (d === 'climate') {
    const cur = a.current_temperature != null ? `${a.current_temperature}°` : '';
    return [cap(st.state), cur].filter(Boolean).join(' · ');
  }
  if (d === 'media_player' && a.media_title) return `${cap(st.state)} · ${a.media_title}`;
  if (d === 'weather' && a.temperature != null) return `${cap(st.state)} · ${a.temperature}${a.temperature_unit || '°'}`;
  if (d === 'cover' && a.current_position != null && st.state !== 'closed') return `${cap(st.state)} · ${a.current_position}%`;
  if (d === 'light' && st.state === 'on' && a.brightness != null) return `On · ${Math.round((a.brightness / 255) * 100)}%`;
  if (d === 'sensor' && a.device_class === 'timestamp' && st.state) return relativeTime(st.state);
  const unit = a.unit_of_measurement ? ` ${a.unit_of_measurement}` : '';
  return cap(st.state) + unit;
}

const call = (domain, service, data, entityId) =>
  attempt(() => store.conn.callService(domain, service, data, entityId ? { entity_id: entityId } : undefined));

function toggleControl(st) {
  const d = domainOf(st.entity_id);
  const input = h('input', {
    type: 'checkbox',
    class: 'toggle',
    'aria-label': `Toggle ${nameOf(st)}`,
    onchange: () => call(d, input.checked ? 'turn_on' : 'turn_off', {}, st.entity_id),
  });
  return { el: input, update: (s) => ((input.checked = s.state === 'on'), (input.disabled = s.state === 'unavailable')) };
}

/** Slider that calls onCommit(value) when released; won't jump while being dragged. */
function slider({ min = 0, max = 100, step = 1, label, onCommit, format = (v) => v }) {
  const out = h('span', { class: 'slider-val' });
  const input = h('input', { type: 'range', min, max, step, 'aria-label': label });
  let dragging = false;
  input.addEventListener('pointerdown', () => (dragging = true));
  input.addEventListener('input', () => (out.textContent = format(Number(input.value))));
  input.addEventListener('change', () => {
    dragging = false;
    onCommit(Number(input.value));
  });
  const el = h('label', { class: 'slider' }, h('span', { class: 'slider-label' }, label), input, out);
  return {
    el,
    set(v, opts = {}) {
      if (opts.min != null) input.min = opts.min;
      if (opts.max != null) input.max = opts.max;
      if (opts.step != null) input.step = opts.step;
      if (dragging || v == null || Number.isNaN(v)) return;
      input.value = v;
      out.textContent = format(Number(v));
    },
    show(visible) {
      el.hidden = !visible;
    },
  };
}

function buttons(defs) {
  return h('div', { class: 'btn-row' }, defs.map(([label, fn, cls]) => h('button', { class: cls || 'btn', onclick: fn }, label)));
}

function select(label, onChange) {
  const sel = h('select', { 'aria-label': label, onchange: () => onChange(sel.value) });
  return {
    el: sel,
    set(options, value) {
      const key = options.join('\u0000');
      if (sel.dataset.key !== key) {
        sel.replaceChildren(...options.map((o) => h('option', { value: o }, String(o).replace(/_/g, ' '))));
        sel.dataset.key = key;
      }
      if (document.activeElement !== sel) sel.value = value;
    },
  };
}

// Builds the domain-specific controls. Returns {head?, body?, update(st)}
function controlsFor(st) {
  const id = st.entity_id;
  const d = domainOf(id);
  const a0 = st.attributes || {};

  switch (d) {
    case 'switch':
    case 'input_boolean':
    case 'siren':
    case 'humidifier': {
      const t = toggleControl(st);
      return { head: t.el, update: t.update };
    }
    case 'light': {
      const t = toggleControl(st);
      const modes = a0.supported_color_modes || [];
      const dimmable = modes.some((m) => m !== 'onoff');
      const hasColor = modes.some((m) => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(m));
      const hasTemp = modes.includes('color_temp');
      const bri = slider({ label: 'Brightness', format: (v) => `${v}%`, onCommit: (v) => call('light', 'turn_on', { brightness_pct: v }, id) });
      const ct = slider({ label: 'Warmth', format: (v) => `${v}K`, onCommit: (v) => call('light', 'turn_on', { color_temp_kelvin: v }, id) });
      const color = h('input', {
        type: 'color',
        'aria-label': 'Color',
        onchange: (e) => {
          const hex = e.target.value;
          const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
          call('light', 'turn_on', { rgb_color: rgb }, id);
        },
      });
      const body = h('div', { class: 'controls' }, dimmable ? bri.el : null, hasTemp ? ct.el : null, hasColor ? h('label', { class: 'slider' }, h('span', { class: 'slider-label' }, 'Color'), color) : null);
      return {
        head: t.el,
        body,
        update(s) {
          t.update(s);
          const a = s.attributes;
          const on = s.state === 'on';
          bri.set(on && a.brightness != null ? Math.round((a.brightness / 255) * 100) : 0);
          ct.set(a.color_temp_kelvin, { min: a.min_color_temp_kelvin || 2000, max: a.max_color_temp_kelvin || 6500, step: 50 });
          if (a.rgb_color && document.activeElement !== color) color.value = '#' + a.rgb_color.map((c) => c.toString(16).padStart(2, '0')).join('');
        },
      };
    }
    case 'fan': {
      const t = toggleControl(st);
      const speed = slider({ label: 'Speed', format: (v) => `${v}%`, onCommit: (v) => call('fan', 'set_percentage', { percentage: v }, id) });
      const hasSpeed = (a0.supported_features & 1) === 1 || a0.percentage != null;
      return {
        head: t.el,
        body: hasSpeed ? h('div', { class: 'controls' }, speed.el) : null,
        update(s) {
          t.update(s);
          speed.set(s.attributes.percentage ?? 0, { step: s.attributes.percentage_step || 1 });
        },
      };
    }
    case 'cover': {
      const pos = slider({ label: 'Position', format: (v) => `${v}%`, onCommit: (v) => call('cover', 'set_cover_position', { position: v }, id) });
      const body = h(
        'div',
        { class: 'controls' },
        buttons([
          ['▲ Open', () => call('cover', 'open_cover', {}, id)],
          ['■ Stop', () => call('cover', 'stop_cover', {}, id)],
          ['▼ Close', () => call('cover', 'close_cover', {}, id)],
        ]),
        a0.current_position != null ? pos.el : null,
      );
      return { body, update: (s) => pos.set(s.attributes.current_position) };
    }
    case 'valve':
      return { body: buttons([['Open', () => call('valve', 'open_valve', {}, id)], ['Close', () => call('valve', 'close_valve', {}, id)]]), update() {} };
    case 'climate':
    case 'water_heater': {
      const target = h('span', { class: 'target-temp' });
      const step = () => store.states[id]?.attributes?.target_temp_step || (store.config?.unit_system?.temperature === '°F' ? 1 : 0.5);
      const bump = (dir) => {
        const cur = store.states[id]?.attributes?.temperature;
        if (cur == null) return;
        const next = Math.round((cur + dir * step()) * 10) / 10;
        call(d, 'set_temperature', { temperature: next }, id);
      };
      const mode = select('Mode', (v) => call(d, d === 'climate' ? 'set_hvac_mode' : 'set_operation_mode', d === 'climate' ? { hvac_mode: v } : { operation_mode: v }, id));
      const tempRow = h('div', { class: 'btn-row temp-row' }, h('button', { class: 'btn round', 'aria-label': 'Lower', onclick: () => bump(-1) }, '−'), target, h('button', { class: 'btn round', 'aria-label': 'Raise', onclick: () => bump(1) }, '+'));
      return {
        body: h('div', { class: 'controls' }, tempRow, mode.el),
        update(s) {
          const a = s.attributes;
          if (a.temperature != null) {
            target.textContent = `${a.temperature}°`;
            tempRow.hidden = false;
          } else if (a.target_temp_low != null) {
            target.textContent = `${a.target_temp_low}–${a.target_temp_high}°`;
          } else tempRow.hidden = true;
          const modes = d === 'climate' ? a.hvac_modes : a.operation_list;
          if (modes?.length) mode.set(modes, d === 'climate' ? s.state : a.operation_mode);
          mode.el.hidden = !modes?.length;
        },
      };
    }
    case 'lock': {
      const btn = h('button', {
        class: 'btn',
        onclick: () => {
          const s = store.states[id];
          if (s.state === 'locked') {
            if (confirm(`Unlock ${nameOf(s)}?`)) call('lock', 'unlock', {}, id);
          } else call('lock', 'lock', {}, id);
        },
      });
      return { head: btn, update: (s) => (btn.textContent = s.state === 'locked' ? 'Unlock' : 'Lock') };
    }
    case 'media_player': {
      const vol = slider({ label: 'Volume', format: (v) => `${v}%`, onCommit: (v) => call('media_player', 'volume_set', { volume_level: v / 100 }, id) });
      const power = toggleControl(st);
      const body = h(
        'div',
        { class: 'controls' },
        buttons([
          ['⏮', () => call('media_player', 'media_previous_track', {}, id)],
          ['⏯', () => call('media_player', 'media_play_pause', {}, id)],
          ['⏭', () => call('media_player', 'media_next_track', {}, id)],
        ]),
        vol.el,
      );
      return {
        head: power.el,
        body,
        update(s) {
          power.update({ ...s, state: s.state === 'off' ? 'off' : 'on' });
          vol.show(s.attributes.volume_level != null);
          vol.set(Math.round((s.attributes.volume_level || 0) * 100));
        },
      };
    }
    case 'scene':
      return { head: h('button', { class: 'btn primary', onclick: () => call('scene', 'turn_on', {}, id) }, 'Activate'), update() {} };
    case 'script': {
      const btn = h('button', { class: 'btn primary', onclick: () => call('script', store.states[id]?.state === 'on' ? 'turn_off' : 'turn_on', {}, id) });
      return { head: btn, update: (s) => (btn.textContent = s.state === 'on' ? 'Stop' : 'Run') };
    }
    case 'button':
    case 'input_button':
      return { head: h('button', { class: 'btn primary', onclick: () => call(d, 'press', {}, id) }, 'Press'), update() {} };
    case 'number':
    case 'input_number': {
      const sl = slider({ label: 'Value', format: (v) => `${v}${a0.unit_of_measurement ? ' ' + a0.unit_of_measurement : ''}`, onCommit: (v) => call(d, 'set_value', { value: v }, id) });
      return { body: h('div', { class: 'controls' }, sl.el), update: (s) => sl.set(Number(s.state), { min: s.attributes.min, max: s.attributes.max, step: s.attributes.step }) };
    }
    case 'select':
    case 'input_select': {
      const sel = select('Option', (v) => call(d, 'select_option', { option: v }, id));
      return { head: sel.el, update: (s) => sel.set(s.attributes.options || [], s.state) };
    }
    case 'vacuum':
      return {
        body: buttons([
          ['Start', () => call('vacuum', 'start', {}, id)],
          ['Pause', () => call('vacuum', 'pause', {}, id)],
          ['Dock', () => call('vacuum', 'return_to_base', {}, id)],
        ]),
        update() {},
      };
    case 'lawn_mower':
      return {
        body: buttons([
          ['Start', () => call('lawn_mower', 'start_mowing', {}, id)],
          ['Pause', () => call('lawn_mower', 'pause', {}, id)],
          ['Dock', () => call('lawn_mower', 'dock', {}, id)],
        ]),
        update() {},
      };
    case 'alarm_control_panel': {
      const act = (service) => {
        const s = store.states[id];
        const data = {};
        if (s.attributes.code_format) {
          const code = prompt(`Code for ${nameOf(s)}`);
          if (code === null) return;
          data.code = code;
        }
        call('alarm_control_panel', service, data, id);
      };
      return {
        body: buttons([
          ['Disarm', () => act('alarm_disarm')],
          ['Home', () => act('alarm_arm_home')],
          ['Away', () => act('alarm_arm_away')],
        ]),
        update() {},
      };
    }
    case 'update': {
      const btn = h('button', { class: 'btn', onclick: () => confirm(`Install update for ${nameOf(store.states[id])}?`) && call('update', 'install', {}, id) }, 'Install');
      return { head: btn, update: (s) => (btn.hidden = s.state !== 'on') };
    }
    default:
      return { update() {} };
  }
}

/** Create a card for an entity. Returns {el, update(state)}. */
export function createCard(st, { onDetails } = {}) {
  const id = st.entity_id;
  const icon = h('span', { class: 'card-icon', 'aria-hidden': 'true' });
  const name = h('span', { class: 'card-name' });
  const state = h('span', { class: 'card-state' });
  const star = h('button', {
    class: 'icon-btn star',
    title: 'Favorite',
    'aria-label': 'Toggle favorite',
    onclick: (e) => {
      e.stopPropagation();
      toggleFavorite(id);
      star.classList.toggle('on', store.prefs.favorites.includes(id));
      star.textContent = store.prefs.favorites.includes(id) ? '★' : '☆';
    },
  });
  const ctl = controlsFor(st);
  const info = h('button', { class: 'card-info', onclick: () => onDetails && onDetails(id), title: id }, icon, h('span', { class: 'card-text' }, name, state));
  const el = h('article', { class: 'card', 'data-entity': id, 'data-domain': domainOf(id) }, h('div', { class: 'card-head' }, info, ctl.head || null, star), ctl.body || null);

  function update(s) {
    if (!s) return;
    icon.textContent = iconFor(s);
    name.textContent = nameOf(s);
    state.textContent = stateText(s);
    el.classList.toggle('active', !isOff(s.state) && !['sensor', 'person', 'device_tracker', 'weather', 'scene', 'button', 'input_button'].includes(domainOf(id)));
    el.classList.toggle('unavailable', s.state === 'unavailable');
    const fav = store.prefs.favorites.includes(id);
    star.classList.toggle('on', fav);
    star.textContent = fav ? '★' : '☆';
    ctl.update(s);
  }
  update(st);
  return { el, update };
}
