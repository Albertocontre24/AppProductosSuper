'use strict';
const $ = id => document.getElementById(id);
const DEFAULT_STORES = ['Lidl', 'Mercadona', 'Carrefour', 'Dia', 'Aldi', 'Alcampo'];
let items = [], filter = 'Todos', editing = null, photoData = null, score = null, view = 'tried', formStatus = 'tried', selTier = null, cmpOn = false, cmpSel = new Set(), cmpQ = '', cmpSort = 'none';

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
// puntuación 0-10 con saltos de 0,5. Los productos antiguos tenían 1-5 estrellas: valen el doble.
const scoreOf = i => i.score != null ? i.score : i.rating ? i.rating * 2 : null;
const fmtScore = n => (n % 1 ? n.toFixed(1) : String(n)).replace('.', ',');
const scoreHtml = n => n == null ? '' : `★ <b>${fmtScore(n)}</b><small>/10</small>`;
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

// --- animaciones de la barra ---
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let segIdx = -1, tabPrev = null;
function placeSeg() {
  const btns = [...document.querySelectorAll('.seg button')], th = $('seg-thumb');
  const idx = btns.findIndex(b => b.dataset.v === view), b = btns[idx];
  if (!b || !b.offsetWidth) return;
  const to = b.offsetLeft, from = segIdx >= 0 ? btns[segIdx].offsetLeft : to;
  th.style.width = b.offsetWidth + 'px';
  th.style.transform = `translateX(${to}px)`;
  if (segIdx >= 0 && segIdx !== idx && !reduceMotion()) {
    const dir = Math.sign(to - from);
    th.animate([
      { transform: `translateX(${from}px) scale(1,1)` },
      { transform: `translateX(${from + (to - from) * .55}px) scale(1.18,.82)`, offset: .35 },
      { transform: `translateX(${to + dir * 7}px) scale(.96,1.1)`, offset: .7 },
      { transform: `translateX(${to}px) scale(1,1)` },
    ], { duration: 560, easing: 'cubic-bezier(.3,.9,.4,1)' });
  }
  segIdx = idx;
}
function placeTabInk() {
  const nav = $('chips'), on = nav.querySelector('.tab.on'); if (!on) return;
  const ink = document.createElement('span'); ink.className = 'tab-ink'; nav.appendChild(ink);
  const to = { l: on.offsetLeft, w: on.offsetWidth };
  ink.style.left = to.l + 'px'; ink.style.width = to.w + 'px';
  if (tabPrev && (tabPrev.l !== to.l || tabPrev.w !== to.w) && !reduceMotion())
    ink.animate([{ left: tabPrev.l + 'px', width: tabPrev.w + 'px' }, { left: to.l + 'px', width: to.w + 'px' }],
      { duration: 460, easing: 'cubic-bezier(.34,1.45,.5,1)' });
  if (tabPrev && tabPrev.s !== filter) on.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  tabPrev = { ...to, s: filter };
}
addEventListener('resize', () => { segIdx = -1; tabPrev = null; placeSeg(); placeTabInk(); });

