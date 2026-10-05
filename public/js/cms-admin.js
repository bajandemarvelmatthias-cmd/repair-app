const me = API.guard('admin');
const ROLE = me ? (me.admin_role || 'editor') : 'editor';
const view = $('#view');
const A = (p, method, body) => API.req('/admin' + p, { method, body });
const ROLE_LABEL = { super_admin: 'Super Admin', content_admin: 'Content Admin', editor: 'Editor' };
const canDelete = ROLE !== 'editor', isSuper = ROLE === 'super_admin';
const fdate = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const pill = (s) => `<span class="pill ${esc(s)}">${esc(s)}</span>`;
const thumb = (u) => (u ? `<img class="thumb" src="${esc(u)}" alt="" loading="lazy">` : '<span class="thumb"></span>');

function toast(msg, bad) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), 3500);
}
function overlay(html, wide) {
  const o = document.createElement('div'); o.className = 'ov';
  o.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  o.addEventListener('mousedown', (e) => { if (e.target === o) o.remove(); });
  document.body.append(o); return o;
}
function confirmDlg(msg, okText = 'Delete') {
  return new Promise((res) => {
    const o = overlay(`<h2>Are you sure?</h2><p>${esc(msg)}</p><div class="bar"><button class="ghost" data-x>Cancel</button><button class="danger" data-ok>${esc(okText)}</button></div>`);
    o.querySelector('[data-x]').onclick = () => { o.remove(); res(false); };
    o.querySelector('[data-ok]').onclick = () => { o.remove(); res(true); };
  });
}
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };

// ---------- Media picker (reuse existing files or upload new) ----------
function readFile(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
async function uploadFiles(files) {
  const out = [];
  for (const f of files) out.push(await A('/media', 'POST', { name: f.name, data: await readFile(f) }));
  return out;
}
function pickMedia(kind = 'image') {
  return new Promise(async (res) => {
    const o = overlay(`<h2>Choose from media library</h2><div class="tools"><input type="search" placeholder="Search media..." id="mq"><label class="btn sm" style="margin:0">Upload new<input type="file" id="mf" hidden accept="image/*,video/mp4,video/webm" multiple></label></div><div class="mgrid" id="mg"></div><div class="bar"><button class="ghost" data-x>Cancel</button></div>`, true);
    const grid = o.querySelector('#mg');
    const load = guard(async () => {
      const items = (await A('/media?q=' + encodeURIComponent(o.querySelector('#mq').value))).filter((m) => kind === 'any' || m.kind === kind);
      grid.innerHTML = items.length ? items.map((m) => `<div class="mi sel" data-u="${esc(m.url)}">${m.kind === 'video' ? `<video src="${esc(m.url)}" muted></video>` : `<img src="${esc(m.url)}" alt="">`}<div>${esc(m.original_name)}</div></div>`).join('') : '<p class="muted">No media yet. Upload one.</p>';
      grid.querySelectorAll('.sel').forEach((el) => (el.onclick = () => { o.remove(); res(el.dataset.u); }));
    });
    o.querySelector('#mq').oninput = load;
    o.querySelector('[data-x]').onclick = () => { o.remove(); res(null); };
    o.querySelector('#mf').onchange = guard(async (e) => { const r = await uploadFiles(e.target.files); toast('Uploaded'); if (r.length === 1) { o.remove(); res(r[0].url); } else load(); });
    load();
  });
}
function imageField(name, label, value) {
  return `<label>${esc(label)}<div class="imgpick" data-img="${name}"><span data-prev>${thumb(value)}</span><input type="hidden" name="${name}" value="${esc(value || '')}">
    <button type="button" class="ghost sm" data-choose>Choose image</button><button type="button" class="ghost sm" data-clear>Remove</button></div></label>`;
}
function wireImages(root, kind) {
  root.querySelectorAll('[data-img]').forEach((box) => {
    const inp = box.querySelector('input');
    box.querySelector('[data-choose]').onclick = async () => { const u = await pickMedia(kind); if (u) { inp.value = u; box.querySelector('[data-prev]').innerHTML = thumb(u); } };
    box.querySelector('[data-clear]').onclick = () => { inp.value = ''; box.querySelector('[data-prev]').innerHTML = thumb(''); };
  });
}

// ---------- Generic form modal ----------
// fields: {name,label,type: text|textarea|number|select|image|url|password, options:[[v,l]], req, half}
function fieldHtml(f, v) {
  const val = v ?? f.def ?? '';
  const star = f.req ? ' <span class="req">*</span>' : '';
  let ctl;
  if (f.type === 'image') return imageField(f.name, f.label, val);
  if (f.type === 'textarea') ctl = `<textarea name="${f.name}">${esc(val)}</textarea>`;
  else if (f.type === 'select') ctl = `<select name="${f.name}">${f.options.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else ctl = `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(val)}" ${f.type === 'number' ? 'min="0"' : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''} autocomplete="off">`;
  return `<label>${esc(f.label)}${star}${ctl}<span class="err-t" data-err="${f.name}"></span></label>`;
}
function formModal(title, fields, values, onSave, opts = {}) {
  const o = overlay(`<h2>${esc(title)}</h2><form novalidate><div class="g2">${fields.map((f) => (f.type === 'textarea' || f.type === 'image' || f.full ? `</div>${fieldHtml(f, values[f.name])}<div class="g2">` : fieldHtml(f, values[f.name]))).join('')}</div>
    ${opts.extra || ''}<div class="bar"><button type="button" class="ghost" data-x>Cancel</button><button class="btn" type="submit">Save</button></div></form>`, opts.wide);
  const form = o.querySelector('form'); wireImages(form, 'image');
  o.querySelector('[data-x]').onclick = () => o.remove();
  form.onsubmit = async (e) => {
    e.preventDefault();
    form.querySelectorAll('[data-err]').forEach((s) => (s.textContent = ''));
    const data = {}; new FormData(form).forEach((v, k) => (data[k] = v));
    fields.forEach((f) => { if (f.type === 'number') data[f.name] = data[f.name] === '' ? null : Number(data[f.name]); if (f.type === 'select' && data[f.name] === '') data[f.name] = null; });
    for (const f of fields) if (f.req && !String(data[f.name] ?? '').trim()) { form.querySelector(`[data-err="${f.name}"]`).textContent = 'Required.'; return; }
    try { await onSave(data, form); o.remove(); } catch (er) { toast(er.message, true); }
  };
  return o;
}

