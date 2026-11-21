// Entity details dialog: live state, attributes, 24h history, quick actions.

import { h, modal, relativeTime, toast } from '../dom.js';
import { store, onChange, areaOf } from '../store.js';
import { createCard, nameOf, domainOf } from '../cards.js';

export function showDetails(entityId) {
  const st = store.states[entityId];
  if (!st) return;
  const card = createCard(st);
  const attrs = h('table', { class: 'attrs' });
  const meta = h('p', { class: 'muted' });
  const history = h('div', { class: 'history' }, h('p', { class: 'muted' }, 'Loading history…'));

  function renderAttrs(s) {
    attrs.replaceChildren(
      ...Object.entries(s.attributes).map(([k, v]) =>
        h('tr', null, h('th', null, k.replace(/_/g, ' ')), h('td', null, typeof v === 'object' ? JSON.stringify(v) : String(v))),
      ),
    );
    const area = areaOf(entityId);
    meta.textContent = `${entityId}${area ? ' · ' + (store.areas[area]?.name || area) : ''} · changed ${relativeTime(s.last_changed)}`;
  }
  renderAttrs(st);

  const content = h('div', { class: 'details' }, card.el, meta, h('h3', null, 'Last 24 hours'), history, h('h3', null, 'Attributes'), attrs);
  const dlg = modal(nameOf(st), content, [
    h('button', { class: 'btn', onclick: () => navigator.clipboard?.writeText(entityId).then(() => toast('Copied entity ID', 'ok'), () => toast(entityId)) }, 'Copy ID'),
  ]);

  const off = onChange((ids) => {
    if (!dlg.el.isConnected) return off();
    if (ids === null || ids.has(entityId)) {
      const s = store.states[entityId];
      if (s) {
        card.update(s);
        renderAttrs(s);
      }
    }
  });
  dlg.el.addEventListener('close', off);

  loadHistory(entityId, history);
}

async function loadHistory(entityId, el) {
  try {
    const start = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const res = await store.conn.send({
      type: 'history/history_during_period',
      start_time: start,
      entity_ids: [entityId],
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    });
    const points = (res?.[entityId] || []).map((p) => ({ s: p.s, t: (p.lu || p.lc) * 1000 }));
    if (!points.length) {
      el.replaceChildren(h('p', { class: 'muted' }, 'No history.'));
      return;
    }
    const numeric = points.filter((p) => p.s !== '' && !Number.isNaN(Number(p.s)));
    if (domainOf(entityId) === 'sensor' && numeric.length >= 2) el.replaceChildren(sparkline(numeric));
    else
      el.replaceChildren(
        h(
          'ul',
          { class: 'timeline' },
          points
            .slice(-12)
            .reverse()
            .map((p) => h('li', null, h('strong', null, p.s), ' ', h('span', { class: 'muted' }, new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })))),
        ),
      );
  } catch (e) {
    el.replaceChildren(h('p', { class: 'muted' }, `History unavailable (${e.message}).`));
  }
}

function sparkline(points) {
  const W = 320;
  const H = 80;
  const vals = points.map((p) => Number(p.s));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t || t0 + 1;
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v) => H - 4 - ((v - min) / Math.max(1e-9, max - min)) * (H - 8);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(Number(p.s)).toFixed(1)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Range ${min} to ${max}`);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return h('div', null, svg, h('p', { class: 'muted spark-legend' }, `min ${min} · max ${max} · now ${vals[vals.length - 1]}`));
}
