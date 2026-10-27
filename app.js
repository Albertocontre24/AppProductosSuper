'use strict';
const $ = id => document.getElementById(id);
const DEFAULT_STORES = ['Lidl', 'Mercadona', 'Carrefour', 'Dia', 'Aldi', 'Alcampo'];
let items = [], filter = 'Todos', editing = null, photoData = null;

// --- IndexedDB ---
const dbp = new Promise((res, rej) => {
  const r = indexedDB.open('super', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('p', { keyPath: 'id' });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function tx(mode, fn) {
  const db = await dbp;
  return new Promise((res, rej) => {
    const t = db.transaction('p', mode), req = fn(t.objectStore('p'));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
const loadAll = () => tx('readonly', s => s.getAll());
const save = o => tx('readwrite', s => s.put(o));
const remove = id => tx('readwrite', s => s.delete(id));

// --- helpers ---
const eur = n => (n || n === 0) && n !== '' ? Number(n).toFixed(2).replace('.', ',') + ' €' : '';
const stores = () => [...new Set([...DEFAULT_STORES, ...items.map(i => i.store)])];

function resize(file, max = 900) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = rej;
    img.src = url;
  });
}

// --- render ---
function render() {
  const used = [...new Set(items.map(i => i.store))].sort();
  if (filter !== 'Todos' && !used.includes(filter)) filter = 'Todos';
  $('chips').innerHTML = ['Todos', ...used].map(s =>
    `<button class="chip ${s === filter ? 'on' : ''}" data-s="${esc(s)}">${esc(s)}</button>`).join('');
  const list = items.filter(i => filter === 'Todos' || i.store === filter)
    .sort((a, b) => b.created - a.created);
  $('grid').innerHTML = list.map(i => `
    <button class="card" data-id="${i.id}">
      <img src="${i.photo || ''}" alt="" loading="lazy">
      <div class="t"><b>${esc(i.name || i.brand || 'Producto')}</b>
      <span>${esc(i.brand && i.name ? i.brand + ' · ' : '')}${eur(i.price)}</span></div>
    </button>`).join('');
  $('empty').hidden = list.length > 0;
  $('empty').textContent = items.length ? 'Nada aquí todavía.' : 'Aún no hay productos. Pulsa ＋ y hazle una foto al primero.';
  $('stores').innerHTML = stores().map(s => `<option value="${esc(s)}">`).join('');
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// --- detail ---
function openDetail(id) {
  const i = items.find(x => x.id === id); if (!i) return;
  editing = i;
  $('d-img').src = i.photo || '';
  $('d-name').textContent = i.name || i.brand || 'Producto';
  $('d-meta').textContent = [i.store, i.name ? i.brand : ''].filter(Boolean).join(' · ');
  $('d-price').textContent = eur(i.price);
  $('d-unit').textContent = i.unitPrice ? `${eur(i.unitPrice)} / ${i.unit}` : '';
  $('d-note').textContent = i.note || '';
  $('detail').showModal();
}

// --- form ---
function openForm(i) {
  editing = i || null; photoData = i ? i.photo : null;
  $('f-title').textContent = i ? 'Editar producto' : 'Nuevo producto';
  $('f-store').value = i ? i.store : (filter !== 'Todos' ? filter : '');
  $('f-brand').value = i?.brand || ''; $('f-name').value = i?.name || '';
  $('f-price').value = i?.price ?? ''; $('f-unitprice').value = i?.unitPrice ?? '';
  $('f-unit').value = i?.unit || 'kg'; $('f-note').value = i?.note || '';
  $('f-preview').src = photoData || ''; $('f-preview').hidden = !photoData;
  $('f-photo-hint').hidden = !!photoData;
  $('form-dlg').showModal();
}
$('f-photo').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  photoData = await resize(f);
  $('f-preview').src = photoData; $('f-preview').hidden = false; $('f-photo-hint').hidden = true;
};
$('form').onsubmit = async e => {
  e.preventDefault();
  const num = v => v === '' ? null : Number(v);
  const o = {
    id: editing?.id || crypto.randomUUID(), created: editing?.created || Date.now(),
    photo: photoData, store: $('f-store').value.trim(), brand: $('f-brand').value.trim(),
    name: $('f-name').value.trim(), price: num($('f-price').value),
    unitPrice: num($('f-unitprice').value), unit: $('f-unit').value, note: $('f-note').value.trim(),
  };
  await save(o);
  items = await loadAll();
  filter = o.store;
  $('form-dlg').close(); render();
};

// --- events ---
$('add').onclick = () => openForm(null);
$('f-cancel').onclick = () => $('form-dlg').close();
$('d-close').onclick = () => $('detail').close();
$('d-edit').onclick = () => { const i = editing; $('detail').close(); openForm(i); };
$('d-del').onclick = async () => {
  if (!confirm('¿Borrar este producto?')) return;
  await remove(editing.id); items = await loadAll(); $('detail').close(); render();
};
$('chips').onclick = e => { const b = e.target.closest('.chip'); if (b) { filter = b.dataset.s; render(); } };
$('grid').onclick = e => { const c = e.target.closest('.card'); if (c) openDetail(c.dataset.id); };
for (const d of ['detail', 'form-dlg'])
  $(d).addEventListener('click', e => { if (e.target === $(d)) $(d).close(); });

loadAll().then(r => { items = r; render(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