// --- render ---
const unitLine = i => i.unitPrice ? `${eur(i.unitPrice)}/${i.unit === 'litro' ? 'l' : i.unit}` : '';
const priceNum = n => Number(n).toFixed(2).replace('.', ',');
const isWant = i => i.status === 'want';
const imgOf = i => i.photo || i.photoUrl || '';
function render() {
  const used = [...new Set(items.map(i => i.store).filter(Boolean))].sort();
  if (filter !== 'Todos' && !used.includes(filter)) filter = 'Todos';
  $('chips').innerHTML = ['Todos', ...used].map(s =>
    `<button class="tab ${s === filter ? 'on' : ''}" data-s="${esc(s)}" ${s === filter ? 'aria-current="true"' : ''}>${esc(s)}</button>`).join('');
  placeTabInk();
  document.querySelectorAll('.seg button').forEach(b => {
    const on = b.dataset.v === view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  });
  placeSeg();
  if (view !== 'tried') cmpOn = false;
  const want = view === 'want', tierView = view === 'tier';
  let list = items.filter(i => isWant(i) === want && (filter === 'Todos' || i.store === filter))
    .sort((a, b) => b.created - a.created);
  if (cmpOn && cmpQ) list = list.filter(i => norm(`${i.name} ${i.brand} ${i.store}`).includes(norm(cmpQ)));
  $('title').textContent = want ? 'Quiero probar' : tierView ? (filter === 'Todos' ? 'Tierlist' : `Tierlist de ${filter}`) : (filter === 'Todos' ? 'Mis productos' : filter);
  $('count').textContent = list.length
    ? `${list.length === 1 ? '1 producto' : list.length + ' productos'}${want && filter !== 'Todos' ? ' en ' + filter : ''}` : '';
  $('grid').innerHTML = list.map(i => {
    const sub2 = filter === 'Todos' ? (i.brand ? `${i.brand} en ${i.store}` : `En ${i.store}`) : i.brand;
    const img = imgOf(i);
    const picked = cmpOn && cmpSel.has(i.id);
    return `
    <button class="card ${cmpOn ? 'pick' : ''} ${picked ? 'picked' : ''}" data-id="${i.id}" ${cmpOn ? `aria-pressed="${picked}"` : ''}>
      <span class="ph">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<span class="noimg">Sin foto</span>'}
        ${cmpOn ? '<span class="chk" aria-hidden="true">✓</span>' : ''}
        ${i.price != null ? `<span class="tag"><b>${priceNum(i.price)}<em>€</em></b>${unitLine(i) ? `<small>${unitLine(i)}</small>` : ''}</span>` : ''}</span>
      <span class="nm">${esc(i.name || i.brand || 'Producto')}</span>
      ${sub2 ? `<span class="br">${esc(sub2)}</span>` : ''}
      ${scoreOf(i) != null ? `<span class="score" aria-label="Puntuación ${fmtScore(scoreOf(i))} de 10">${scoreHtml(scoreOf(i))}</span>` : ''}
    </button>`;
  }).join('');
  if (tierView) $('grid').innerHTML = '';
  $('empty').hidden = list.length > 0;
  $('empty').textContent = tierView
    ? 'Primero guarda productos en Me gustaron. Luego los ordenas aquí.'
    : want
    ? 'Aquí apuntas lo que quieres probar. Pulsa + y hazle una foto cuando lo veas en el súper.'
    : items.some(i => !isWant(i))
      ? `Todavía no hay nada en ${filter}. Pulsa + y hazle una foto al primero.`
      : 'Aún no hay productos. Pulsa + y hazle una foto al primero que te guste.';
  $('stores').innerHTML = stores().map(s => `<option value="${esc(s)}">`).join('');
  $('sug').hidden = !want;
  const nTried = items.filter(i => !isWant(i)).length;
  $('cmp-start').hidden = !(view === 'tried' && !cmpOn && nTried >= 2);
  $('map-btn').hidden = filter === 'Todos' || cmpOn;
  $('cmp-q').hidden = !cmpOn; $('cmp-bar').hidden = !cmpOn; $('add').hidden = cmpOn;
  if (cmpOn) {
    $('count').textContent = 'Elige de 2 a 6 productos para compararlos';
    const n = [...cmpSel].filter(id => items.some(i => i.id === id)).length;
    $('cmp-n').textContent = n === 1 ? '1 elegido' : `${n} elegidos`;
    $('cmp-go').disabled = n < 2;
  }
  $('tiers').hidden = !tierView;
  if (tierView) renderTiers(list);
  if (want) loadSuggestions(false);
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// --- detail ---
function openDetail(id) {
  const i = items.find(x => x.id === id); if (!i) return;
  editing = i;
  $('d-img').src = imgOf(i);
  $('d-name').textContent = i.name || i.brand || 'Producto';
  $('d-meta').textContent = i.name && i.brand ? `${i.brand} en ${i.store}` : `En ${i.store}`;
  $('d-stars').innerHTML = scoreHtml(scoreOf(i));
  $('d-stars').hidden = scoreOf(i) == null;
  $('d-tag').hidden = i.price == null;
  $('d-price').innerHTML = i.price == null ? '' : `${priceNum(i.price)}<em>€</em>`;
  $('d-unit').textContent = unitLine(i);
  $('d-note').textContent = i.note || '';
  $('d-tried').hidden = !isWant(i);
  $('detail').showModal();
}

// --- form ---
function openForm(i, status) {
  editing = i || null; photoData = i ? i.photo : null; formStatus = status || i?.status || 'tried';
  const want = formStatus === 'want';
  setScore(want || !i ? null : scoreOf(i));
  $('f-title').textContent = want ? (i ? 'Editar pendiente' : 'Quiero probar') : (i && isWant(i) ? 'Ya lo probé' : i ? 'Editar producto' : 'Nuevo producto');
  $('f-rate').hidden = want;
  $('f-note').placeholder = want ? 'Por qué quieres probarlo, quién te lo recomendó…' : 'Muy salado, sabor fuerte, repetiría…';
  $('f-store').value = i ? i.store : (filter !== 'Todos' ? filter : '');
  $('f-brand').value = i?.brand || ''; $('f-name').value = i?.name || '';
  $('f-price').value = i?.price ?? ''; $('f-unitprice').value = i?.unitPrice ?? '';
  $('f-unit').value = i?.unit || 'kg'; $('f-note').value = i?.note || '';
  const shown = i ? imgOf(i) : '';
  $('f-preview').src = shown; $('f-preview').hidden = !shown;
  $('f-photo-hint').hidden = !!shown;
  $('form-dlg').showModal();
}
function setScore(n) {
  score = n;
  $('sc-val').textContent = n == null ? '—' : fmtScore(n);
  $('sc-range').value = n == null ? 5 : n;
  $('sc-range').classList.toggle('unset', n == null);
  $('sc-clear').hidden = n == null;
}
const stepScore = d => setScore(Math.min(10, Math.max(0, (score ?? 5 - d) + d)));
$('sc-minus').onclick = () => stepScore(-0.5);
$('sc-plus').onclick = () => stepScore(0.5);
$('sc-range').oninput = e => setScore(Number(e.target.value));
$('sc-clear').onclick = () => setScore(null);
const onPhoto = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { photoData = await resize(f); } catch { alert('No se pudo leer esa foto. Prueba con otra.'); return; }
  $('f-preview').src = photoData; $('f-preview').hidden = false; $('f-photo-hint').hidden = true;
  e.target.value = '';
};
$('f-photo').onchange = onPhoto;
$('f-cam').onchange = onPhoto;
$('f-btn-cam').onclick = () => $('f-cam').click();
$('f-btn-gal').onclick = () => $('f-photo').click();
$('form').onsubmit = async e => {
  e.preventDefault();
  const num = v => v === '' ? null : Number(v);
  const want = formStatus === 'want';
  const o = {
    id: editing?.id || crypto.randomUUID(), created: editing?.created || Date.now(), status: formStatus,
    photo: photoData, photoUrl: editing?.photoUrl || null, cat: editing?.cat, tier: editing?.tier ?? null,
    store: $('f-store').value.trim(), brand: $('f-brand').value.trim(),
    name: $('f-name').value.trim(), price: num($('f-price').value),
    unitPrice: num($('f-unitprice').value), unit: $('f-unit').value, note: $('f-note').value.trim(),
    score: want ? null : score,
  };
  if (o.cat === undefined) delete o.cat;
  await save(o);
  items = await loadAll();
  filter = o.store; view = formStatus;
  $('form-dlg').close(); render();
};

