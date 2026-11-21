// Central app state: entity states, registries, user preferences.

const PREFS_KEY = 'ha-app-prefs';

export const store = {
  conn: null,
  states: {}, // entity_id -> state object
  areas: {}, // area_id -> area
  devices: {}, // device_id -> device
  entities: {}, // entity_id -> entity registry entry
  services: {}, // domain -> {service -> def}
  config: null, // HA core config
  isAdmin: true,
  listeners: new Set(), // (changedEntityIds:Set|null) => void ; null means "everything"
  prefs: loadPrefs(),
};

function loadPrefs() {
  const defaults = { favorites: [], showHidden: false, theme: 'auto', lastView: 'home' };
  if (typeof window !== 'undefined' && window.HA_APP_DEMO) return defaults;
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(PREFS_KEY)) || {}) };
  } catch {
    return defaults;
  }
}

export function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(store.prefs));
  } catch {
    /* storage unavailable */
  }
}

export function onChange(fn) {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}

let pendingIds = new Set();
let pendingAll = false;
let scheduled = false;

export function notify(entityId) {
  if (entityId) pendingIds.add(entityId);
  else pendingAll = true;
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const ids = pendingAll ? null : pendingIds;
    pendingIds = new Set();
    pendingAll = false;
    for (const fn of store.listeners) {
      try {
        fn(ids);
      } catch (e) {
        console.error(e);
      }
    }
  });
}

export function areaOf(entityId) {
  const reg = store.entities[entityId];
  if (!reg) return null;
  if (reg.area_id) return reg.area_id;
  if (reg.device_id && store.devices[reg.device_id]) return store.devices[reg.device_id].area_id || null;
  return null;
}

export function isHiddenEntity(entityId) {
  const reg = store.entities[entityId];
  if (!reg) return false;
  return Boolean(reg.hidden_by || reg.disabled_by || reg.entity_category);
}

export function toggleFavorite(entityId) {
  const favs = store.prefs.favorites;
  const i = favs.indexOf(entityId);
  if (i >= 0) favs.splice(i, 1);
  else favs.push(entityId);
  savePrefs();
}
