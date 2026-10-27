'use strict';
const $ = id => document.getElementById(id);
const DEFAULT_STORES = ['Lidl', 'Mercadona', 'Carrefour', 'Dia', 'Aldi', 'Alcampo'];
let items = [], filter = 'Todos', editing = null, photoData = null, score = null, view = 'tried', formStatus = 'tried', selTier = null, cmpOn = false, cmpSel = new Set(), cmpQ = '', cmpSort = 'none', viewer = null, shareCfg = null, tagFilter = null, lastList = [], tagMode = false, flashMsg = '';
let sortKey = (() => { try { return localStorage.getItem('sortKey') || 'new'; } catch { return 'new'; } })();

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
const save = async o => { if (useCloud()) { await col().doc(o.id).set(o); mirrorSet(o); } else await localSave(o); };
const remove = async id => { if (useCloud()) { await col().doc(id).delete(); mirrorDel(id); } else await localRemove(id); };

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

async function fbInit(withAuth) {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg) throw new Error('nocfg');
  for (const f of withAuth ? ['app', 'auth', 'firestore'] : ['app', 'firestore'])
    await loadScript(`https://www.gstatic.com/firebasejs/10.12.2/firebase-${f}-compat.js`);
  if (!firebase.apps.length) firebase.initializeApp(cfg);
}
async function initCloud() {
  try {
    await fbInit(true);
    cloud = { auth: firebase.auth(), db: firebase.firestore(), user: null };
    cloud.db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    cloud.auth.onAuthStateChanged(async u => {
      cloud.user = u;
      updateAccount();
      if (u) { $('auth-dlg').open && $('auth-dlg').close(); await migrateLocal(); await loadShareCfg(); }
      else { shareCfg = null; if (!sessionStorage.getItem('nocloud')) $('auth-dlg').showModal(); }
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

// --- etiquetas y orden ---
const pnameOf = p => p.name || p.brand || '';
const nl = (x, y, dir) => (x == null) - (y == null) || (x == null ? 0 : dir * (x - y));
const byTag = (a, b) => (!a.tag) - (!b.tag) || (a.tag || '').localeCompare(b.tag || '', 'es');
const SORT_FN = {
  new: (a, b) => b.created - a.created,
  old: (a, b) => a.created - b.created,
  score: (a, b) => nl(scoreOf(a), scoreOf(b), -1) || b.created - a.created,
  'score-asc': (a, b) => nl(scoreOf(a), scoreOf(b), 1) || b.created - a.created,
  price: (a, b) => nl(a.price, b.price, 1) || b.created - a.created,
  'price-desc': (a, b) => nl(a.price, b.price, -1) || b.created - a.created,
  unit: (a, b) => nl(a.unitPrice, b.unitPrice, 1) || b.created - a.created,
  tag: (a, b) => byTag(a, b) || b.created - a.created,
  name: (a, b) => pnameOf(a).localeCompare(pnameOf(b), 'es'),
};
const SORT_OPTS = [['new', 'Más recientes', 'Recientes'], ['old', 'Más antiguos', 'Antiguos'], ['score', 'Mejor valorados', 'Mejor nota'],
  ['score-asc', 'Peor valorados', 'Peor nota'], ['price', 'Precio: de menor a mayor', 'Más barato'], ['price-desc', 'Precio: de mayor a menor', 'Más caro'],
  ['unit', 'Precio por kg o litro', 'Por kg o litro'], ['tag', 'Etiqueta (agrupado)', 'Etiqueta'], ['name', 'Nombre A-Z', 'A-Z']];
const canonTag = t => {
  t = String(t || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const known = allTags().find(x => norm(x.tag) === norm(t));
  return known ? known.tag : t;
};
function allTags() {
  const m = new Map();
  for (const i of items) if (i.tag) m.set(i.tag, (m.get(i.tag) || 0) + 1);
  return [...m].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, 'es'));
}
const tagChips = () => {
  const tags = allTags();
  return [['', 'Todas'], ...tags.map(t => [t.tag, t.tag]), ['\0', 'Sin etiqueta']].map(([v, l]) => {
    const on = v === '' ? tagFilter == null : tagFilter === (v === '\0' ? '' : v);
    return `<button type="button" class="tagchip ${on ? 'on' : ''}" data-t="${esc(v)}" aria-pressed="${on}">${esc(l)}</button>`;
  }).join('');
};
const setTagFilter = v => { tagFilter = v === '' ? null : v === '\0' ? '' : v; };
function paintSort() {
  $('so-opts').innerHTML = SORT_OPTS.map(([k, l]) =>
    `<button type="button" class="opt ${k === sortKey ? 'on' : ''}" data-k="${k}" aria-pressed="${k === sortKey}"><span>${l}</span><i aria-hidden="true">✓</i></button>`).join('');
  $('so-tags').innerHTML = allTags().length ? tagChips() : '<p class="muted">Aún no has creado etiquetas. Ponle una a un producto desde su formulario.</p>';
}
// barra de etiquetas del comparador y de la tierlist
function paintTagBar() {
  const show = (cmpOn || view === 'tier') && (allTags().length > 0 || (cmpOn && tagMode && lastList.length)) && !viewer?.error;
  $('tag-bar').hidden = !show;
  if (!show) return;
  const max = 6, n = lastList.length;
  const all = cmpOn && (tagMode ? n >= 1 : tagFilter != null && n >= 2)
    ? `<button type="button" class="tagchip pickall" data-all="1">✓ Elegir ${tagMode ? `los ${n} visibles` : n > max ? `los ${max} primeros de ${n}` : `los ${n}`}</button>` : '';
  $('tag-bar').innerHTML = `<span class="tb-lbl">Etiqueta</span>${tagChips()}${all}`;
}
$('tag-bar').onclick = e => {
  const b = e.target.closest('.tagchip'); if (!b) return;
  if (b.dataset.all) { lastList.slice(0, tagMode ? lastList.length : 6).forEach(i => cmpSel.add(i.id)); return render(); }
  setTagFilter(b.dataset.t); render();
};
$('sort-btn').onclick = () => { paintSort(); $('sort-dlg').showModal(); };
$('so-close').onclick = () => $('sort-dlg').close();
$('so-opts').onclick = e => {
  const b = e.target.closest('.opt'); if (!b) return;
  sortKey = b.dataset.k; try { localStorage.setItem('sortKey', sortKey); } catch {}
  $('sort-dlg').close(); render();
};
$('so-tags').onclick = e => {
  const b = e.target.closest('.tagchip'); if (!b) return;
  setTagFilter(b.dataset.t); $('sort-dlg').close(); render();
};
function paintFormTags() {
  const cur = norm($('f-tag').value);
  $('f-tagchips').innerHTML = allTags().slice(0, 12).map(t =>
    `<button type="button" class="tagchip ${norm(t.tag) === cur ? 'on' : ''}" data-t="${esc(t.tag)}">${esc(t.tag)}</button>`).join('');
  $('tags').innerHTML = allTags().map(t => `<option value="${esc(t.tag)}">`).join('');
}
$('f-tagchips').onclick = e => {
  const b = e.target.closest('.tagchip'); if (!b) return;
  $('f-tag').value = norm($('f-tag').value) === norm(b.dataset.t) ? '' : b.dataset.t; paintFormTags();
};
$('f-tag').oninput = paintFormTags;
// nombre de la tierlist según el filtro (para el título y la imagen)
function tierName() {
  const t = tagFilter ? ` de ${tagFilter}` : tagFilter === '' ? ' sin etiqueta' : '';
  return `tierlist${t}${filter !== 'Todos' ? (t ? ` en ${filter}` : ` de ${filter}`) : ''}`;
}

// --- render ---
const unitLine = i => i.unitPrice ? `${eur(i.unitPrice)}/${i.unit === 'litro' ? 'l' : i.unit}` : '';
const priceNum = n => Number(n).toFixed(2).replace('.', ',');
const isWant = i => i.status === 'want';
const imgOf = i => i.photo || i.photoUrl || '';
let lastHideWant = null;
function renderViewerChrome() {
  const v = !!viewer;
  document.body.classList.toggle('viewer', v);
  $('brand').textContent = viewer?.name ? `Lista de ${viewer.name}` : 'Mi súper';
  $('account').hidden = v || !cloud;
  $('viewer-bar').hidden = !v;
  $('viewer-note').textContent = viewer?.error ? '' : viewer?.loading ? 'Cargando…' : `Estás viendo la lista de ${viewer?.name || 'un amigo'}. Es solo de lectura.`;
  const hideWant = v && !viewer.wants;
  if (hideWant !== lastHideWant) { lastHideWant = hideWant; segIdx = -1; }
  document.querySelector('.seg button[data-v="want"]').hidden = hideWant;
  if (hideWant && view === 'want') view = 'tried';
}
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
  if (cmpOn && (tagMode ? view === 'tier' : view !== 'tried')) cmpOn = false;
  if (!cmpOn) tagMode = false;
  renderViewerChrome();
  const want = view === 'want', tierView = view === 'tier';
  let list = items.filter(i => isWant(i) === want && (filter === 'Todos' || i.store === filter))
    ;
  if (tagFilter != null) list = list.filter(i => (i.tag || '') === tagFilter);
  list.sort(SORT_FN[sortKey] || SORT_FN.new);
  if (cmpOn && cmpQ) list = list.filter(i => norm(`${i.name} ${i.brand} ${i.store}`).includes(norm(cmpQ)));
  lastList = list;
  $('title').textContent = want ? 'Quiero probar' : tierView ? tierName().replace(/^t/, 'T') : (filter === 'Todos' ? 'Mis productos' : filter);
  $('count').textContent = list.length
    ? `${list.length === 1 ? '1 producto' : list.length + ' productos'}${want && filter !== 'Todos' ? ' en ' + filter : ''}${tagFilter != null ? (tagFilter ? ` con la etiqueta ${tagFilter}` : ' sin etiqueta') : ''}` : '';
  if (flashMsg) $('count').textContent = flashMsg;
  const gcount = {};
  if (sortKey === 'tag') for (const i of list) gcount[i.tag || ''] = (gcount[i.tag || ''] || 0) + 1;
  let lastGrp = null;
  $('grid').innerHTML = list.map(i => {
    let head = '';
    if (sortKey === 'tag' && (i.tag || '') !== lastGrp) { lastGrp = i.tag || ''; head = `<h3 class="grp">${esc(lastGrp || 'Sin etiqueta')}<small>${gcount[lastGrp]}</small></h3>`; }
    const sub2 = filter === 'Todos' ? (i.brand ? `${i.brand} en ${i.store}` : `En ${i.store}`) : i.brand;
    const img = imgOf(i);
    const picked = cmpOn && cmpSel.has(i.id);
    return head + `
    <button class="card ${cmpOn ? 'pick' : ''} ${picked ? 'picked' : ''}" data-id="${i.id}" ${cmpOn ? `aria-pressed="${picked}"` : ''}>
      <span class="ph">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<span class="noimg">Sin foto</span>'}
        ${cmpOn ? '<span class="chk" aria-hidden="true">✓</span>' : ''}
        ${i.price != null ? `<span class="tag"><b>${priceNum(i.price)}<em>€</em></b>${unitLine(i) ? `<small>${unitLine(i)}</small>` : ''}</span>` : ''}</span>
      <span class="nm">${esc(i.name || i.brand || 'Producto')}</span>
      ${sub2 ? `<span class="br">${esc(sub2)}</span>` : ''}
      ${i.tag ? `<span class="tg">${esc(i.tag)}</span>` : ''}
      ${scoreOf(i) != null ? `<span class="score" aria-label="Puntuación ${fmtScore(scoreOf(i))} de 10">${scoreHtml(scoreOf(i))}</span>` : ''}
    </button>`;
  }).join('');
  if (tierView) $('grid').innerHTML = '';
  $('empty').hidden = list.length > 0;
  if (viewer?.error) { $('empty').hidden = false; }
  $('empty').textContent = viewer?.error ? 'Este enlace no está disponible o su dueño ya no comparte la lista.' : viewer?.loading ? 'Abriendo la lista…' : tierView
    ? 'Primero guarda productos en Me gustaron. Luego los ordenas aquí.'
    : tagFilter != null && items.length ? 'No hay productos con esa etiqueta aquí. Cambia el filtro en Ordenar.'
    : want
    ? 'Aquí apuntas lo que quieres probar. Pulsa + y hazle una foto cuando lo veas en el súper.'
    : items.some(i => !isWant(i))
      ? `Todavía no hay nada en ${filter}. Pulsa + y hazle una foto al primero.`
      : 'Aún no hay productos. Pulsa + y hazle una foto al primero que te guste.';
  $('stores').innerHTML = stores().map(s => `<option value="${esc(s)}">`).join('');
  $('sug').hidden = !want || !!viewer;
  const nTried = items.filter(i => !isWant(i)).length;
  $('cmp-start').hidden = !(view === 'tried' && !cmpOn && nTried >= 2 && !viewer?.error);
  $('share-btn').hidden = !!viewer || cmpOn;
  $('tag-start').hidden = !((view === 'tried' || view === 'want') && !cmpOn && items.length && !viewer);
  $('sort-btn').hidden = cmpOn || !!viewer?.error || !items.length;
  $('sort-lbl').textContent = 'Ordenar: ' + SORT_OPTS.find(o => o[0] === sortKey)[2];
  $('sort-btn').classList.toggle('filtered', tagFilter != null);
  $('map-btn').hidden = filter === 'Todos' || cmpOn || !!viewer?.error;
  $('cmp-q').hidden = !cmpOn; $('cmp-bar').hidden = !cmpOn; $('add').hidden = cmpOn || !!viewer;
  if (cmpOn) {
    $('count').textContent = tagMode ? 'Elige los productos a los que poner etiqueta' : 'Elige de 2 a 6 productos para compararlos';
    const n = [...cmpSel].filter(id => items.some(i => i.id === id)).length;
    $('cmp-n').textContent = n === 1 ? '1 elegido' : `${n} elegidos`;
    $('cmp-go').disabled = n < (tagMode ? 1 : 2);
    $('cmp-go').textContent = tagMode ? 'Poner etiqueta' : 'Comparar';
  }
  paintTagBar();
  $('tiers').hidden = !tierView;
  if (tierView) renderTiers(list);
  if (want && !viewer) loadSuggestions(false);
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }


// --- historial de precios ---
const histOf = i => i?.history?.length ? i.history
  : i && i.price != null ? [{ d: i.created || Date.now(), p: i.price, u: i.unitPrice ?? null }] : [];
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function historyWith(item, price, unitPrice) {
  const h = histOf(item).map(x => ({ ...x }));
  if (price == null) return h;
  const last = h[h.length - 1], u = unitPrice ?? null;
  if (last && last.p === price && (last.u ?? null) === u) return h;
  const now = Date.now(), pt = { d: now, p: price, u };
  if (last && sameDay(last.d, now)) h[h.length - 1] = pt; else h.push(pt);
  return h;
}
const fmtDate = d => new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDelta = n => `${n > 0 ? '▲ +' : n < 0 ? '▼ −' : ''}${eur(Math.abs(n))}`;
function renderHist(i) {
  const h = histOf(i), box = $('d-hist');
  box.hidden = h.length === 0;
  if (!h.length) return;
  const last = h[h.length - 1], prev = h[h.length - 2];
  let sum = h.length === 1 ? `Precio anotado el ${fmtDate(last.d)}.` : '';
  if (prev) {
    const dlt = Math.round((last.p - prev.p) * 100) / 100;
    sum = dlt === 0 ? `Sigue en ${eur(last.p)} desde el ${fmtDate(prev.d)}.`
      : `${dlt > 0 ? 'Ha subido' : 'Ha bajado'} ${eur(Math.abs(dlt))} desde el ${fmtDate(prev.d)} (de ${eur(prev.p)} a ${eur(last.p)}).`;
  }
  const ps = h.map(x => x.p), min = Math.min(...ps), max = Math.max(...ps);
  let chart = '';
  if (h.length >= 2) {
    const W = 300, H = 84, px = 14, py = 18, sx = k => px + (W - 2 * px) * k / (h.length - 1);
    const sy = v => max === min ? H / 2 : H - py - (H - 2 * py) * (v - min) / (max - min);
    const pts = h.map((x, k) => `${sx(k).toFixed(1)},${sy(x.p).toFixed(1)}`);
    const lx = sx(h.length - 1), ly = sy(last.p);
    chart = `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución del precio">
      <polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${h.slice(0, -1).map((x, k) => `<circle cx="${sx(k).toFixed(1)}" cy="${sy(x.p).toFixed(1)}" r="3.5" fill="currentColor"/>`).join('')}
      <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="6" fill="var(--tag)" stroke="currentColor" stroke-width="2.5"/>
      <text x="${px}" y="${sy(h[0].p) - 8}" font-size="12" fill="currentColor" font-weight="700">${priceNum(h[0].p)}</text>
      <text x="${lx}" y="${ly - 11}" font-size="12" fill="currentColor" font-weight="700" text-anchor="end">${priceNum(last.p)}</text>
    </svg>`;
  }
  const rows = h.map((x, k) => ({ x, dl: k ? Math.round((x.p - h[k - 1].p) * 100) / 100 : null })).reverse().slice(0, 8);
  box.innerHTML = `<h3>Historial de precios</h3><p class="hsum">${esc(sum)}</p>${chart}
    ${h.length >= 2 ? `<p class="hmm">Más barato: ${eur(min)}. Más caro: ${eur(max)}.</p>` : ''}
    <ul class="hlist">${rows.map(({ x, dl }) => `<li><span>${fmtDate(x.d)}</span><b>${eur(x.p)}</b>${dl == null ? '<em></em>' : `<em class="${dl > 0 ? 'up' : dl < 0 ? 'down' : ''}">${dl === 0 ? 'igual' : fmtDelta(dl)}</em>`}</li>`).join('')}</ul>`;
}
$('d-newprice').onclick = () => {
  const i = editing; if (!i) return;
  $('pr-for').textContent = i.name || i.brand || 'Producto';
  $('pr-price').value = ''; $('pr-unit').value = '';
  $('pr-unit-lbl').textContent = `Precio por ${i.unit === 'litro' ? 'litro' : 'kg'} (opcional)`;
  $('price-dlg').showModal();
};
$('pr-cancel').onclick = () => $('price-dlg').close();
$('price-form').onsubmit = async e => {
  e.preventDefault();
  const i = editing, price = Number($('pr-price').value);
  const u = $('pr-unit').value === '' ? (i.unitPrice ?? null) : Number($('pr-unit').value);
  const o = { ...i, price, unitPrice: u, history: historyWith(i, price, u) };
  await save(o); items = await loadAll();
  $('price-dlg').close(); render(); openDetail(o.id);
};

// --- detail ---
function openDetail(id) {
  const i = items.find(x => x.id === id); if (!i) return;
  editing = i;
  $('d-img').src = imgOf(i);
  $('d-name').textContent = i.name || i.brand || 'Producto';
  $('d-meta').textContent = i.name && i.brand ? `${i.brand} en ${i.store}` : `En ${i.store}`;
  $('d-etiq').hidden = !i.tag; $('d-etiq').textContent = i.tag || '';
  $('d-stars').innerHTML = scoreHtml(scoreOf(i));
  $('d-stars').hidden = scoreOf(i) == null;
  $('d-tag').hidden = i.price == null;
  $('d-price').innerHTML = i.price == null ? '' : `${priceNum(i.price)}<em>€</em>`;
  $('d-unit').textContent = unitLine(i);
  $('d-note').textContent = i.note || '';
  renderHist(i);
  $('d-newprice').hidden = !!viewer;
  $('d-tried').hidden = !isWant(i) || !!viewer;
  $('d-edit').parentElement.hidden = !!viewer;
  $('detail').showModal();
}

// --- form ---
const NO_STORE = 'Sin súper';
function setFormStatus(st) {
  formStatus = st;
  const want = st === 'want';
  $('f-title').textContent = want ? (editing && isWant(editing) ? 'Editar pendiente' : 'Quiero probar') : (editing && isWant(editing) ? 'Ya lo probé' : editing ? 'Editar producto' : 'Nuevo producto');
  $('f-rate').hidden = want;
  $('f-note').placeholder = want ? 'Por qué quieres probarlo, quién te lo recomendó…' : 'Muy salado, sabor fuerte, repetiría…';
  $('f-store').required = !want;
  $('f-store').placeholder = want ? 'Opcional si aún no sabes dónde' : 'Lidl, Mercadona…';
  document.querySelectorAll('#f-status button').forEach(b => {
    const on = b.dataset.st === st; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  });
}
function openForm(i, status) {
  editing = i || null; photoData = i ? i.photo : null;
  setScore(i && !isWant(i) ? scoreOf(i) : null);
  setFormStatus(status || i?.status || 'tried');
  $('f-store').value = i ? (i.store === NO_STORE ? '' : i.store) : (filter !== 'Todos' && filter !== NO_STORE ? filter : '');
  $('f-brand').value = i?.brand || ''; $('f-name').value = i?.name || '';
  $('f-tag').value = i?.tag || ''; paintFormTags();
  $('f-price').value = i?.price ?? ''; $('f-unitprice').value = i?.unitPrice ?? '';
  $('f-unit').value = i?.unit || 'kg'; $('f-note').value = i?.note || '';
  const shown = i ? imgOf(i) : '';
  $('f-preview').src = shown; $('f-preview').hidden = !shown;
  $('f-photo-hint').hidden = !!shown;
  $('form-dlg').showModal();
}
$('f-status').onclick = e => { const b = e.target.closest('button'); if (b) setFormStatus(b.dataset.st); };
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
    store: $('f-store').value.trim() || NO_STORE, brand: $('f-brand').value.trim(),
    name: $('f-name').value.trim(), tag: canonTag($('f-tag').value), price: num($('f-price').value),
    unitPrice: num($('f-unitprice').value), unit: $('f-unit').value, note: $('f-note').value.trim(),
    score: want ? null : score,
  };
  if (o.cat === undefined) delete o.cat;
  o.history = historyWith(editing, o.price, o.unitPrice);
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

function knownNames() {
  const k = new Set();
  for (const i of items) { k.add(norm(i.name)); k.add(norm(`${i.brand} ${i.name}`)); }
  k.delete('');
  return k;
}
const first = v => Array.isArray(v) ? String(v[0] || '') : String(v || '');
const normProd = p => ({
  code: String(p.code || ''), name: first(p.product_name).trim(), brand: first(p.brands).split(',')[0].trim(),
  img: [p.image_front_small_url, p.image_small_url, p.image_front_url, p.image_url].map(first).find(u => /^https?:/.test(u)) || '',
  store: first(p.stores).split(',')[0].trim(),
});
const fail = (src, status) => { const e = new Error(src); e.src = src; e.status = status; return e; };
// 1) buscador nuevo de Open Food Facts (búsqueda por texto, pensado para webs)
async function saSearch(term) {
  const q = `"${term}" countries_tags:"en:spain"${filter !== 'Todos' ? ` stores_tags:"${storeTag(filter)}"` : ''}`;
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&langs=es,en&page_size=30&fields=code,product_name,brands,image_front_small_url,image_small_url,image_front_url,stores`;
  let r; try { r = await fetch(url); } catch { throw fail('buscador nuevo', 0); }
  if (!r.ok) throw fail('buscador nuevo', r.status);
  return ((await r.json()).hits || []).map(normProd);
}
// 2) filtro por categoría de la API clásica
async function offSearch(param, term) {
  const url = `${OFF}/api/v2/search?${param}=${encodeURIComponent(term)}${filter !== 'Todos' ? '&stores_tags=' + storeTag(filter) : ''}&sort_by=popularity_key&page_size=30&fields=code,product_name,brands,image_front_small_url,stores`;
  let r; try { r = await fetch(url); } catch { throw fail('API clásica', 0); }
  if (!r.ok) throw fail('API clásica', r.status);
  return ((await r.json()).products || []).map(normProd);
}
const errText = es => [...new Map(es.map(e => [e.src, e])).values()]
  .map(e => `${e.src}: ${e.status ? 'error ' + e.status : 'sin respuesta (sin conexión o bloqueado por el navegador)'}`).join('; ');
async function loadSuggestions(force) {
  const liked = items.filter(i => !isWant(i) && scoreOf(i) >= 8)
    .sort((a, b) => scoreOf(b) - scoreOf(a) || b.created - a.created);
  const wants = items.filter(i => isWant(i)).sort((a, b) => b.created - a.created);
  // categorías = etiquetas de tus favoritos y, después, de lo que quieres probar (hasta 3 distintas)
  const seeds = [];
  for (const it of [...liked, ...wants]) if (it.tag && !seeds.some(s => norm(s.tag) === norm(it.tag))) seeds.push({ tag: it.tag, from: it.name || it.brand });
  seeds.splice(3);
  if (!seeds.length) { sugState = { status: liked.length || wants.length ? 'notag' : 'empty', list: [], key: '' }; return paintSug(); }
  const key = seeds.map(s => norm(s.tag)).join(',') + '|' + filter;
  if (!force && sugState.key === key) return paintSug();
  const cached = force ? null : readCache(key);
  if (cached) { sugState = { key, status: 'done', list: cached, seeds }; return paintSug(); }
  if (sugBusy) return;
  sugBusy = true; sugState = { key, status: 'loading', list: [], seeds }; paintSug();
  try {
  const known = knownNames(), seen = new Set(), list = [];
  let failed = 0; const errs = [];
  for (const sd of seeds) {
    let prods = null;
    for (const [fn, label] of [[() => saSearch(sd.tag)], [() => offSearch('categories_tags_es', sd.tag)], [() => offSearch('categories_tags_en', sd.tag)]]) {
      try { await sleep(500); const r = await fn(); prods = r; if (r.length) break; } catch (e) { errs.push(e); }
    }
    if (prods === null) { failed++; continue; }
    let n = 0;
    for (const p of prods) {
      if (!p.name || !p.code || seen.has(p.code)) continue;
      if (known.has(norm(p.name)) || known.has(norm(`${p.brand} ${p.name}`))) continue;
      seen.add(p.code);
      list.push({ code: p.code, name: p.name, brand: p.brand, img: p.img, store: p.store, from: sd.from });
      if (++n >= 6) break;
    }
  }
  if (failed === seeds.length) {
    sugState = { key, status: 'error', list: [], seeds, detail: errText(errs) };
  } else { writeCache(key, list); sugState = { key, status: 'done', list, seeds }; }
  } catch (e) { sugState = { key, status: 'error', list: [], seeds, detail: 'fallo inesperado: ' + e.message }; }
  sugBusy = false; paintSug();
}
function paintSug() {
  if (view !== 'want') return;
  const s = sugState, known = knownNames();
  const list = s.list.filter(x => !known.has(norm(x.name)) && !known.has(norm(`${x.brand} ${x.name}`)));
  const tags = (s.seeds || []).map(x => x.tag).join(', ');
  const msg = {
    empty: 'Guarda productos que te gusten o que quieras probar, con su etiqueta, y aquí saldrán ideas parecidas.',
    notag: 'Ponle una etiqueta (pizza, yogur, helado…) a lo que más te gusta o a lo que quieres probar: así busco otros parecidos.',
    loading: 'Buscando productos parecidos…',
    error: `No se pudieron cargar las sugerencias (${s.detail || 'error desconocido'}). Pulsa «Buscar otras» para reintentarlo.`,
    done: list.length ? `Según tus etiquetas: ${tags}.` : (filter === 'Todos' ? `No encontré productos nuevos para: ${tags}. Puede que Open Food Facts no tenga esa categoría con ese nombre.` : `Open Food Facts no tiene productos de ${filter} para: ${tags}. Prueba con Todos.`),
    idle: '',
  }[s.status] || '';
  $('sug-msg').textContent = msg;
  $('sug-refresh').hidden = !['done', 'error'].includes(s.status);
  $('sug-list').innerHTML = list.map(x => `
    <div class="card sug">
      <span class="ph">${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy">` : '<span class="noimg">Sin foto</span>'}</span>
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
    return `<button class="tchip ${i.id === selTier ? 'sel' : ''}" data-id="${i.id}" draggable="${!viewer}" title="${esc(n)}" aria-label="${esc(n)}" aria-pressed="${i.id === selTier}">${img ? `<img src="${esc(img)}" alt="" draggable="false">` : `<span>${esc(initials(i))}</span>`}</button>`;
  };
  const row = (t, color, label) => `<div class="trow" data-t="${t}"><div class="tlabel" style="background:${color}">${label}</div><div class="tcells">${list.filter(i => (i.tier || '') === t).map(chip).join('')}</div></div>`;
  $('tier-rows').innerHTML = TIERS.map(([t, c]) => row(t, c, t)).join('') + row('', 'var(--line)', '?');
  const sel = list.find(i => i.id === selTier);
  $('tier-hint').textContent = viewer ? `Así tiene ${viewer.name || 'tu amigo'} su tierlist.` : sel ? `«${sel.name || sel.brand}»: toca la fila donde ponerlo.` : list.length ? 'Toca un producto y luego la fila donde ponerlo. La fila ? lo deja sin clasificar.' : '';
  $('tier-save').hidden = !list.length;
}
async function placeTier(id, t) {
  if (viewer) return;
  const it = items.find(x => x.id === id); if (!it) return;
  it.tier = t || null; selTier = null;
  render();
  try { await save(it); } catch {}
}
$('tiers').onclick = e => {
  if (viewer) return;
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
  const list = items.filter(i => !isWant(i) && (filter === 'Todos' || i.store === filter) && (tagFilter == null || (i.tag || '') === tagFilter));
  const W = 1080, LBL = 150, S = 130, G = 10, per = Math.floor((W - LBL - G) / (S + G));
  const rows = TIERS.map(([t, c]) => [t, c, list.filter(i => i.tier === t)]);
  const heights = rows.map(([, , l]) => Math.max(150, Math.ceil(l.length / per) * (S + G) + G));
  const HEAD = 130, H = HEAD + heights.reduce((a, b) => a + b, 0) + 24;
  try { await document.fonts.load('800 80px "Barlow Condensed"'); } catch {}
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  x.fillStyle = '#131a22'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#fff'; x.font = '800 72px "Barlow Condensed", sans-serif'; x.textBaseline = 'middle';
  x.fillText(tagFilter == null && filter === 'Todos' ? 'Mi tierlist del súper' : `Mi ${tierName()}`, 30, HEAD / 2);
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
$('cmp-start').onclick = () => { tagMode = false; cmpOn = true; cmpSel.clear(); cmpQ = ''; $('cmp-q').value = ''; filter = 'Todos'; render(); };
$('cmp-cancel').onclick = () => { cmpOn = false; tagMode = false; cmpSel.clear(); render(); };
$('cmp-q').oninput = e => { cmpQ = e.target.value; render(); };
$('cmp-go').onclick = () => { if (tagMode) return openTagSet(); renderCompare(); $('cmp-dlg').showModal(); };
$('tag-start').onclick = () => { tagMode = true; cmpOn = true; cmpSel.clear(); cmpQ = ''; $('cmp-q').value = ''; render(); };
function openTagSet() {
  const n = [...cmpSel].filter(id => items.some(i => i.id === id)).length;
  $('ts-for').textContent = n === 1 ? 'Se la pondrás a 1 producto.' : `Se la pondrás a los ${n} productos elegidos.`;
  $('ts-tag').value = '';
  paintTagSet();
  $('tagset-dlg').showModal();
}
function paintTagSet() {
  const cur = norm($('ts-tag').value);
  $('ts-chips').innerHTML = allTags().slice(0, 14).map(t =>
    `<button type="button" class="tagchip ${norm(t.tag) === cur ? 'on' : ''}" data-t="${esc(t.tag)}">${esc(t.tag)}</button>`).join('');
  $('tags').innerHTML = allTags().map(t => `<option value="${esc(t.tag)}">`).join('');
}
$('ts-tag').oninput = paintTagSet;
$('ts-chips').onclick = e => { const b = e.target.closest('.tagchip'); if (b) { $('ts-tag').value = b.dataset.t; paintTagSet(); } };
$('ts-cancel').onclick = () => $('tagset-dlg').close();
async function applyTag(tag) {
  const sel = [...cmpSel].map(id => items.find(i => i.id === id)).filter(Boolean);
  if (!sel.length) return;
  for (const it of sel) await save({ ...it, tag });
  items = await loadAll();
  $('tagset-dlg').close();
  cmpOn = false; tagMode = false; cmpSel.clear();
  flashMsg = tag ? `${sel.length === 1 ? '1 producto etiquetado' : sel.length + ' productos etiquetados'} con «${tag}»` : `Etiqueta quitada a ${sel.length === 1 ? '1 producto' : sel.length + ' productos'}`;
  render();
  setTimeout(() => { flashMsg = ''; render(); }, 3500);
}
$('ts-go').onclick = () => {
  const t = canonTag($('ts-tag').value);
  if (!t) { $('ts-err').textContent = 'Escribe una etiqueta o toca una de las de abajo.'; return; }
  $('ts-err').textContent = ''; applyTag(t);
};
$('ts-clear').onclick = () => applyTag('');
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
  const btn = $('map-btn'), lbl = btn.querySelector('.lbl'), txt = lbl.textContent;
  const done = () => { btn.disabled = false; btn.classList.remove('busy'); lbl.textContent = txt; };
  btn.disabled = true; btn.classList.add('busy'); lbl.textContent = 'Localizando…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      done();
      const { latitude: la, longitude: lo } = pos.coords;
      go(`${base}${encodeURIComponent(store + ' supermercado')}/@${la.toFixed(5)},${lo.toFixed(5)},15z`);
    },
    () => { done(); go(plain); },
    { timeout: 8000, maximumAge: 300000 });
};