// ---------- Cached lookups ----------
const L = {};
async function lookups() {
  const [cats, brands, tools, parts] = await Promise.all([A('/categories'), A('/brands'), A('/tools'), A('/parts')]);
  Object.assign(L, { cats, brands, tools, parts });
  return L;
}
const opts = (list, key = 'name', blank) => (blank ? [['', blank]] : []).concat(list.map((x) => [x.id, x[key]]));
const STATUS2 = [['draft', 'Draft'], ['published', 'Published']], STATUS3 = [...STATUS2, ['archived', 'Archived']];

// ---------- Simple managed tables ----------
function table(heads, rows, empty = 'Nothing here yet.') {
  return `<div class="tw"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${heads.length}" class="muted" style="padding:28px;text-align:center">${esc(empty)}</td></tr>`}</tbody></table></div>`;
}
function listPage(cfg) {
  return guard(async () => {
    await lookups();
    const rows = await A('/' + cfg.ep);
    let q = '';
    const draw = () => {
      const shown = rows.filter((r) => !q || JSON.stringify(Object.values(r)).toLowerCase().includes(q));
      view.innerHTML = `<div class="head"><h1>${cfg.title}</h1><button class="btn" id="add">+ Add ${cfg.one}</button></div>
        <div class="tools"><input type="search" id="q" placeholder="Search ${cfg.title.toLowerCase()}..." value="${esc(q)}"></div>
        ${table(cfg.heads, shown.map((r, i) => `<tr data-id="${r.id}">${cfg.row(r)}<td><div class="acts">
          ${cfg.reorder ? `<button class="ghost sm" data-up="${i}" title="Move up" ${q ? 'disabled' : ''}>&uarr;</button><button class="ghost sm" data-dn="${i}" title="Move down" ${q ? 'disabled' : ''}>&darr;</button>` : ''}
          ${r.status ? `<button class="ghost sm" data-tog="${r.id}">${r.status === 'published' ? 'Unpublish' : 'Publish'}</button>` : ''}
          <button class="ghost sm" data-edit="${r.id}">Edit</button>${canDelete ? `<button class="danger sm" data-del="${r.id}">Delete</button>` : ''}</div></td></tr>`).join(''), 'No ' + cfg.title.toLowerCase() + ' yet.')}`;
      $('#q').oninput = (e) => { q = e.target.value.toLowerCase(); draw(); const i = $('#q'); i.focus(); i.setSelectionRange(99, 99); };
      $('#add').onclick = () => edit(null);
      view.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => edit(rows.find((r) => r.id == b.dataset.edit))));
      view.querySelectorAll('[data-tog]').forEach((b) => (b.onclick = guard(async () => { const r = rows.find((x) => x.id == b.dataset.tog); await A(`/${cfg.ep}/${r.id}`, 'PUT', { status: r.status === 'published' ? 'draft' : 'published' }); toast('Status updated'); route(); })));
      view.querySelectorAll('[data-del]').forEach((b) => (b.onclick = guard(async () => { const r = rows.find((x) => x.id == b.dataset.del); if (await confirmDlg(`Delete "${r.name}"? ${cfg.cascade || ''}`)) { await A(`/${cfg.ep}/${r.id}`, 'DELETE'); toast('Deleted'); route(); } })));
      const move = (i, d) => guard(async () => { const ids = rows.map((r) => r.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await A(`/${cfg.ep}/reorder`, 'POST', { ids }); route(); });
      view.querySelectorAll('[data-up]').forEach((b) => (b.onclick = move(+b.dataset.up, -1)));
      view.querySelectorAll('[data-dn]').forEach((b) => (b.onclick = move(+b.dataset.dn, 1)));
    };
    const edit = (r) => formModal(`${r ? 'Edit' : 'Add'} ${cfg.one}`, cfg.fields(), r || cfg.defaults || {}, async (d) => { await A('/' + cfg.ep + (r ? '/' + r.id : ''), r ? 'PUT' : 'POST', d); toast(r ? 'Saved' : `${cfg.one} created`); route(); });
    draw();
    if (location.hash.endsWith('?new')) { history.replaceState(null, '', location.hash.replace('?new', '')); edit(null); }
  });
}

const PAGES = {};
PAGES.categories = listPage({
  title: 'Categories', one: 'Category', ep: 'categories', reorder: true, cascade: 'Its brands, devices and guides will be deleted too.',
  heads: ['', 'Name', 'Slug', 'Status', 'Order', 'Created', ''],
  row: (r) => `<td>${thumb(r.image)}</td><td><b>${esc(r.name)}</b><div class="muted">${esc(r.description || '')}</div></td><td>${esc(r.slug)}</td><td>${pill(r.status)}</td><td>${r.sort_order}</td><td>${fdate(r.created_at)}</td>`,
  defaults: { status: 'draft' },
  fields: () => [{ name: 'name', label: 'Name', req: true }, { name: 'slug', label: 'Slug (auto if empty)' }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'image', label: 'Image / icon', type: 'image' }, { name: 'status', label: 'Status', type: 'select', options: STATUS2 }, { name: 'sort_order', label: 'Display order', type: 'number', def: 0 }]
});
PAGES.brands = listPage({
  title: 'Brands', one: 'Brand', ep: 'brands', cascade: 'Its devices and guides will be deleted too.',
  heads: ['', 'Brand', 'Category', 'Status', 'Order', ''],
  row: (r) => `<td>${thumb(r.logo)}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.category)}</td><td>${pill(r.status)}</td><td>${r.sort_order}</td>`,
  defaults: { status: 'draft' },
  fields: () => [{ name: 'name', label: 'Brand name', req: true }, { name: 'category_id', label: 'Category', type: 'select', options: opts(L.cats) }, { name: 'slug', label: 'Slug (auto if empty)' }, { name: 'sort_order', label: 'Display order', type: 'number', def: 0 }, { name: 'logo', label: 'Logo', type: 'image' }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'status', label: 'Status', type: 'select', options: STATUS2 }]
});
PAGES.tools = listPage({
  title: 'Tools', one: 'Tool', ep: 'tools', heads: ['', 'Tool', 'Brand', 'Used in', 'Status', ''],
  row: (r) => `<td>${thumb(r.image)}</td><td><b>${esc(r.name)}</b><div class="muted">${esc(r.description || '')}</div></td><td>${esc(r.brand || '')}</td><td>${r.guide_count} guide(s)</td><td>${pill(r.status)}</td>`,
  defaults: { status: 'published' },
  fields: () => [{ name: 'name', label: 'Tool name', req: true }, { name: 'brand', label: 'Brand' }, { name: 'link', label: 'Product link (optional)', type: 'url', full: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'image', label: 'Image', type: 'image' }, { name: 'status', label: 'Status', type: 'select', options: STATUS2 }]
});
PAGES.parts = listPage({
  title: 'Parts', one: 'Part', ep: 'parts', heads: ['', 'Part', 'Device', 'Type', 'Status', ''],
  row: (r) => `<td>${thumb(r.image)}</td><td><b>${esc(r.name)}</b><div class="muted">${esc(r.compatibility || '')}</div></td><td>${esc(r.device || '')}</td><td>${esc(r.part_type || '')}</td><td>${pill(r.status)}</td>`,
  defaults: { status: 'published' },
  fields: () => [{ name: 'name', label: 'Part name', req: true }, { name: 'device_id', label: 'Compatible device', type: 'select', options: [['', '— none —']].concat(window.__devOpts || []) }, { name: 'part_type', label: 'Part type (e.g. Battery)' }, { name: 'link', label: 'Purchase link (optional)', type: 'url' }, { name: 'compatibility', label: 'Compatibility notes', full: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'image', label: 'Image', type: 'image' }, { name: 'status', label: 'Status', type: 'select', options: STATUS2 }]
});
const partsPage = PAGES.parts;
PAGES.parts = async () => { window.__devOpts = (await A('/devices')).map((d) => [d.id, `${d.brand} ${d.name}`]); return partsPage(); };

// ---------- Dashboard ----------
PAGES.dashboard = guard(async () => {
  const s = await A('/stats');
  const stat = (n, l) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
  view.innerHTML = `<div class="head"><h1>Dashboard</h1></div>
  <div class="stats">${stat(s.categories, 'Categories')}${stat(s.brands, 'Brands')}${stat(s.devices, 'Devices')}${stat(s.guides, 'Repair guides')}${stat(s.published_guides, 'Published guides')}${stat(s.draft_guides, 'Draft guides')}</div>
  <div class="quick"><a class="btn" href="#categories?new">+ Add Category</a><a class="btn" href="#brands?new">+ Add Brand</a><a class="btn" href="#devices?new">+ Add Device</a><a class="btn" href="#guide/new">+ Create Repair Guide</a></div>
  <div class="card"><h2>Recent activity</h2><ul class="feed">${s.activity.map((a) => `<li>${esc(a.message)} <span class="muted">· ${fdate(a.created_at)}</span></li>`).join('') || '<li class="muted">No activity yet.</li>'}</ul></div>`;
});

// ---------- Devices ----------
const SPEC_FIELDS = ['Screen size', 'Battery capacity', 'Storage options', 'Processor', 'Connectivity', 'Dimensions', 'Weight'];
function deviceForm(d, brands) {
  const specs = d?.specs ? (typeof d.specs === 'string' ? JSON.parse(d.specs || '{}') : d.specs) : {};
  const gal = d?.gallery ? (typeof d.gallery === 'string' ? JSON.parse(d.gallery || '[]') : d.gallery) : [];
  const fields = [{ name: 'name', label: 'Device name', req: true }, { name: 'brand_id', label: 'Brand', type: 'select', options: brands.map((b) => [b.id, `${b.name} (${b.category})`]) },
    { name: 'model_number', label: 'Model number' }, { name: 'release_year', label: 'Release year', type: 'number' },
    { name: 'status', label: 'Status', type: 'select', options: STATUS3 }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'image', label: 'Device image', type: 'image' }];
  const extra = `<h3>Gallery images</h3><div class="imgs" id="gal"></div><button type="button" class="ghost sm" id="galadd">+ Add gallery image</button>
    <h3>Device features (optional)</h3><div class="g2">${SPEC_FIELDS.map((k) => `<label>${k}<input data-spec="${k}" value="${esc(specs[k] || '')}"></label>`).join('')}</div>`;
  const o = formModal(d?.id ? 'Edit device' : 'Add device', fields, d || { status: 'draft' }, async (data, form) => {
    data.gallery = JSON.stringify(gallery); data.specs = JSON.stringify(Object.fromEntries([...form.querySelectorAll('[data-spec]')].filter((i) => i.value.trim()).map((i) => [i.dataset.spec, i.value.trim()])));
    await A('/devices' + (d?.id ? '/' + d.id : ''), d?.id ? 'PUT' : 'POST', data); toast(d?.id ? 'Device saved' : 'Device created'); route();
  }, { wide: true, extra });
  let gallery = [...gal];
  const draw = () => { o.querySelector('#gal').innerHTML = gallery.map((u, i) => `<div class="x">${thumb(u)}<button type="button" data-rm="${i}">×</button></div>`).join(''); o.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { gallery.splice(+b.dataset.rm, 1); draw(); })); };
  o.querySelector('#galadd').onclick = async () => { const u = await pickMedia('image'); if (u) { gallery.push(u); draw(); } };
  draw();
}
PAGES.devices = guard(async () => {
  await lookups();
  const f = { q: '', brand_id: '', category_id: '', status: '', year: '' };
  let page = 1; const PER = 15;
  const load = async () => {
    const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const rows = await A('/devices?' + qs);
    const pages = Math.max(1, Math.ceil(rows.length / PER)); page = Math.min(page, pages);
    $('#dt').innerHTML = table(['', 'Device', 'Brand', 'Category', 'Year', 'Status', 'Guides', ''], rows.slice((page - 1) * PER, page * PER).map((d) => `<tr>
      <td>${thumb(d.image)}</td><td><a href="#device/${d.id}"><b>${esc(d.name)}</b></a><div class="muted">${esc(d.model_number || '')}</div></td><td>${esc(d.brand)}</td><td>${esc(d.category)}</td><td>${d.release_year || ''}</td><td>${pill(d.status)}</td><td>${d.guide_count}</td>
      <td><div class="acts"><a class="ghost sm" href="#device/${d.id}">Open</a><button class="ghost sm" data-ed="${d.id}">Edit</button><a class="ghost sm" href="/guides/#/device/${d.id}" target="_blank" rel="noopener">Preview</a>
      <button class="ghost sm" data-st="${d.id}" data-to="${d.status === 'published' ? 'draft' : 'published'}">${d.status === 'published' ? 'Unpublish' : 'Publish'}</button>
      <button class="ghost sm" data-dup="${d.id}">Duplicate</button>${canDelete ? `<button class="danger sm" data-rm="${d.id}">Delete</button>` : ''}</div></td></tr>`).join(''), 'No devices match.')
      + `<div class="tools" style="margin-top:10px;justify-content:space-between"><span class="muted">${rows.length} device(s)</span><span><button class="ghost sm" id="pv" ${page <= 1 ? 'disabled' : ''}>Previous</button> Page ${page}/${pages} <button class="ghost sm" id="nx" ${page >= pages ? 'disabled' : ''}>Next</button></span></div>`;
    $('#pv').onclick = () => { page--; load(); }; $('#nx').onclick = () => { page++; load(); };
    $('#dt').querySelectorAll('[data-ed]').forEach((b) => (b.onclick = guard(async () => deviceForm(await A('/devices/' + b.dataset.ed), L.brands.map((x) => ({ ...x })))))); 
    $('#dt').querySelectorAll('[data-st]').forEach((b) => (b.onclick = guard(async () => { await A(`/devices/${b.dataset.st}/status`, 'POST', { status: b.dataset.to }); toast('Status updated'); load(); })));
    $('#dt').querySelectorAll('[data-dup]').forEach((b) => (b.onclick = guard(async () => { await A(`/devices/${b.dataset.dup}/duplicate`, 'POST'); toast('Duplicated as draft'); load(); })));
    $('#dt').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = guard(async () => { if (await confirmDlg('Delete this device and all of its repair guides?')) { await A('/devices/' + b.dataset.rm, 'DELETE'); toast('Deleted'); load(); } })));
  };
  const years = [...new Set((await A('/devices')).map((d) => d.release_year).filter(Boolean))].sort((a, b) => b - a);
  view.innerHTML = `<div class="head"><h1>Devices</h1><button class="btn" id="add">+ Add Device</button></div>
   <div class="tools"><input type="search" id="fq" placeholder="Search devices…" aria-label="Search devices">
    <select id="fb"><option value="">All brands</option>${L.brands.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
    <select id="fc"><option value="">All categories</option>${L.cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
    <select id="fs"><option value="">All statuses</option><option>draft</option><option>published</option><option>archived</option></select>
    <select id="fy"><option value="">All years</option>${years.map((y) => `<option>${y}</option>`).join('')}</select></div><div id="dt"></div>`;
  let tm; $('#fq').oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { f.q = e.target.value; page = 1; load(); }, 250); };
  [['#fb', 'brand_id'], ['#fc', 'category_id'], ['#fs', 'status'], ['#fy', 'year']].forEach(([s, k]) => ($(s).onchange = (e) => { f[k] = e.target.value; page = 1; load(); }));
  $('#add').onclick = () => deviceForm(null, L.brands);
  await load();
  if (location.hash.endsWith('?new')) { history.replaceState(null, '', location.hash.replace('?new', '')); deviceForm(null, L.brands); }
});

// ---------- Device detail ----------
PAGES.device = guard(async (id) => {
  await lookups();
  const d = await A('/devices/' + id);
  view.innerHTML = `<div class="crumbs muted"><a href="#devices">Devices</a> / ${esc(d.brand.name)} / ${esc(d.name)}</div>
  <div class="head"><h1>${esc(d.brand.name)} → ${esc(d.name)}</h1><button class="ghost" id="ed">Edit device</button><a class="ghost" href="/guides/#/device/${d.id}" target="_blank" rel="noopener">Preview</a><button class="btn" id="pb">${d.status === 'published' ? 'Unpublish' : 'Publish'}</button></div>
  <div class="card" style="display:flex;gap:16px;flex-wrap:wrap">${d.image ? `<img src="${esc(d.image)}" alt="" style="width:140px;height:140px;object-fit:contain;border-radius:12px;background:var(--soft)">` : ''}
    <div style="flex:1;min-width:220px">${pill(d.status)} <span class="muted">${esc(d.model_number || '')} ${d.release_year ? '· ' + d.release_year : ''}</span><p>${esc(d.description || '')}</p>
    <div class="muted">${Object.entries(d.specs).map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join(' · ')}</div></div></div>
  <div class="head"><h2 style="margin:0;flex:1">Repair guides</h2><a class="btn" href="#guide/new?device=${d.id}">+ Add Repair Guide</a></div>
  ${table(['Guide', 'Difficulty', 'Time', 'Status', ''], d.guides.map((g, i) => `<tr><td><b>${esc(g.title)}</b></td><td>${pill(g.difficulty)}</td><td>${g.estimated_minutes ? g.estimated_minutes + ' min' : ''}</td><td>${pill(g.status)}</td>
    <td><div class="acts"><button class="ghost sm" data-up="${i}">↑</button><button class="ghost sm" data-dn="${i}">↓</button><button class="ghost sm" data-gs="${g.id}" data-to="${g.status === 'published' ? 'draft' : 'published'}">${g.status === 'published' ? 'Unpublish' : 'Publish'}</button><a class="ghost sm" href="#guide/${g.id}">Edit</a>${canDelete ? `<button class="danger sm" data-gd="${g.id}">Delete</button>` : ''}</div></td></tr>`).join(''), 'No guides yet for this device.')}
  <div class="two" style="margin-top:18px"><div><h2>Tools needed</h2><div class="card">${d.tools.map((t) => `<div>${esc(t.name)}</div>`).join('') || '<span class="muted">Attach tools to this device’s guides to see them here.</span>'}</div></div>
  <div><h2>Parts</h2><div class="card">${d.parts.map((p) => `<div>${esc(p.name)} <span class="muted">${esc(p.part_type || '')}</span></div>`).join('') || '<span class="muted">No parts yet. Add them under Parts.</span>'}</div></div></div>`;
  $('#ed').onclick = () => deviceForm(d, L.brands);
  $('#pb').onclick = guard(async () => { await A(`/devices/${d.id}/status`, 'POST', { status: d.status === 'published' ? 'draft' : 'published' }); toast('Status updated'); route(); });
  view.querySelectorAll('[data-gs]').forEach((b) => (b.onclick = guard(async () => { await A(`/guides/${b.dataset.gs}/status`, 'POST', { status: b.dataset.to }); toast('Guide updated'); route(); })));
  view.querySelectorAll('[data-gd]').forEach((b) => (b.onclick = guard(async () => { if (await confirmDlg('Delete this guide and its steps?')) { await A('/guides/' + b.dataset.gd, 'DELETE'); toast('Deleted'); route(); } })));
  const mv = (i, dd) => guard(async () => { const ids = d.guides.map((g) => g.id), j = i + dd; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await A('/guides/reorder', 'POST', { ids }); route(); });
  view.querySelectorAll('[data-up]').forEach((b) => (b.onclick = mv(+b.dataset.up, -1))); view.querySelectorAll('[data-dn]').forEach((b) => (b.onclick = mv(+b.dataset.dn, 1)));
});

// ---------- Repair guides list ----------
PAGES.guides = guard(async () => {
  const rows = await A('/guides');
  view.innerHTML = `<div class="head"><h1>Repair Guides</h1><a class="btn" href="#guide/new">+ Create Repair Guide</a></div>
  ${table(['Guide', 'Device', 'Difficulty', 'Steps', 'Status', ''], rows.map((g) => `<tr><td><b>${esc(g.title)}</b></td><td><a href="#device/${g.device_id}">${esc(g.device)}</a></td><td>${pill(g.difficulty)}</td><td>${g.step_count}</td><td>${pill(g.status)}</td>
   <td><div class="acts"><a class="ghost sm" href="#guide/${g.id}">Edit</a><button class="ghost sm" data-gs="${g.id}" data-to="${g.status === 'published' ? 'draft' : 'published'}">${g.status === 'published' ? 'Unpublish' : 'Publish'}</button>${canDelete ? `<button class="danger sm" data-gd="${g.id}">Delete</button>` : ''}</div></td></tr>`).join(''), 'No repair guides yet.')}`;
  view.querySelectorAll('[data-gs]').forEach((b) => (b.onclick = guard(async () => { await A(`/guides/${b.dataset.gs}/status`, 'POST', { status: b.dataset.to }); toast('Guide updated'); route(); })));
  view.querySelectorAll('[data-gd]').forEach((b) => (b.onclick = guard(async () => { if (await confirmDlg('Delete this guide and its steps?')) { await A('/guides/' + b.dataset.gd, 'DELETE'); toast('Deleted'); route(); } })));
});

// ---------- Guide builder ----------
PAGES.guide = guard(async (id, query) => {
  await lookups();
  const devs = await A('/devices');
  const isNew = id === 'new';
  const g = isNew ? { device_id: +new URLSearchParams(query).get('device') || (devs[0] && devs[0].id), difficulty: 'easy', status: 'draft', steps: [], tool_ids: [], part_ids: [] } : await A('/guides/' + id);
  if (!devs.length) { view.innerHTML = '<div class="empty">Add a device first, then create its repair guide.</div>'; return; }
  const steps = g.steps.map((s) => ({ ...s, images: [...s.images] }));
  const toolIds = new Set(g.tool_ids), partIds = new Set(g.part_ids);
  view.innerHTML = `<div class="crumbs muted"><a href="#guides">Repair Guides</a> / ${isNew ? 'New' : esc(g.title)}</div><div class="head"><h1>${isNew ? 'Create Repair Guide' : 'Edit Repair Guide'}</h1><button class="btn" id="save">Save guide</button></div>
  <div class="card"><h2>Guide information</h2><div class="g2">
   <label>Guide title <span class="req">*</span><input id="g_title" value="${esc(g.title || '')}" placeholder="Battery Replacement"></label>
   <label>Device<select id="g_dev">${devs.map((d) => `<option value="${d.id}" ${d.id == g.device_id ? 'selected' : ''}>${esc(d.brand + ' ' + d.name)}</option>`).join('')}</select></label>
   <label>Repair category<input id="g_rc" value="${esc(g.repair_category || '')}" placeholder="Battery, Screen, Camera…"></label>
   <label>Difficulty<select id="g_diff">${[['easy', 'Easy'], ['moderate', 'Moderate'], ['difficult', 'Difficult']].map(([v, l]) => `<option value="${v}" ${v === g.difficulty ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
   <label>Estimated time (minutes)<input id="g_min" type="number" min="0" value="${g.estimated_minutes ?? ''}"></label>
   <label>Status<select id="g_status">${STATUS2.map(([v, l]) => `<option value="${v}" ${v === g.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
   <label>Short description<textarea id="g_desc">${esc(g.short_description || '')}</textarea></label>${imageField('cover', 'Cover image', g.cover_image)}</div>
  <div class="card"><h2>Tools &amp; parts for this guide</h2><div class="muted">Tools</div><div class="chips" id="gt">${L.tools.map((t) => `<span class="chip ${toolIds.has(t.id) ? 'on' : ''}" data-t="${t.id}">${esc(t.name)}</span>`).join('') || '<span class="muted">No tools yet. Add some under Tools.</span>'}</div>
   <div class="muted" style="margin-top:10px">Parts</div><div class="chips" id="gp">${L.parts.map((p) => `<span class="chip ${partIds.has(p.id) ? 'on' : ''}" data-p="${p.id}">${esc(p.name)}</span>`).join('') || '<span class="muted">No parts yet. Add some under Parts.</span>'}</div></div>
  <div class="head"><h2 style="margin:0;flex:1">Steps</h2><button class="btn" id="addstep">+ Add Step</button></div><div id="steps"></div>`;
  wireImages(view, 'image');
  const toggle = (sel, attr, set) => view.querySelectorAll(sel).forEach((c) => (c.onclick = () => { const v = +c.dataset[attr]; set.has(v) ? set.delete(v) : set.add(v); c.classList.toggle('on'); }));
  toggle('#gt .chip', 't', toolIds); toggle('#gp .chip', 'p', partIds);

  const wrap = $('#steps'); let dragFrom = null;
  const sync = () => wrap.querySelectorAll('.step').forEach((el, i) => { const s = steps[i]; el.querySelectorAll('[data-f]').forEach((inp) => (s[inp.dataset.f] = inp.value)); });
  const draw = () => {
    wrap.innerHTML = steps.map((s, i) => `<div class="step" draggable="false" data-i="${i}">
      <div class="sh"><span class="grip" title="Drag to reorder" aria-label="Drag to reorder">⠿</span><span class="n">${i + 1}</span><b style="flex:1">Step ${i + 1}</b><button class="danger sm" data-rm="${i}">Remove</button></div>
      <label>Step title <span class="req">*</span><input data-f="title" value="${esc(s.title || '')}" placeholder="Remove the bottom screws"></label>
      <label>Instructions<textarea data-f="instructions">${esc(s.instructions || '')}</textarea></label>
      <div class="imgs">${s.images.map((u, k) => `<div class="x">${thumb(u)}<button type="button" data-ri="${i}:${k}">×</button></div>`).join('')}</div><button class="ghost sm" data-ai="${i}">+ Add image</button>
      <div class="g2" style="margin-top:10px"><label>Video (optional)<input data-f="video" value="${esc(s.video || '')}" placeholder="/uploads/…mp4"><button type="button" class="ghost sm" data-av="${i}" style="margin-top:4px">Choose video</button></label><span></span>
      <label>⚠ Warning<textarea data-f="warning">${esc(s.warning || '')}</textarea></label><label>💡 Tip<textarea data-f="tip">${esc(s.tip || '')}</textarea></label></div>
      <div class="muted">Tools for this step</div><div class="chips">${L.tools.map((t) => `<span class="chip ${(s.tool_ids || []).includes(t.id) ? 'on' : ''}" data-st="${i}:${t.id}">${esc(t.name)}</span>`).join('') || '—'}</div>
      <div class="muted" style="margin-top:8px">Parts for this step</div><div class="chips">${L.parts.map((p) => `<span class="chip ${(s.part_ids || []).includes(p.id) ? 'on' : ''}" data-sp="${i}:${p.id}">${esc(p.name)}</span>`).join('') || '—'}</div></div>`).join('') || '<div class="empty">No steps yet. Click “+ Add Step”.</div>';
    wrap.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { sync(); steps.splice(+b.dataset.rm, 1); draw(); }));
    wrap.querySelectorAll('[data-ai]').forEach((b) => (b.onclick = async () => { sync(); const u = await pickMedia('image'); if (u) { steps[+b.dataset.ai].images.push(u); draw(); } }));
    wrap.querySelectorAll('[data-av]').forEach((b) => (b.onclick = async () => { sync(); const u = await pickMedia('video'); if (u) { steps[+b.dataset.av].video = u; draw(); } }));
    wrap.querySelectorAll('[data-ri]').forEach((b) => (b.onclick = () => { sync(); const [i, k] = b.dataset.ri.split(':').map(Number); steps[i].images.splice(k, 1); draw(); }));
    const chip = (attr, key) => wrap.querySelectorAll(`[data-${attr}]`).forEach((c) => (c.onclick = () => { sync(); const [i, v] = c.dataset[attr].split(':').map(Number); const a = (steps[i][key] = steps[i][key] || []); const j = a.indexOf(v); j < 0 ? a.push(v) : a.splice(j, 1); c.classList.toggle('on'); }));
    chip('st', 'tool_ids'); chip('sp', 'part_ids');
    // drag-and-drop reordering (drag by the handle)
    wrap.querySelectorAll('.step').forEach((el) => {
      el.querySelector('.grip').onmousedown = () => (el.draggable = true); el.querySelector('.grip').ontouchstart = () => {};
      el.ondragstart = (e) => { sync(); dragFrom = +el.dataset.i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFrom)); };
      el.ondragend = () => { el.draggable = false; wrap.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); };
      el.ondragover = (e) => { e.preventDefault(); el.classList.add('over'); }; el.ondragleave = () => el.classList.remove('over');
      el.ondrop = (e) => { e.preventDefault(); const to = +el.dataset.i; if (dragFrom === null || dragFrom === to) return; const [m] = steps.splice(dragFrom, 1); steps.splice(to, 0, m); dragFrom = null; draw(); };
    });
    // mobile/keyboard fallback: move buttons
    wrap.querySelectorAll('.step .sh').forEach((h, i) => { const b = document.createElement('span'); b.innerHTML = `<button class="ghost sm" data-m="${i}:-1" aria-label="Move up">↑</button> <button class="ghost sm" data-m="${i}:1" aria-label="Move down">↓</button>`; h.insertBefore(b, h.querySelector('[data-rm]')); });
    wrap.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { sync(); const [i, d] = b.dataset.m.split(':').map(Number); const j = i + d; if (j < 0 || j >= steps.length) return; [steps[i], steps[j]] = [steps[j], steps[i]]; draw(); }));
  };
  $('#addstep').onclick = () => { sync(); steps.push({ title: '', instructions: '', images: [], tool_ids: [], part_ids: [] }); draw(); wrap.lastElementChild.querySelector('input').focus(); };
  draw();
  $('#save').onclick = guard(async () => {
    sync();
    if (!$('#g_title').value.trim()) { toast('Guide title is required.', true); return; }
    const bad = steps.findIndex((s) => !String(s.title || '').trim()); if (bad >= 0) { toast(`Step ${bad + 1} needs a title.`, true); return; }
    const body = { title: $('#g_title').value, device_id: +$('#g_dev').value, repair_category: $('#g_rc').value, short_description: $('#g_desc').value, difficulty: $('#g_diff').value,
      estimated_minutes: $('#g_min').value === '' ? null : +$('#g_min').value, status: $('#g_status').value, cover_image: view.querySelector('[name=cover]').value,
      tool_ids: [...toolIds], part_ids: [...partIds], steps: steps.map((s) => ({ title: s.title, instructions: s.instructions, images: s.images, video: s.video || null, warning: s.warning || null, tip: s.tip || null, tool_ids: s.tool_ids || [], part_ids: s.part_ids || [] })) };
    const r = await A('/guides' + (isNew ? '' : '/' + id), isNew ? 'POST' : 'PUT', body);
    toast('Guide saved'); if (isNew) location.hash = '#guide/' + r.id;
  });
});

// ---------- Media library ----------
PAGES.media = guard(async () => {
  let q = '';
  view.innerHTML = `<div class="head"><h1>Media Library</h1><label class="btn" style="margin:0">+ Upload<input type="file" id="mf" hidden multiple accept="image/*,video/mp4,video/webm"></label></div>
    <div class="tools"><input type="search" id="mq" placeholder="Search media…"></div><div class="mgrid" id="mg"></div>`;
  const load = guard(async () => {
    const items = await A('/media?q=' + encodeURIComponent(q));
    $('#mg').innerHTML = items.map((m) => `<div class="mi">${m.kind === 'video' ? `<video src="${esc(m.url)}" controls preload="metadata"></video>` : `<img src="${esc(m.url)}" alt="" loading="lazy">`}<div>${esc(m.original_name)}<div class="acts" style="justify-content:flex-start;margin-top:6px"><button class="ghost sm" data-cp="${esc(m.url)}">Copy URL</button><a class="ghost sm" href="${esc(m.url)}" target="_blank" rel="noopener">Preview</a>${canDelete ? `<button class="danger sm" data-md="${m.id}">Delete</button>` : ''}</div></div></div>`).join('') || '<p class="muted">No media found.</p>';
    view.querySelectorAll('[data-cp]').forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(location.origin + b.dataset.cp); toast('URL copied'); } catch { toast(location.origin + b.dataset.cp); } }));
    view.querySelectorAll('[data-md]').forEach((b) => (b.onclick = guard(async () => { if (await confirmDlg('Delete this file? Pages using it will show a broken image.')) { await A('/media/' + b.dataset.md, 'DELETE'); toast('Deleted'); load(); } })));
  });
  $('#mq').oninput = (e) => { q = e.target.value; load(); };
  $('#mf').onchange = guard(async (e) => { await uploadFiles(e.target.files); toast('Uploaded'); load(); });
  load();
});

// ---------- Admins & settings ----------
PAGES.admins = guard(async () => {
  if (!isSuper) { view.innerHTML = '<div class="empty">Only a Super Admin can manage administrators.</div>'; return; }
  const rows = await A('/admins');
  view.innerHTML = `<div class="head"><h1>Users / Admins</h1><button class="btn" id="add">+ Add Admin</button></div>
  ${table(['Name', 'Email', 'Role', 'Status', ''], rows.map((u) => `<tr><td><b>${esc(u.full_name)}</b></td><td>${esc(u.email)}</td><td>${u.id === me.id ? esc(ROLE_LABEL[u.admin_role]) : `<select data-role="${u.id}" style="margin:0;width:auto">${Object.entries(ROLE_LABEL).map(([k, l]) => `<option value="${k}" ${k === u.admin_role ? 'selected' : ''}>${l}</option>`).join('')}</select>`}</td><td><span class="pill ${u.status === 'active' ? '' : 'draft'}">${esc(u.status)}</span></td>
   <td><div class="acts">${u.id === me.id ? '<span class="muted">You</span>' : `<button class="ghost sm" data-ds="${u.id}" data-to="${u.status === 'active' ? 'disabled' : 'active'}">${u.status === 'active' ? 'Disable' : 'Enable'}</button><button class="danger sm" data-del="${u.id}">Delete</button>`}</div></td></tr>`).join(''))}
  <p class="muted" style="margin-top:12px"><b>Super Admin</b> manages everything. <b>Content Admin</b> manages all content. <b>Editor</b> can create and edit content but cannot delete it, manage admins or change settings.</p>`;
  $('#add').onclick = () => formModal('Add admin', [{ name: 'full_name', label: 'Full name', req: true }, { name: 'email', label: 'Email', type: 'email', req: true }, { name: 'password', label: 'Password (min 8)', type: 'password', req: true }, { name: 'admin_role', label: 'Role', type: 'select', options: Object.entries(ROLE_LABEL), def: 'editor' }], {}, async (d) => { await A('/admins', 'POST', d); toast('Admin added'); route(); });
  view.querySelectorAll('[data-role]').forEach((s) => (s.onchange = guard(async () => { await A('/admins/' + s.dataset.role, 'PUT', { admin_role: s.value }); toast('Role updated'); })));
  view.querySelectorAll('[data-ds]').forEach((b) => (b.onclick = guard(async () => { await A('/admins/' + b.dataset.ds, 'PUT', { status: b.dataset.to }); route(); })));
  view.querySelectorAll('[data-del]').forEach((b) => (b.onclick = guard(async () => { if (await confirmDlg('Delete this administrator account?')) { await A('/admins/' + b.dataset.del, 'DELETE'); route(); } })));
});
PAGES.settings = guard(async () => {
  if (!isSuper) { view.innerHTML = '<div class="empty">Only a Super Admin can change settings.</div>'; return; }
  const s = await A('/settings');
  view.innerHTML = `<div class="head"><h1>Settings</h1></div><div class="card" style="max-width:560px"><label>Site name<input id="s1" value="${esc(s.site_name || 'LunasTech')}"></label><label>Tagline<input id="s2" value="${esc(s.tagline || '')}"></label><label>Support email<input id="s3" type="email" value="${esc(s.support_email || '')}"></label><button class="btn" id="sv">Save settings</button></div>`;
  $('#sv').onclick = guard(async () => { await A('/settings', 'PUT', { site_name: $('#s1').value, tagline: $('#s2').value, support_email: $('#s3').value }); toast('Settings saved'); });
});

// ---------- Router / nav ----------
const NAV = [['dashboard', 'Dashboard'], ['categories', 'Categories'], ['brands', 'Brands'], ['devices', 'Devices'], ['guides', 'Repair Guides'], ['tools', 'Tools'], ['parts', 'Parts'], ['media', 'Media'], ['admins', 'Users/Admins'], ['settings', 'Settings']];
$('#nav').innerHTML = NAV.filter(([k]) => isSuper || !['admins', 'settings'].includes(k)).map(([k, l]) => `<a href="#${k}" data-k="${k}">${l}</a>`).join('');
$('#who').textContent = `${me.full_name} · ${ROLE_LABEL[ROLE]}`;
$('#menu').onclick = () => $('#side').classList.toggle('open');
async function route() {
  const [path, query = ''] = (location.hash.slice(1) || 'dashboard').split('?');
  const [k, id] = path.split('/');
  $('#side').classList.remove('open');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.k === (k === 'device' ? 'devices' : k === 'guide' ? 'guides' : k)));
  view.innerHTML = '<p class="muted">Loading…</p>';
  const fn = PAGES[k] || PAGES.dashboard;
  await fn(id, query);
}
window.addEventListener('hashchange', route);
route();