// --- sugerencias (Open Food Facts) ---
const OFF = 'https://es.openfoodfacts.org';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const storeTag = s => norm(s).replace(/ /g, '-');
let sugState = { status: 'idle', list: [], key: '' }, sugBusy = false;

async function offJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('OFF ' + r.status);
  return r.json();
}
function readCache(key) {
  try {
    const c = JSON.parse(localStorage.getItem('sug1') || 'null');
    return c && c.key === key && Date.now() - c.t < 864e5 ? c.list : null;
  } catch { return null; }
}
function writeCache(key, list) { try { localStorage.setItem('sug1', JSON.stringify({ key, t: Date.now(), list })); } catch {} }

async function categoryFor(it) {
  if (it.cat !== undefined) return it.cat;
  const q = norm(`${it.brand || ''} ${it.name || ''}`);
  let tag = '';
  if (q) {
    await sleep(700);
    const d = await offJson(`${OFF}/cgi/search.pl?search_simple=1&action=process&json=1&page_size=5&fields=categories_tags&search_terms=${encodeURIComponent(q)}&tagtype_0=countries&tag_contains_0=contains&tag_0=spain`);
    const p = (d.products || []).find(p => (p.categories_tags || []).length);
    tag = p ? p.categories_tags[p.categories_tags.length - 1] : '';
  }
  it.cat = tag;
  try { await save(it); } catch {}
  return tag;
}
function knownNames() {
  const k = new Set();
  for (const i of items) { k.add(norm(i.name)); k.add(norm(`${i.brand} ${i.name}`)); }
  k.delete('');
  return k;
}
async function loadSuggestions(force) {
  const liked = items.filter(i => !isWant(i) && scoreOf(i) >= 8)
    .sort((a, b) => scoreOf(b) - scoreOf(a) || b.created - a.created);
  if (!liked.length) { sugState = { status: 'empty', list: [], key: '' }; return paintSug(); }
  const key = liked.map(i => i.id).join(',') + '|' + filter;
  if (!force && sugState.key === key && sugState.status !== 'error') return paintSug();
  const cached = force ? null : readCache(key);
  if (cached) { sugState = { key, status: 'done', list: cached }; return paintSug(); }
  if (sugBusy) return;
  sugBusy = true; sugState = { key, status: 'loading', list: [] }; paintSug();
  try {
    const cats = []; let lookups = 0;
    for (const it of liked) {
      if (cats.length >= 3) break;
      if (it.cat === undefined && lookups++ >= 5) break;
      const tag = await categoryFor(it);
      if (tag && !cats.some(c => c.tag === tag)) cats.push({ tag, from: it.name || it.brand });
    }
    const known = knownNames(), seen = new Set(), list = [];
    for (const c of cats) {
      await sleep(700);
      const d = await offJson(`${OFF}/api/v2/search?categories_tags=${encodeURIComponent(c.tag)}&countries_tags=en:spain${filter !== 'Todos' ? '&stores_tags=' + storeTag(filter) : ''}&sort_by=popularity_key&page_size=30&fields=code,product_name,brands,image_front_small_url,stores`);
      let n = 0;
      for (const p of d.products || []) {
        const name = (p.product_name || '').trim();
        const brand = (p.brands || '').split(',')[0].trim();
        if (!name || !p.image_front_small_url || seen.has(p.code)) continue;
        if (known.has(norm(name)) || known.has(norm(`${brand} ${name}`))) continue;
        seen.add(p.code);
        list.push({ code: p.code, name, brand, img: p.image_front_small_url, store: (p.stores || '').split(',')[0].trim(), from: c.from });
        if (++n >= 6) break;
      }
    }
    writeCache(key, list); sugState = { key, status: 'done', list };
  } catch { sugState = { key, status: 'error', list: [] }; }
  sugBusy = false; paintSug();
}
function paintSug() {
  if (view !== 'want') return;
  const s = sugState, known = knownNames();
  const list = s.list.filter(x => !known.has(norm(x.name)) && !known.has(norm(`${x.brand} ${x.name}`)));
  const msg = {
    empty: 'Valora con 4 o 5 estrellas lo que te gusta y aquí saldrán ideas parecidas.',
    loading: 'Buscando productos parecidos…',
    error: 'No se pudieron cargar las sugerencias. Comprueba la conexión e inténtalo de nuevo en un minuto.',
    done: list.length ? '' : (filter === 'Todos' ? 'No hay sugerencias nuevas por ahora.' : `Open Food Facts no tiene sugerencias de ${filter} todavía. Prueba con Todos.`),
    idle: '',
  }[s.status] || '';
  $('sug-msg').textContent = msg;
  $('sug-refresh').hidden = !['done', 'error'].includes(s.status);
  $('sug-list').innerHTML = list.map(x => `
    <div class="card sug">
      <span class="ph"><img src="${esc(x.img)}" alt="" loading="lazy"></span>
      <span class="nm">${esc(x.name)}</span>
      ${x.brand ? `<span class="br">${esc(x.brand)}</span>` : ''}
      <span class="why">Parecido a ${esc(x.from)}</span>
      <button class="addwant" data-code="${esc(x.code)}">Quiero probarlo</button>
    </div>`).join('');
}
$('sug-refresh').onclick = () => loadSuggestions(true);
$('sug-list').onclick = async e => {
  const b = e.target.closest('[data-code]'); if (!b) return;
  const s = sugState.list.find(x => x.code === b.dataset.code); if (!s) return;
  const known = stores().find(x => norm(x) === norm(s.store));
  const store = filter !== 'Todos' ? filter : known || (s.store ? s.store[0].toUpperCase() + s.store.slice(1) : 'Sin súper');
  b.disabled = true;
  await save({ id: crypto.randomUUID(), created: Date.now(), status: 'want', photo: null, photoUrl: s.img,
    store, brand: s.brand, name: s.name, price: null, unitPrice: null, unit: 'kg', score: null,
    note: `Parecido a ${s.from}` });
  items = await loadAll(); render();
};