// --- compartir con amigos ---
const metaDoc = () => cloud.db.collection('users').doc(cloud.user.uid).collection('meta').doc('share');
const shareRef = id => cloud.db.collection('shares').doc(id);
const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 22);
async function loadShareCfg() {
  try { const d = await metaDoc().get(); shareCfg = d.exists && d.data().on ? d.data() : null; } catch { shareCfg = null; }
}
function shareDoc(o, cfg = shareCfg) {
  if (isWant(o) && !cfg.wants) return null;
  const c = { ...o }; delete c.cat;
  if (!cfg.notes) c.note = '';
  return c;
}
async function mirrorSet(o) {
  if (!shareCfg) return;
  try {
    const ref = shareRef(shareCfg.id).collection('products').doc(o.id), d = shareDoc(o);
    if (d) await ref.set(d); else await ref.delete();
  } catch {}
}
async function mirrorDel(id) {
  if (!shareCfg) return;
  try { await shareRef(shareCfg.id).collection('products').doc(id).delete(); } catch {}
}
async function syncShare(prefs) {
  const id = shareCfg?.id || newId();
  const cfg = { id, on: true, name: prefs.name, wants: prefs.wants, notes: prefs.notes };
  await shareRef(id).set({ owner: cloud.user.uid, name: cfg.name, wants: cfg.wants, notes: cfg.notes, updated: Date.now() });
  const pc = shareRef(id).collection('products');
  const existing = (await pc.get()).docs.map(d => d.id);
  const desired = new Map();
  for (const o of items) { const d = shareDoc(o, cfg); if (d) desired.set(o.id, d); }
  const ops = [...desired].map(([k, d]) => ['s', k, d]).concat(existing.filter(k => !desired.has(k)).map(k => ['d', k]));
  for (let i = 0; i < ops.length; i += 20) {
    const b = cloud.db.batch();
    ops.slice(i, i + 20).forEach(([t, k, d]) => t === 's' ? b.set(pc.doc(k), d) : b.delete(pc.doc(k)));
    await b.commit();
  }
  await metaDoc().set(cfg);
  shareCfg = cfg;
}
async function stopShare() {
  const id = shareCfg.id, pc = shareRef(id).collection('products');
  const docs = (await pc.get()).docs;
  for (let i = 0; i < docs.length; i += 20) {
    const b = cloud.db.batch(); docs.slice(i, i + 20).forEach(d => b.delete(d.ref)); await b.commit();
  }
  await shareRef(id).delete();
  await metaDoc().set({ on: false });
  shareCfg = null;
}
const SECTION_NAME = { tried: 'Me gustaron', want: 'Quiero probar', tier: 'Tierlist' };
const shareLink = () => `${location.origin}${location.pathname}?s=${shareCfg.id}&v=${view}`;
function paintShare() {
  const need = !cloud || !useCloud();
  $('sh-need').hidden = !need; $('sh-form').hidden = need;
  if (need) { $('sh-need').textContent = cloud ? 'Para compartir tu lista necesitas entrar con tu cuenta. Pulsa 👤 Entrar arriba.' : 'La nube no está activada en esta app, así que no se puede compartir.'; return; }
  const on = !!shareCfg;
  $('sh-name').value = shareCfg?.name || $('sh-name').value || (cloud.user.email || '').split('@')[0];
  $('sh-want').checked = shareCfg ? shareCfg.wants : $('sh-want').checked;
  $('sh-notes').checked = shareCfg ? shareCfg.notes : $('sh-notes').checked;
  $('sh-go').textContent = on ? 'Guardar cambios' : 'Crear enlace';
  $('sh-live').hidden = !on;
  if (on) {
    $('sh-link').value = shareLink();
    $('sh-opens').textContent = `El enlace abre en «${SECTION_NAME[view]}».`;
    $('sh-send').hidden = !navigator.share;
  }
  $('sh-err').textContent = '';
}
$('share-btn').onclick = () => { paintShare(); $('share-dlg').showModal(); };
$('sh-close').onclick = () => $('share-dlg').close();
$('sh-go').onclick = async () => {
  const name = $('sh-name').value.trim();
  if (!name) { $('sh-err').textContent = 'Escribe cómo quieres que te vean tus amigos.'; return; }
  const b = $('sh-go'), txt = b.textContent; b.disabled = true; b.textContent = 'Guardando…';
  try { await syncShare({ name, wants: $('sh-want').checked, notes: $('sh-notes').checked }); paintShare(); }
  catch (e) { $('sh-err').textContent = /permission/i.test(e.message) ? 'Falta actualizar las reglas de Firestore (mira SETUP-NUBE.md).' : 'No se pudo compartir. Comprueba la conexión.'; }
  b.disabled = false; b.textContent = shareCfg ? 'Guardar cambios' : txt;
};
$('sh-copy').onclick = async () => {
  const url = $('sh-link').value;
  try { await navigator.clipboard.writeText(url); }
  catch { $('sh-link').select(); document.execCommand('copy'); }
  $('sh-copy').textContent = '¡Copiado!'; setTimeout(() => { $('sh-copy').textContent = 'Copiar enlace'; }, 1600);
};
$('sh-send').onclick = () => navigator.share({ title: 'Mi lista del súper', text: `Mira mi lista de productos del súper, ${shareCfg.name}:`, url: $('sh-link').value }).catch(() => {});
$('sh-stop').onclick = async () => {
  if (!confirm('Tus amigos dejarán de ver tu lista y el enlace dejará de funcionar. ¿Dejar de compartir?')) return;
  try { await stopShare(); paintShare(); $('share-dlg').close(); } catch { $('sh-err').textContent = 'No se pudo parar. Inténtalo de nuevo.'; }
};

