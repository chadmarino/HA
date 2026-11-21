// Tiny DOM helpers.

/**
 * h('div', {class: 'x', onclick: fn}, child1, 'text', [more])
 * Props starting with "on" become event listeners; others become attributes
 * (or properties for value/checked/disabled/etc).
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (['value', 'checked', 'disabled', 'selected', 'min', 'max', 'step'].includes(k)) el[k] = v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

let toastTimer;
export function toast(message, kind = 'info') {
  let box = document.getElementById('toast');
  if (!box) {
    box = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  box.textContent = message;
  box.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.className = ''), kind === 'error' ? 6000 : 2500);
}

/** Wrap an async action: show errors as toasts. */
export async function attempt(fn, okMessage) {
  try {
    const r = await fn();
    if (okMessage) toast(okMessage, 'ok');
    return r;
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), 'error');
    return undefined;
  }
}

export function relativeTime(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 0) return 'just now';
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Modal dialog. Returns {close}. content is a Node. */
export function modal(title, content, actions = []) {
  const dlg = h('dialog', { class: 'modal' });
  const close = () => {
    dlg.close();
    dlg.remove();
  };
  dlg.append(
    h('header', null, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div', { class: 'modal-body' }, content),
    actions.length ? h('footer', null, actions) : null,
  );
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  document.body.append(dlg);
  dlg.showModal();
  return { close, el: dlg };
}
