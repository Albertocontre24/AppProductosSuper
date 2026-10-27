'use strict';
const $ = id => document.getElementById(id);
const DEFAULT_STORES = ['Lidl', 'Mercadona', 'Carrefour', 'Dia', 'Aldi', 'Alcampo'];
let items = [], filter = 'Todos', editing = null, photoData = null, rating = 0;

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
const localAll = () => tx('readonly', s => s.getAll());
const localSave = o => tx('readwrite', s => s.put(o));
const localRemove = id => tx('readwrite', s => s.delete(id));

// --- nube (Firebase) ---
let cloud = null; // { auth, db, user }
const useCloud = () => !!(cloud && cloud.user);
const col = () => cloud.db.collection('users').doc(cloud.user.uid).collection('products');
const loadAll = async () => useCloud() ? (await col().get()).docs.map(d => d.data()) : localAll();
const save = o => useCloud() ? col().doc(o.id).set(o) : localSave(o);
const remove = id => useCloud() ? col().doc(id).delete() : localRemove(id);

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}
const AUTH_ERR = {
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/email-already-in-use': 'Ese correo ya tiene cuenta. Pulsa Entrar.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/network-request-failed': 'Sin conexión. Inténtalo de nuevo.',
};
const authMsg = e => AUTH_ERR[e.code] || e.message;

async function initCloud() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg) return false;
  try {
    for (const f of ['app', 'auth', 'firestore'])
      await loadScript(`https://www.gstatic.com/firebasejs/10.12.2/firebase-${f}-compat.js`);
    firebase.initializeApp(cfg);
    cloud = { auth: firebase.auth(), db: firebase.firestore(), user: null };
    cloud.db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    cloud.auth.onAuthStateChanged(async u => {
      cloud.user = u;
      updateAccount();
      if (u) { $('auth-dlg').open && $('auth-dlg').close(); await migrateLocal(); }
      else if (!sessionStorage.getItem('nocloud')) $('auth-dlg').showModal();
      items = await loadAll(); render();
    });
    return true;
  } catch (e) { cloud = null; return false; }
}
async function migrateLocal() {
  const local = await localAll();
  if (!local.length) return;
  if (!confirm(`Hay ${local.length} producto(s) guardados solo en este móvil. ¿Subirlos a tu cuenta?`)) return;
  await Promise.all(local.map(o => col().doc(o.id).set(o)));
  await Promise.all(local.map(o => localRemove(o.id)));
}
function updateAccount() {
  const b = $('account');
  b.hidden = !cloud;
  b.textContent = useCloud() ? '👤 ' + (cloud.user.email || '') : '👤 Entrar';
}
async function doAuth(create) {
  $('a-err').textContent = '';
  const email = $('a-email').value.trim(), pass = $('a-pass').value;
  if (!email || !pass) { $('a-err').textContent = 'Escribe correo y contraseña.'; return; }
  try {
    await (create ? cloud.auth.createUserWithEmailAndPassword(email, pass)
                  : cloud.auth.signInWithEmailAndPassword(email, pass));
  } catch (e) { $('a-err').textContent = authMsg(e); }
}
$('a-login').onclick = () => doAuth(false);
$('a-create').onclick = () => doAuth(true);
$('a-skip').onclick = () => { sessionStorage.setItem('nocloud', '1'); $('auth-dlg').close(); };
$('a-reset').onclick = async () => {
  const email = $('a-email').value.trim();
  if (!email) { $('a-err').textContent = 'Escribe tu correo arriba primero.'; return; }
  try { await cloud.auth.sendPasswordResetEmail(email); $('a-err').textContent = 'Te hemos enviado un correo para cambiarla.'; }
  catch (e) { $('a-err').textContent = authMsg(e); }
};
$('account').onclick = async () => {
  if (useCloud()) {
    if (confirm(`Sesión: ${cloud.user.email}\n¿Cerrar sesión?`)) { sessionStorage.removeItem('nocloud'); await cloud.auth.signOut(); }
  } else { sessionStorage.removeItem('nocloud'); $('auth-dlg').showModal(); }
};

// --- helpers ---
const eur = n => (n || n === 0) && n !== '' ? Number(n).toFixed(2).replace('.', ',') + ' €' : '';
const stars = n => n ? '★'.repeat(n) + `<span class="off">${'★'.repeat(5 - n)}</span>` : '';
const stores = () => [...new Set([...DEFAULT_STORES, ...items.map(i => i.store)])];

function resize(file, max = 800) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = rej;
    img.src = url;
  });
}