// --- tierlist ---
const TIERS = [['S', '#ef5350'], ['A', '#ff9f43'], ['B', '#ffd23f'], ['C', '#7bc96f'], ['D', '#4fa3e0']];
const initials = i => (i.name || i.brand || '?').trim().slice(0, 2).toUpperCase();
function renderTiers(list) {
  if (selTier && !list.some(i => i.id === selTier)) selTier = null;
  const chip = i => {
    const img = imgOf(i), n = i.name || i.brand || 'Producto';
    return `<button class="tchip ${i.id === selTier ? 'sel' : ''}" data-id="${i.id}" draggable="true" title="${esc(n)}" aria-label="${esc(n)}" aria-pressed="${i.id === selTier}">${img ? `<img src="${esc(img)}" alt="" draggable="false">` : `<span>${esc(initials(i))}</span>`}</button>`;
  };
  const row = (t, color, label) => `<div class="trow" data-t="${t}"><div class="tlabel" style="background:${color}">${label}</div><div class="tcells">${list.filter(i => (i.tier || '') === t).map(chip).join('')}</div></div>`;
  $('tier-rows').innerHTML = TIERS.map(([t, c]) => row(t, c, t)).join('') + row('', 'var(--line)', '?');
  const sel = list.find(i => i.id === selTier);
  $('tier-hint').textContent = sel ? `«${sel.name || sel.brand}»: toca la fila donde ponerlo.` : list.length ? 'Toca un producto y luego la fila donde ponerlo. La fila ? lo deja sin clasificar.' : '';
  $('tier-save').hidden = !list.length;
}
async function placeTier(id, t) {
  const it = items.find(x => x.id === id); if (!it) return;
  it.tier = t || null; selTier = null;
  render();
  try { await save(it); } catch {}
}
$('tiers').onclick = e => {
  const c = e.target.closest('.tchip');
  if (c) { selTier = selTier === c.dataset.id ? null : c.dataset.id; return render(); }
  const r = e.target.closest('.trow');
  if (r && selTier) placeTier(selTier, r.dataset.t);
};
$('tiers').addEventListener('dragstart', e => { const c = e.target.closest('.tchip'); if (c) e.dataTransfer.setData('text/plain', c.dataset.id); });
$('tiers').addEventListener('dragover', e => { if (e.target.closest('.trow')) e.preventDefault(); });
$('tiers').addEventListener('drop', e => {
  const r = e.target.closest('.trow'); if (!r) return;
  e.preventDefault(); placeTier(e.dataTransfer.getData('text/plain'), r.dataset.t);
});