// --- ver la lista de un amigo ---
async function initViewer(id) {
  viewer = { loading: true }; render();
  const p = new URLSearchParams(location.search);
  try {
    await fbInit(false);
    const db = firebase.firestore();
    const meta = await db.collection('shares').doc(id).get();
    if (!meta.exists) throw new Error('gone');
    const m = meta.data();
    items = (await db.collection('shares').doc(id).collection('products').get()).docs.map(d => d.data());
    viewer = { id, name: m.name, wants: !!m.wants, notes: !!m.notes };
    const v = p.get('v');
    view = v === 'tier' || (v === 'want' && viewer.wants) ? v : 'tried';
    segIdx = -1;
  } catch { viewer = { error: true }; }
  render();
}
$('viewer-own').onclick = () => { location.href = location.origin + location.pathname; };

document.addEventListener('click', e => { const b = e.target.closest('button.act'); if (b) setTimeout(() => b.blur(), 0); });
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
  if (cmpSel.has(id)) cmpSel.delete(id); else if (tagMode || cmpSel.size < 6) cmpSel.add(id);
  render();
};
for (const d of ['detail', 'form-dlg', 'cmp-dlg', 'share-dlg', 'price-dlg', 'sort-dlg', 'tagset-dlg'])
  $(d).addEventListener('click', e => { if (e.target === $(d)) $(d).close(); });

document.fonts && document.fonts.ready.then(() => { segIdx = -1; tabPrev = null; placeSeg(); placeTabInk(); });
const shareParam = new URLSearchParams(location.search).get('s');
if (shareParam) initViewer(shareParam);
else localAll().then(r => { items = r; render(); }).then(initCloud).then(ok => { if (!ok) $('account').hidden = true; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
