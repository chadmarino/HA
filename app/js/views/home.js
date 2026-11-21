// Home view: favorites + entities grouped by area, with search and domain filter.

import { h, clear, debounce } from '../dom.js';
import { store, onChange, areaOf, isHiddenEntity, savePrefs } from '../store.js';
import { createCard, HOME_DOMAINS, domainOf, nameOf } from '../cards.js';
import { showDetails } from './details.js';

const DOMAIN_LABELS = {
  light: 'Lights', switch: 'Switches', fan: 'Fans', cover: 'Covers', climate: 'Climate', lock: 'Locks',
  media_player: 'Media', scene: 'Scenes', script: 'Scripts', sensor: 'Sensors', binary_sensor: 'Binary sensors',
  vacuum: 'Vacuums', person: 'People', camera: 'Cameras',
};

export function homeView(root) {
  let query = '';
  let domainFilter = store.prefs.homeDomain || '';
  const cards = new Map(); // entity_id -> card (may appear in favorites AND area: keep list)

  const search = h('input', {
    type: 'search',
    placeholder: 'Search devices…',
    'aria-label': 'Search devices',
    value: query,
    oninput: debounce((e) => {
      query = e.target.value.toLowerCase();
      render();
    }, 120),
  });
  const domainSel = h('select', {
    'aria-label': 'Filter by type',
    onchange: (e) => {
      domainFilter = e.target.value;
      store.prefs.homeDomain = domainFilter;
      savePrefs();
      render();
    },
  });
  const body = h('div', { class: 'home-body' });
  root.append(h('div', { class: 'toolbar' }, search, domainSel), body);

  function visibleEntities() {
    return Object.values(store.states).filter((s) => {
      const d = domainOf(s.entity_id);
      if (!HOME_DOMAINS.has(d)) return false;
      if (domainFilter && d !== domainFilter) return false;
      if (!store.prefs.showHidden && isHiddenEntity(s.entity_id)) return false;
      if (query && !(nameOf(s).toLowerCase().includes(query) || s.entity_id.includes(query))) return false;
      return true;
    });
  }

  function fillDomainSelect() {
    const domains = [...new Set(Object.keys(store.states).map(domainOf))].filter((d) => HOME_DOMAINS.has(d)).sort();
    const key = domains.join(',');
    if (domainSel.dataset.key === key) return;
    domainSel.dataset.key = key;
    domainSel.replaceChildren(
      h('option', { value: '' }, 'All types'),
      ...domains.map((d) => h('option', { value: d }, DOMAIN_LABELS[d] || d.replace(/_/g, ' '))),
    );
    domainSel.value = domains.includes(domainFilter) ? domainFilter : '';
  }

  function addCard(container, st) {
    const card = createCard(st, { onDetails: showDetails });
    if (!cards.has(st.entity_id)) cards.set(st.entity_id, []);
    cards.get(st.entity_id).push(card);
    container.append(card.el);
  }

  function section(title, list, extraClass = '') {
    if (!list.length) return null;
    const grid = h('div', { class: 'grid' });
    list.sort((a, b) => nameOf(a).localeCompare(nameOf(b))).forEach((s) => addCard(grid, s));
    return h('section', { class: `area ${extraClass}` }, h('h2', null, title, h('span', { class: 'count' }, list.length)), grid);
  }

  function render() {
    fillDomainSelect();
    cards.clear();
    clear(body);
    const list = visibleEntities();
    if (!list.length) {
      body.append(h('p', { class: 'empty' }, query || domainFilter ? 'No matching devices.' : 'No devices found.'));
      return;
    }
    const favs = store.prefs.favorites.map((id) => store.states[id]).filter((s) => s && list.includes(s));
    const favSection = section('★ Favorites', favs, 'favorites');
    if (favSection) body.append(favSection);

    const byArea = new Map();
    for (const s of list) {
      const a = areaOf(s.entity_id) || '';
      if (!byArea.has(a)) byArea.set(a, []);
      byArea.get(a).push(s);
    }
    const areaName = (a) => (a ? store.areas[a]?.name || a : 'Other');
    const order = [...byArea.keys()].sort((x, y) => (!x ? 1 : !y ? -1 : areaName(x).localeCompare(areaName(y))));
    for (const a of order) body.append(section(areaName(a), byArea.get(a)) || '');
  }

  render();
  let knownIds = Object.keys(store.states).length;
  const off = onChange((ids) => {
    const count = Object.keys(store.states).length;
    if (ids === null || count !== knownIds) {
      knownIds = count;
      render();
      return;
    }
    for (const id of ids) for (const c of cards.get(id) || []) c.update(store.states[id]);
  });
  return () => off();
}
