const API = {
  token: () => localStorage.getItem('token'),
  user: () => JSON.parse(localStorage.getItem('user') || 'null'),
  save(d) { localStorage.setItem('token', d.token); localStorage.setItem('user', JSON.stringify(d.user)); },
  async req(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (API.token()) headers.Authorization = 'Bearer ' + API.token();
    const r = await fetch('/api' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && !path.startsWith('/auth/')) API.logout();
    if (!r.ok) { const e = new Error(d.error || 'Request failed'); e.details = d.details; throw e; }
    return d;
  },
  logout() { localStorage.removeItem('token'); localStorage.removeItem('user'); location.href = '/login.html'; },
  guard(role) {
    const u = API.user();
    if (!API.token() || !u) { location.href = '/login.html'; return null; }
    if (role && u.role !== role) { location.href = u.role === 'admin' ? '/admin/' : '/customer/'; return null; }
    return u;
  }
};
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