function loadImg(src) {
  return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}
$('tier-save').onclick = async () => {
  const list = items.filter(i => !isWant(i) && (filter === 'Todos' || i.store === filter));
  const W = 1080, LBL = 150, S = 130, G = 10, per = Math.floor((W - LBL - G) / (S + G));
  const rows = TIERS.map(([t, c]) => [t, c, list.filter(i => i.tier === t)]);
  const heights = rows.map(([, , l]) => Math.max(150, Math.ceil(l.length / per) * (S + G) + G));
  const HEAD = 130, H = HEAD + heights.reduce((a, b) => a + b, 0) + 24;
  try { await document.fonts.load('800 80px "Barlow Condensed"'); } catch {}
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  x.fillStyle = '#131a22'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#fff'; x.font = '800 72px "Barlow Condensed", sans-serif'; x.textBaseline = 'middle';
  x.fillText(filter === 'Todos' ? 'Mi tierlist del súper' : `Mi tierlist de ${filter}`, 30, HEAD / 2);
  let y = HEAD;
  for (let r = 0; r < rows.length; r++) {
    const [t, c, l] = rows[r], h = heights[r];
    x.fillStyle = '#1c242d'; x.fillRect(0, y, W, h - 4);
    x.fillStyle = c; x.fillRect(0, y, LBL, h - 4);
    x.fillStyle = '#131a22'; x.font = '800 90px "Barlow Condensed", sans-serif'; x.textAlign = 'center';
    x.fillText(t, LBL / 2, y + (h - 4) / 2); x.textAlign = 'left';
    for (let k = 0; k < l.length; k++) {
      const px = LBL + G + (k % per) * (S + G), py = y + G + Math.floor(k / per) * (S + G);
      const im = l[k].photo ? await loadImg(l[k].photo) : null;
      if (im) {
        const m = Math.min(im.width, im.height);
        x.drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, px, py, S, S);
      } else {
        x.fillStyle = '#3a444f'; x.fillRect(px, py, S, S);
        x.fillStyle = '#fff'; x.font = '800 48px "Barlow Condensed", sans-serif'; x.textAlign = 'center';
        x.fillText(initials(l[k]), px + S / 2, py + S / 2); x.textAlign = 'left';
      }
    }
    y += h;
  }
  const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  const file = new File([blob], 'tierlist.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Mi tierlist del súper' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tierlist.png'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};


// --- comparador ---
const SORTS = [['none', 'Orden elegido'], ['price', 'Precio'], ['unit', 'Por kg o litro'], ['rating', 'Puntuación']];
const pname = p => p.name || p.brand || 'Producto';
function bestSets(ps) {
  const out = { price: new Set(), unit: new Set(), rating: new Set() };
  const pick = (g, key, dir, set) => {
    if (g.length < 2) return;
    const v = g.map(p => p[key]), m = dir < 0 ? Math.min(...v) : Math.max(...v);
    if (Math.min(...v) === Math.max(...v)) return;
    g.filter(p => p[key] === m).forEach(p => set.add(p.id));
  };
  pick(ps.filter(p => p.price != null), 'price', -1, out.price);
  for (const u of ['kg', 'litro']) pick(ps.filter(p => p.unitPrice != null && p.unit === u), 'unitPrice', -1, out.unit);
  pick(ps.filter(p => scoreOf(p) != null).map(p => ({ id: p.id, s: scoreOf(p) })), 's', 1, out.rating);
  return out;
}
function compareList() {
  const ps = [...cmpSel].map(id => items.find(i => i.id === id)).filter(Boolean);
  const nul = (v, dir) => v == null ? Infinity : dir * v;
  if (cmpSort === 'price') ps.sort((a, b) => nul(a.price, 1) - nul(b.price, 1));
  if (cmpSort === 'unit') ps.sort((a, b) => nul(a.unitPrice, 1) - nul(b.unitPrice, 1));
  if (cmpSort === 'rating') ps.sort((a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1));
  return ps;
}
function renderCompare() {
  const ps = compareList(), best = bestSets(ps);
  $('cmp-sort').innerHTML = SORTS.map(([k, l]) => `<button type="button" class="pill ${k === cmpSort ? 'on' : ''}" data-k="${k}">${l}</button>`).join('');
  const who = set => ps.filter(p => set.has(p.id)).map(p => `${pname(p)} en ${p.store}`).join(' y ');
  const lines = [];
  if (best.price.size) lines.push(`Más barato: ${who(best.price)}`);
  if (best.unit.size) lines.push(`Mejor precio por kg o litro: ${who(best.unit)}`);
  if (best.rating.size) lines.push(`Mejor puntuado: ${who(best.rating)}`);
  $('cmp-sum').innerHTML = lines.map(l => `<p>${esc(l)}</p>`).join('');
  $('cmp-sum').hidden = !lines.length;
  const t = $('cmp-table'); t.style.setProperty('--n', ps.length);
  const row = (label, fn) => `<div class="cl">${label}</div>` + ps.map(p => `<div class="c">${fn(p)}</div>`).join('');
  const val = (txt, isBest) => txt ? `<b class="cv ${isBest ? 'best' : ''}">${txt}</b>` : '<span class="muted">—</span>';
  t.innerHTML =
    row('', p => { const im = imgOf(p); return `<span class="ph">${im ? `<img src="${esc(im)}" alt="">` : '<span class="noimg">Sin foto</span>'}</span><b class="cn">${esc(pname(p))}</b>`; }) +
    row('Súper', p => esc(p.store)) +
    row('Marca', p => p.brand ? esc(p.brand) : '<span class="muted">—</span>') +
    row('Precio', p => val(p.price != null ? eur(p.price) : '', best.price.has(p.id))) +
    row('Por kg o litro', p => val(p.unitPrice != null ? `${eur(p.unitPrice)}/${p.unit === 'litro' ? 'l' : p.unit}` : '', best.unit.has(p.id))) +
    row('Mi puntuación', p => scoreOf(p) != null ? `<span class="score big ${best.rating.has(p.id) ? 'bestr' : ''}" aria-label="Puntuación ${fmtScore(scoreOf(p))} de 10">${scoreHtml(scoreOf(p))}</span>` : '<span class="muted">—</span>') +
    row('Mi nota', p => p.note ? `<span class="cnote">${esc(p.note)}</span>` : '<span class="muted">—</span>');
}
$('cmp-start').onclick = () => { cmpOn = true; cmpSel.clear(); cmpQ = ''; $('cmp-q').value = ''; filter = 'Todos'; render(); };
$('cmp-cancel').onclick = () => { cmpOn = false; cmpSel.clear(); render(); };
$('cmp-q').oninput = e => { cmpQ = e.target.value; render(); };
$('cmp-go').onclick = () => { renderCompare(); $('cmp-dlg').showModal(); };
$('cmp-close').onclick = () => $('cmp-dlg').close();
$('cmp-sort').onclick = e => { const b = e.target.closest('.pill'); if (b) { cmpSort = b.dataset.k; renderCompare(); } };


// --- localizar supermercado ---
$('map-btn').onclick = () => {
  const store = filter, base = 'https://www.google.com/maps/search/';
  const plain = `${base}?api=1&query=${encodeURIComponent(store + ' supermercado')}`;
  // se abre la pestaña ya, dentro del toque, para que el navegador no la bloquee
  const w = window.open('', '_blank');
  const go = url => { if (w) w.location.href = url; else location.href = url; };
  if (!navigator.geolocation) return go(plain);
  const btn = $('map-btn'), txt = btn.textContent;
  btn.disabled = true; btn.textContent = 'Localizando…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      btn.disabled = false; btn.textContent = txt;
      const { latitude: la, longitude: lo } = pos.coords;
      go(`${base}${encodeURIComponent(store + ' supermercado')}/@${la.toFixed(5)},${lo.toFixed(5)},15z`);
    },
    () => { btn.disabled = false; btn.textContent = txt; go(plain); },
    { timeout: 8000, maximumAge: 300000 });
};

