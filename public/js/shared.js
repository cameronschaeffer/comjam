/* Shared helpers: client identity, toasts, tiny DOM utils */

const ComJam = {
  clientId() {
    let id = localStorage.getItem('comjam:clientId');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('comjam:clientId', id);
    }
    return id;
  },

  displayName(value) {
    if (value !== undefined) localStorage.setItem('comjam:name', value);
    return localStorage.getItem('comjam:name') || '';
  },

  adminKey(code, value) {
    const k = `comjam:admin:${code}`;
    if (value !== undefined) {
      if (value) localStorage.setItem(k, value);
      else localStorage.removeItem(k);
    }
    return localStorage.getItem(k) || '';
  },

  toast(msg, type = 'info') {
    const root = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    root.appendChild(el);
    while (root.children.length > 3) root.firstChild.remove();
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 320);
    }, 3200);
  },

  el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) {
      if (child == null) continue;
      node.append(child);
    }
    return node;
  },

  escapeAttrSafeText(s) {
    return String(s);
  }
};