// --- render ---
const unitLine = i => i.unitPrice ? `${eur(i.unitPrice)}/${i.unit === 'litro' ? 'l' : i.unit}` : '';
const priceNum = n => Number(n).toFixed(2).replace('.', ',');
function render() {
  const used = [...new Set(items.map(i => i.store))].sort();
  if (filter !== 'Todos' && !used.includes(filter)) filter = 'Todos';
  $('chips').innerHTML = ['Todos', ...used].map(s =>
    `<button class="tab ${s === filter ? 'on' : ''}" data-s="${esc(s)}" ${s === filter ? 'aria-current="true"' : ''}>${esc(s)}</button>`).join('');
  const list = items.filter(i => filter === 'Todos' || i.store === filter)
    .sort((a, b) => b.created - a.created);
  $('title').textContent = filter === 'Todos' ? 'Mis productos' : filter;
  $('count').textContent = list.length ? (list.length === 1 ? '1 producto' : `${list.length} productos`) : '';
  $('grid').innerHTML = list.map(i => {
    const sub2 = filter === 'Todos' ? (i.brand ? `${i.brand} en ${i.store}` : `En ${i.store}`) : i.brand;
    return `
    <button class="card" data-id="${i.id}">
      <span class="ph">${i.photo ? `<img src="${i.photo}" alt="" loading="lazy">` : '<span class="noimg">Sin foto</span>'}
        ${i.price != null ? `<span class="tag"><b>${priceNum(i.price)}<em>€</em></b>${unitLine(i) ? `<small>${unitLine(i)}</small>` : ''}</span>` : ''}</span>
      <span class="nm">${esc(i.name || i.brand || 'Producto')}</span>
      ${sub2 ? `<span class="br">${esc(sub2)}</span>` : ''}
      ${i.rating ? `<span class="stars" aria-label="${i.rating} de 5">${stars(i.rating)}</span>` : ''}
    </button>`;
  }).join('');
  $('empty').hidden = list.length > 0;
  $('empty').textContent = items.length
    ? `Todavía no hay nada en ${filter}. Pulsa + y hazle una foto al primero.`
    : 'Aún no hay productos. Pulsa + y hazle una foto al primero que te guste.';
  $('stores').innerHTML = stores().map(s => `<option value="${esc(s)}">`).join('');
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// --- detail ---
function openDetail(id) {
  const i = items.find(x => x.id === id); if (!i) return;
  editing = i;
  $('d-img').src = i.photo || '';
  $('d-name').textContent = i.name || i.brand || 'Producto';
  $('d-meta').textContent = i.name && i.brand ? `${i.brand} en ${i.store}` : `En ${i.store}`;
  $('d-stars').innerHTML = stars(i.rating);
  $('d-tag').hidden = i.price == null;
  $('d-price').innerHTML = i.price == null ? '' : `${priceNum(i.price)}<em>€</em>`;
  $('d-unit').textContent = unitLine(i);
  $('d-note').textContent = i.note || '';
  $('detail').showModal();
}

// --- form ---
function openForm(i) {
  editing = i || null; photoData = i ? i.photo : null; setRating(i?.rating || 0);
  $('f-title').textContent = i ? 'Editar producto' : 'Nuevo producto';
  $('f-store').value = i ? i.store : (filter !== 'Todos' ? filter : '');
  $('f-brand').value = i?.brand || ''; $('f-name').value = i?.name || '';
  $('f-price').value = i?.price ?? ''; $('f-unitprice').value = i?.unitPrice ?? '';
  $('f-unit').value = i?.unit || 'kg'; $('f-note').value = i?.note || '';
  $('f-preview').src = photoData || ''; $('f-preview').hidden = !photoData;
  $('f-photo-hint').hidden = !!photoData;
  $('form-dlg').showModal();
}
function setRating(n) {
  rating = n;
  $('f-stars').innerHTML = [1, 2, 3, 4, 5].map(k =>
    `<button type="button" data-n="${k}" class="${k <= n ? 'on' : ''}" aria-label="${k} estrellas">★</button>`).join('');
}
$('f-stars').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  const n = Number(b.dataset.n); setRating(n === rating ? 0 : n);
};
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
    unitPrice: num($('f-unitprice').value), unit: $('f-unit').value, note: $('f-note').value.trim(), rating,
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
$('chips').onclick = e => { const b = e.target.closest('.tab'); if (b) { filter = b.dataset.s; render(); } };
$('grid').onclick = e => { const c = e.target.closest('.card'); if (c) openDetail(c.dataset.id); };
for (const d of ['detail', 'form-dlg'])
  $(d).addEventListener('click', e => { if (e.target === $(d)) $(d).close(); });

localAll().then(r => { items = r; render(); }).then(initCloud).then(ok => { if (!ok) $('account').hidden = true; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