// --- events ---
$('add').onclick = () => openForm(null, view === 'want' ? 'want' : 'tried');
$('f-cancel').onclick = () => $('form-dlg').close();
$('d-close').onclick = () => $('detail').close();
$('d-edit').onclick = () => { const i = editing; $('detail').close(); openForm(i); };
$('d-tried').onclick = () => { const i = editing; $('detail').close(); openForm(i, 'tried'); };
document.querySelector('.seg').onclick = e => { const b = e.target.closest('button'); if (b) { view = b.dataset.v; render(); } };
$('d-del').onclick = async () => {
  if (!confirm('¿Borrar este producto?')) return;
  await remove(editing.id); items = await loadAll(); $('detail').close(); render();
};
$('chips').onclick = e => { const b = e.target.closest('.tab'); if (b) { filter = b.dataset.s; render(); } };
$('grid').onclick = e => {
  const c = e.target.closest('.card'); if (!c) return;
  if (!cmpOn) return openDetail(c.dataset.id);
  const id = c.dataset.id;
  if (cmpSel.has(id)) cmpSel.delete(id); else if (cmpSel.size < 6) cmpSel.add(id);
  render();
};
for (const d of ['detail', 'form-dlg', 'cmp-dlg'])
  $(d).addEventListener('click', e => { if (e.target === $(d)) $(d).close(); });

document.fonts && document.fonts.ready.then(() => { segIdx = -1; tabPrev = null; placeSeg(); placeTabInk(); });
localAll().then(r => { items = r; render(); }).then(initCloud).then(ok => { if (!ok) $('account').hidden = true; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
