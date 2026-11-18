// AI in School: A Teacher's Guide — newsletter library
// Content is encrypted with the staff password; release state lives in Firestore (ergs-live project).
// Firebase loads on demand, so the library still opens if Firebase is unreachable (releases then fall back to defaults).
let initializeApp, getFirestore, doc, collection, onSnapshot, setDoc, getDoc, deleteDoc, serverTimestamp, getAuth, onAuthStateChanged, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut;
async function loadFirebase() {
  const V = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const [a, f, u] = await Promise.all([import(V + 'firebase-app.js'), import(V + 'firebase-firestore.js'), import(V + 'firebase-auth.js')]);
  ({ initializeApp } = a); ({ getFirestore, doc, collection, onSnapshot, setDoc, getDoc, deleteDoc, serverTimestamp } = f);
  ({ getAuth, onAuthStateChanged, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut } = u);
}

const C = window.NL_CONFIG;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const START_HREF = location.href;
const LS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const SS = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }, del(k) { try { sessionStorage.removeItem(k); } catch (e) {} } };
const THEMES = ['Getting Started', 'Planning', 'Assessment & Feedback', 'Inclusion', 'Admin & Communication', 'Leadership & Data', 'Tools & Platforms', 'Pupil AI Literacy'];
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- crypto ---------- */
const b64e = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
let KEY = null;
async function deriveKey(pw) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(C.salt), iterations: C.iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
const importRaw = raw => crypto.subtle.importKey('raw', b64d(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
async function dec(u8) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12) }, KEY, u8.subarray(12))); }
async function enc(u8) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, KEY, u8)); const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out; }
const encJSON = async o => b64e(await enc(new TextEncoder().encode(JSON.stringify(o))));
const decJSON = async s => JSON.parse(new TextDecoder().decode(await dec(b64d(s))));
const imgCache = new Map();
function fileImg(path) {
  if (!imgCache.has(path)) imgCache.set(path, fetch(path).then(r => r.arrayBuffer()).then(b => dec(new Uint8Array(b))).then(u => URL.createObjectURL(new Blob([u], { type: 'image/jpeg' }))));
  return imgCache.get(path);
}

/* ---------- state ---------- */
let CONTENT = null, RELEASES = {}, CUSTOM = [], ADMIN = false, AUTHUSER = null, STAFFVIEW = false, DB = null, AUTH = null;
let filt = { q: '', theme: '', tool: '' };

function allIssues() {
  const o = CONTENT.orig.map(x => ({ ...x, id: 'w' + x.n, kind: 'img', imgs: ['img/w' + String(x.n).padStart(2, '0') + '.bin'], thumb: 'img/w' + String(x.n).padStart(2, '0') + '-t.bin', def: 'live' }));
  const b = CONTENT.bank.map(x => ({ ...x, id: 'b' + x.n, kind: 'img', imgs: Array.from({ length: x.pages || 2 }, (_, k) => `img/b${x.n}-${k + 1}.bin`), thumb: `img/b${x.n}-t.bin`, def: 'locked' }));
  // edits to built-in issues are stored as override documents (encrypted) and merged in here
  const ov = {}; CUSTOM.filter(x => x.overrides).forEach(x => { ov[x.overrides] = x; });
  const merge = base => {
    const x = ov[base.id]; if (!x) return base;
    const m = { ...base, edited: true, ovDocId: x.docId };
    for (const k of ['n', 'title', 'theme', 'summary', 'link']) if (x[k] !== undefined && x[k] !== '' && !(k === 'n' && !x[k])) m[k] = x[k];
    if (x.tools && x.tools.length) m.tools = x.tools;
    if (x.pageDocs && x.pageDocs.length) { m.imgs = undefined; m.pageDocs = x.pageDocs; m.fsPages = true; if (x.thumb) m.thumb = x.thumb; m.ovPages = x.pageDocs; }
    return m;
  };
  const c = CUSTOM.filter(x => !x.overrides).map(x => ({ ...x, custom: true, fsPages: true, def: 'locked' }));
  return [...o.map(merge), ...b.map(merge), ...c].sort((a, z) => a.n - z.n || String(a.id).localeCompare(z.id));
}
function status(i) {
  const r = RELEASES[i.id];
  if (!r || !r.s) return i.def;
  if (r.s === 'sched') return r.d && r.d <= today() ? 'live' : 'sched';
  return r.s;
}
const canManage = () => ADMIN && !STAFFVIEW;

/* ---------- gate ---------- */
async function tryKey() {
  try {
    const r = await fetch('content.enc', { cache: 'no-cache' });
    CONTENT = JSON.parse(new TextDecoder().decode(await dec(new Uint8Array(await r.arrayBuffer()))));
    return true;
  } catch (e) { return false; }
}
async function boot() {
  $('#gateCrest').src = $('#mastCrest').src = window.ERGS_CREST || '';
  const raw = LS.get('ergsNL.k') || SS.get('ergsNL.k');
  if (raw) { try { KEY = await importRaw(raw); if (await tryKey()) return start(); } catch (e) {} }
  $('#gate').hidden = false; $('#pw').focus();
}
$('#gateForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button'); btn.disabled = true; $('#gateErr').textContent = '';
  try {
    KEY = await deriveKey($('#pw').value.trim());
    if (!(await tryKey())) throw 0;
    const raw = b64e(new Uint8Array(await crypto.subtle.exportKey('raw', KEY)));
    LS.set('ergsNL.k', raw);   // enter it once – this device stays unlocked
    $('#gate').hidden = true; start();
  } catch (err) { $('#gateErr').textContent = 'That password isn’t right. Please try again.'; }
  btn.disabled = false;
});

/* ---------- firebase ---------- */
async function startFirebase() {
  try {
    await loadFirebase();
    const app = initializeApp(C.firebase); DB = getFirestore(app); AUTH = getAuth(app);
  } catch (e) { console.warn(e); return; }
  onSnapshot(doc(DB, 'newsletter', 'state'), s => { RELEASES = (s.exists() && s.data().releases) || {}; render(); }, e => console.warn('state', e));
  onSnapshot(collection(DB, 'newsletterIssues'), async s => {
    const out = [];
    for (const d of s.docs) { try { const x = await decJSON(d.data().enc); out.push({ ...x, id: 'c' + d.id, docId: d.id }); } catch (e) {} }
    CUSTOM = out; render();
  }, e => console.warn('issues', e));
  onAuthStateChanged(AUTH, u => {
    AUTHUSER = u;
    ADMIN = !!(u && u.email && C.admins.includes(u.email.toLowerCase()));
    render();
  });
  completeLink();
}
let LINK_MSG = '';
async function completeLink(emailTyped) {
  if (!isSignInWithEmailLink(AUTH, START_HREF)) return;
  const email = emailTyped || LS.get('ergsNL.linkEmail');
  if (!email) { LINK_MSG = 'confirm'; location.hash = 'admin'; render(); return; }
  try {
    await signInWithEmailLink(AUTH, email.toLowerCase(), START_HREF);
    LS.del('ergsNL.linkEmail'); LINK_MSG = '';
    history.replaceState(null, '', location.pathname + '#admin'); toast('Signed in – release desk unlocked');
  } catch (e) { LINK_MSG = /expired|invalid-action/.test(String(e.code)) ? 'expired' : 'failed'; }
  render();
}

/* ---------- rendering ---------- */
function start() {
  $('#app').hidden = false;
  buildChips();
  startFirebase();
  window.addEventListener('hashchange', route);
  route();
}
function route() { render(); window.scrollTo(0, 0); }
function render() {
  if (!CONTENT) return;
  if (location.hash === '#binder' && Binder.active) { Binder.refresh(); return; }
  const h = location.hash.slice(1);
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === (h === 'admin' ? 'admin' : h === 'binder' ? 'binder' : h.startsWith('issue-') ? '' : 'library')));
  $('#adminLink').textContent = ADMIN ? 'Release desk' : (innerWidth < 620 ? 'Admin' : 'Staff admin');
  $('#library').hidden = $('#reader').hidden = $('#admin').hidden = $('#binder').hidden = true;
  document.body.classList.toggle('binder-on', h === 'binder');
  if (h === 'admin') { $('#admin').hidden = false; renderAdmin(); }
  else if (h === 'binder') { $('#binder').hidden = false; Binder.open(); }
  else if (h.startsWith('issue-')) { $('#reader').hidden = false; renderReader(h.slice(6)); }
  else { $('#library').hidden = false; renderLibrary(); }
}
function buildChips() {
  const el = $('#themeChips');
  el.innerHTML = ['All', ...THEMES].map(t => `<button class="chip${t === 'All' ? ' on' : ''}" data-t="${esc(t === 'All' ? '' : t)}">${esc(t)}</button>`).join('');
  el.addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; filt.theme = b.dataset.t; el.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b)); renderLibrary(); });
  $('#q').addEventListener('input', e => { filt.q = e.target.value.toLowerCase(); renderLibrary(); });
  $('#toolSel').addEventListener('change', e => { filt.tool = e.target.value; renderLibrary(); });
}
function miniCover(i) {
  return `<div class="mini"><div class="mh"><small>AI in School</small><b>${esc(i.title)}</b><i>${i.n}</i></div><div class="kick">${esc(i.kicker || i.theme || '')}</div><div class="mb"><div><span style="height:34px"></span><span class="y" style="height:16px"></span><span style="height:12px"></span></div><div><span class="g" style="height:26px"></span><span style="height:22px"></span></div></div></div>`;
}
function coverHTML(i) {
  if (i.thumb && i.thumb.startsWith('data:')) return `<img alt="" src="${esc(i.thumb)}">`;
  if (i.thumb) return `<img alt="" data-src="${esc(i.thumb)}">`;
  return miniCover(i);
}
function hydrateImgs(root) {
  root.querySelectorAll('img[data-src]').forEach(img => fileImg(img.dataset.src).then(u => { img.src = u; img.removeAttribute('data-src'); }).catch(() => {}));
}
function matches(i) {
  if (filt.theme && i.theme !== filt.theme) return false;
  if (filt.tool && !(i.tools || []).includes(filt.tool)) return false;
  if (filt.q) { const hay = [i.title, i.summary, i.theme, i.kicker, (i.tools || []).join(' '), 'issue ' + i.n].join(' ').toLowerCase(); if (!hay.includes(filt.q)) return false; }
  return true;
}
function cardHTML(i) {
  const st = status(i), locked = st !== 'live', mg = canManage();
  const sched = RELEASES[i.id]?.d;
  const badge = st === 'live' ? (i === latestIssue() ? '<span class="badge">Latest</span>' : '') :
    st === 'sched' ? `<span class="badge sched">Out ${esc(fmtDate(sched))}</span>` : '<span class="badge locked">Locked</span>';
  const quick = mg ? `<button class="btn small quick" data-quick="${esc(i.id)}">${locked ? 'Release' : 'Lock'}</button>` : '';
  const tools = (i.tools || []).map(t => `<span class="tool ${esc(t)}">${esc(t)}</span>`).join('');
  const inner = `${badge}<div class="cover">${locked && !mg ? miniCover({ ...i, title: 'Coming soon', kicker: i.theme }) : coverHTML(i)}</div>
    <div class="meta"><span class="num">Issue ${i.n} · ${esc(i.theme || '')}</span><h3>${esc(i.title)}</h3>${locked && !mg ? '<p>Not released yet – watch this space.</p>' : `<p>${esc(i.summary || '')}</p>`}<div class="tools">${tools}</div></div>`;
  if (locked && !mg) return `<div class="card locked staff">${inner}</div>`;
  return `<a class="card${locked ? ' locked' : ''}" href="#issue-${esc(i.id)}">${inner}${quick}</a>`;
}
function latestIssue() { const live = allIssues().filter(i => status(i) === 'live'); return live[live.length - 1]; }
function fmtDate(d) { if (!d) return ''; const x = new Date(d + 'T12:00:00'); return x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }

function renderLibrary() {
  const all = allIssues(), live = all.filter(i => status(i) === 'live'), soon = all.filter(i => status(i) !== 'live' && status(i) !== 'removed');
  $('#stats').innerHTML = `<div class="stat"><b>${live.length}</b><span>issues to explore</span></div><div class="stat"><b>${new Set(live.map(i => i.theme)).size}</b><span>themes covered</span></div>` +
    (canManage() ? `<div class="stat"><b>${soon.length}</b><span>locked (only you see this)</span></div>` : `<div class="stat"><b>5</b><span>minutes to read</span></div>`);
  const L = latestIssue();
  $('#latest').hidden = !L;
  if (L) { $('#latest').href = '#issue-' + L.id; $('#latest').innerHTML = `<div class="cover">${coverHTML(L)}</div><div><span class="tag">Latest issue · Issue ${L.n}</span><h2>${esc(L.title)}</h2><p>${esc(L.summary || '')}</p></div>`; hydrateImgs($('#latest')); }
  const ab = $('#adminBar');
  ab.hidden = !ADMIN;
  if (ADMIN) {
    const next = soon[0];
    ab.innerHTML = STAFFVIEW ? `<b>Staff preview</b><span>You’re seeing exactly what staff see.</span><span class="spacer"></span><button class="btn small" id="svOff">Back to editor view</button>`
      : `<b>Editor view</b><span>Locked issues are shown greyed out – only you can open them.</span><span class="spacer"></span>${next ? `<button class="btn small primary" id="relNext">Release next: Issue ${next.n}</button>` : ''}<button class="btn small" id="svOn">Preview as staff</button><a class="btn small" href="#admin">Release desk</a>`;
    $('#svOff')?.addEventListener('click', () => { STAFFVIEW = false; render(); });
    $('#svOn')?.addEventListener('click', () => { STAFFVIEW = true; render(); });
    $('#relNext')?.addEventListener('click', () => setRelease(next.id, { s: 'live' }, `Issue ${next.n} released`));
  }
  const liveShown = live.filter(matches).reverse(), soonShown = canManage() ? soon.filter(matches) : [];   // staff never see what's still to come
  const g = $('#grid');
  g.innerHTML = liveShown.map(cardHTML).join('') + (soonShown.length ? `<h2 style="grid-column:1/-1;font:800 20px var(--head);color:var(--navy);margin:16px 0 0">Not yet released <small style="font:600 13px var(--body);color:var(--muted)">– only you can see these</small></h2>` + soonShown.map(cardHTML).join('') : '');
  $('#empty').hidden = liveShown.length + soonShown.length > 0;
  hydrateImgs(g);
  g.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    const i = all.find(x => x.id === b.dataset.quick); const lk = status(i) !== 'live';
    setRelease(i.id, { s: lk ? 'live' : 'locked' }, lk ? `Issue ${i.n} released` : `Issue ${i.n} locked`);
  }));
}

function list(a) { return (a || []).filter(Boolean).map(x => `<li>${esc(x)}</li>`).join(''); }
function tplHTML(i) {
  const paras = (Array.isArray(i.intro) ? i.intro : String(i.intro || '').split(/\n\s*\n/)).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('');
  const meta = [i.kicker, i.difficulty && 'Difficulty: ' + i.difficulty, i.read && 'Est. read time: ' + i.read, (i.tools || []).length && 'Tools: ' + i.tools.join(', ')].filter(Boolean).map(esc).join('<span class="sep">|</span>');
  return `<div class="sheet">
  <header class="nl-head"><h1>AI in School: A Teacher’s Guide</h1><p>Whole-School AI Skills CPD Portfolio | ${esc(i.title)}</p><span class="nl-issue">Issue ${i.n}</span></header>
  ${meta ? `<div class="nl-meta">${meta}</div>` : ''}
  <div class="nl-body">
    ${i.aim ? `<p class="nl-aim">${esc(i.aim)}</p>` : ''}
    <h2 class="nl-sec">${esc(i.title)}</h2>
    <div class="nl-cols">
      <div>
        <div class="box"><h4>How AI can help</h4>${paras}
          ${i.prompt ? `<div class="prompt"><h5>Try this prompt</h5><q>${esc(i.prompt)}</q><button class="btn small copy" data-copy>Copy</button></div>` : ''}
        </div>
        ${i.challenge ? `<p class="hand">Want to give it a go this week?</p><div class="challenge"><h4>Department challenge</h4><p>${esc(i.challenge)}</p></div>` : ''}
      </div>
      <aside>
        ${i.saved ? `<div class="saved"><h4>Estimated time saved</h4><b>${esc(i.saved)}</b><span>${esc(i.savedPer || '')}</span></div>` : ''}
        ${i.tip ? `<div class="box tip"><h4>Pro tip</h4><p>${esc(i.tip)}</p></div>` : ''}
        ${(i.ideas || []).length ? `<div class="box ideas"><h4>${esc(i.ideasTitle || 'Ideas to try')}</h4><ul>${list(i.ideas)}</ul></div>` : ''}
      </aside>
    </div>
    ${i.bad?.p || i.good?.p ? `<div class="vs">
      <div class="box bad"><h4>✗ Bad prompt</h4><p><i>“${esc(i.bad?.p)}”</i></p>${i.bad?.r ? `<div class="r"><b>Result:</b> ${esc(i.bad.r)}</div>` : ''}</div>
      <div class="box good"><h4>✓ Good prompt</h4><p><i>“${esc(i.good?.p)}”</i></p>${i.good?.r ? `<div class="r"><b>Result:</b> ${esc(i.good.r)}</div>` : ''}</div>
    </div>` : ''}
    ${(i.dos || []).length || (i.donts || []).length ? `<div class="dd"><div class="box do"><h4>Do</h4><ul>${list(i.dos)}</ul></div><div class="box dont"><h4>Don’t</h4><ul>${list(i.donts)}</ul></div></div>` : ''}
    ${i.link ? `<p><a class="extlink" href="${esc(i.link)}" target="_blank" rel="noopener">Open the linked resource ↗</a></p>` : ''}
  </div>
  ${i.key ? `<footer class="nl-key"><h4>Key message</h4><p>${esc(i.key)}</p></footer>` : ''}
</div>`;
}
async function customPageImg(docId) {
  const k = 'fs:' + docId;
  if (!imgCache.has(k)) imgCache.set(k, getDoc(doc(DB, 'newsletterImgs', docId)).then(async s => URL.createObjectURL(new Blob([await dec(b64d(s.data().data))], { type: 'image/jpeg' }))));
  return imgCache.get(k);
}
function renderReader(id) {
  const all = allIssues(), i = all.find(x => x.id === id);
  const sheet = $('#sheet');
  if (!i) { sheet.innerHTML = '<p class="empty">Issue not found – it may still be loading.</p>'; return; }
  const st = status(i);
  if (st !== 'live' && !canManage()) { sheet.innerHTML = '<div class="info"><h1>This issue isn’t available</h1><p>Have a look through the library for the latest issues.</p><a class="btn" href="#">Back to the library</a></div>'; $('#lockNote').hidden = true; return; }
  $('#lockNote').hidden = st === 'live';
  $('#lockNote').textContent = st === 'sched' ? `Preview – scheduled for release on ${fmtDate(RELEASES[i.id].d)}. Staff can’t see this yet.` : 'Preview – this issue is locked. Staff can’t see it yet.';
  const visible = all.filter(x => status(x) === 'live' || (canManage() && status(x) !== 'removed'));
  const idx = visible.indexOf(i);
  $('#prevBtn').disabled = idx <= 0; $('#nextBtn').disabled = idx >= visible.length - 1;
  $('#prevBtn').onclick = () => { location.hash = 'issue-' + visible[idx - 1].id; };
  $('#nextBtn').onclick = () => { location.hash = 'issue-' + visible[idx + 1].id; };
  $('#printBtn').onclick = () => window.print();
  $('#editIssueBtn').hidden = !canManage(); $('#editIssueBtn').onclick = () => startEdit(i);
  document.title = `Issue ${i.n}: ${i.title} · AI in School`;
  if (i.kind === 'tpl') sheet.innerHTML = tplHTML(i);
  else {
    const pages = i.imgs || (i.pageDocs || []);
    sheet.innerHTML = `<div class="info"><span class="num eyebrow">Issue ${i.n} · ${esc(i.theme || '')}</span><h1>${esc(i.title)}</h1><p class="muted" style="margin:0">${esc(i.summary || '')}</p>${i.link ? `<a class="extlink" href="${esc(i.link)}" target="_blank" rel="noopener">Open the linked resource ↗</a>` : ''}</div>` +
      pages.map((p, n) => `<img class="page-img" alt="Issue ${i.n} page ${n + 1}" data-p="${n}">`).join('');
    sheet.querySelectorAll('img[data-p]').forEach(img => {
      const p = pages[+img.dataset.p];
      (i.fsPages ? customPageImg(p) : fileImg(p)).then(u => { img.src = u; }).catch(() => { img.alt = 'Page could not be loaded'; });
    });
  }
  sheet.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.parentElement.querySelector('q').textContent); toast('Prompt copied'); } catch (e) { toast('Select the prompt text to copy it'); }
  }));
}

/* ---------- writes ---------- */
let writing = Promise.resolve();
function setRelease(id, val, msg) {
  if (!ADMIN) return;
  RELEASES = { ...RELEASES, [id]: val }; render();
  writing = writing.then(() => setDoc(doc(DB, 'newsletter', 'state'), { releases: { [id]: val }, updated: serverTimestamp() }, { merge: true }))
    .then(() => msg && toast(msg)).catch(e => { console.warn(e); toast('Couldn’t save – check you’re signed in'); });
}
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600); }

/* ---------- admin ---------- */
let editing = null, formKind = 'tpl', pendingPages = null, pendingThumb = null;
function startEdit(i) {
  if (!i) return;
  if (i.custom) editing = { ...CUSTOM.find(c => c.id === i.id) };
  else editing = { kind: 'img', baseId: i.id, docId: i.ovDocId, n: i.n, title: i.title, theme: i.theme, tools: i.tools, summary: i.summary, link: i.link, pageDocs: i.ovPages || [], thumb: i.ovPages ? i.thumb : '' };
  formKind = editing.kind; pendingPages = pendingThumb = null;
  if (location.hash !== '#admin') location.hash = 'admin'; else renderAdmin();
  setTimeout(() => $('#formPanel')?.scrollIntoView({ behavior: 'smooth' }), 80);
}
function renderAdmin() {
  const w = $('#adminWrap');
  if (!AUTH) { w.innerHTML = '<div class="panel"><h2>Release desk</h2><p>Connecting…</p></div>'; return; }
  if (!ADMIN) {
    const signedOther = AUTHUSER && !ADMIN;
    w.innerHTML = `<div class="panel"><h2>Release desk</h2>
      <p class="muted">Only the newsletter editor can release and add issues. Enter your school email and we’ll send you a sign-in link – open it on this device.</p>
      ${LINK_MSG === 'confirm' ? '<p class="note">Confirm your email address to finish signing in.</p>' : LINK_MSG === 'expired' ? '<p class="note">That link has expired or was already used. Send a new one.</p>' : LINK_MSG === 'failed' ? '<p class="note">Sign-in didn’t finish. Check the address and try again.</p>' : ''}
      ${signedOther ? `<p class="note">You’re signed in as ${esc(AUTHUSER.email || 'another account')}, which isn’t the editor account. <button class="btn small" id="so">Sign out</button></p>` : ''}
      <div class="row"><div class="field"><label for="ae">School email</label><input id="ae" type="email" value="${esc(LS.get('ergsNL.linkEmail') || C.admins[0])}"></div>
      <button class="btn primary" id="sendLink">${LINK_MSG === 'confirm' ? 'Finish signing in' : 'Email me a sign-in link'}</button></div><p id="am" class="muted"></p></div>`;
    $('#so')?.addEventListener('click', () => signOut(AUTH));
    $('#sendLink').addEventListener('click', async () => {
      const e = $('#ae').value.trim().toLowerCase();
      if (LINK_MSG === 'confirm') return completeLink(e);
      try {
        await sendSignInLinkToEmail(AUTH, e, { url: location.origin + location.pathname + '#admin', handleCodeInApp: true });
        LS.set('ergsNL.linkEmail', e);
        $('#am').textContent = 'Link sent – check your inbox (and junk folder), then open the link on this device.';
      } catch (err) { $('#am').textContent = 'Couldn’t send the link: ' + (err.code || err.message); }
    });
    return;
  }
  const all = allIssues();
  const removed = all.filter(i => status(i) === 'removed');
  const rows = all.filter(i => status(i) !== 'removed').map(i => {
    const r = RELEASES[i.id] || {}, st = status(i), sel = r.s || i.def;
    const src = i.custom ? 'uploaded by you' : i.id.startsWith('b') ? 'new issue' : 'original';
    const acts = `<button class="btn small" data-edit="${esc(i.id)}">Edit</button> ` + (i.custom ? `<button class="btn small danger" data-del="${esc(i.id)}">Delete</button>` : `<button class="btn small danger" data-rm="${esc(i.id)}">Remove</button>`) + (i.edited ? ` <button class="btn small" data-undo="${esc(i.id)}">Undo edits</button>` : '');
    return `<tr class="${st}"><td><b>${i.n}</b></td><td><a href="#issue-${esc(i.id)}">${esc(i.title)}</a><br><small class="muted">${esc(i.theme || '')} · ${src}${i.edited ? ' · edited' : ''}</small></td>
      <td><select data-s="${esc(i.id)}"><option value="live"${sel === 'live' ? ' selected' : ''}>Released</option><option value="locked"${sel === 'locked' ? ' selected' : ''}>Locked</option><option value="sched"${sel === 'sched' ? ' selected' : ''}>Scheduled</option></select></td>
      <td>${sel === 'sched' ? `<input type="date" data-d="${esc(i.id)}" value="${esc(r.d || '')}">` : ''}</td>
      <td class="acts">${acts}</td></tr>`;
  }).join('');
  const nextN = Math.max(...all.map(i => i.n)) + 1;
  const e = editing || {};
  const val = (k, d = '') => esc(e[k] ?? d);
  const lines = k => esc((e[k] || []).join('\n'));
  w.innerHTML = `
  <div class="panel"><div class="row"><h2 style="margin:0">Release desk</h2><span class="spacer"></span><small class="muted">Signed in as ${esc(AUTHUSER.email)}</small><button class="btn small" id="so">Sign out</button></div>
    <p class="muted">Released issues appear for all staff straight away. Scheduled issues appear automatically on their date. Staff only ever see released issues – nothing about what’s still to come.</p>
    <div class="row"><button class="btn primary" id="relNext2">Release the next issue</button><a class="btn" href="#">View library</a><button class="btn" id="addBtn">+ Upload a new issue</button></div>
  </div>
  <div class="panel" id="formPanel"${editing || formKind === 'open' ? '' : ' hidden'}>
    <h2>${editing && (editing.docId || editing.baseId) ? 'Edit issue ' + esc(editing.n) : 'Upload a new issue'}</h2>
    <p class="muted">${editing && editing.baseId ? 'Change the details below, or upload a replacement PDF. Leave the file empty to keep the current pages. You can undo your edits at any time.' : 'Upload a finished PDF (or image), or type it into the house template and it’s designed for you.'}</p>
    <div class="seg" id="kindSeg"${editing && editing.baseId ? ' hidden' : ''}><button data-k="img" class="${(e.kind || 'img') === 'img' ? 'on' : ''}">Upload PDF / image</button><button data-k="tpl" class="${e.kind === 'tpl' ? 'on' : ''}">Use the template</button></div>
    <form id="issueForm" style="margin-top:14px">
      <div class="row">
        <div class="field" style="flex:0 1 110px"><label>Issue no.</label><input name="n" type="number" min="1" required value="${val('n', nextN)}"></div>
        <div class="field" style="flex:3 1 300px"><label>Title</label><input name="title" required value="${val('title')}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Theme</label><select name="theme">${THEMES.map(t => `<option${e.theme === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div class="field"><label>Tools</label><div class="row">${['Gemini', 'Copilot', 'NotebookLM'].map(t => `<label class="check" style="margin:0"><input type="checkbox" name="tools" value="${t}"${(e.tools || []).includes(t) ? ' checked' : ''}> ${t}</label>`).join('')}</div></div>
        <div class="field"><label>When saved</label><select name="initial"><option value="locked">${editing && (editing.docId || editing.baseId) ? 'No change to release' : 'Keep locked for now'}</option><option value="live">Release now</option></select></div>
      </div>
      <div class="field"><label>One-line summary (shown on the card)</label><input name="summary" value="${val('summary')}"></div>
      <div class="field"><label>Link (optional – e.g. a Drive or SharePoint copy)</label><input name="link" type="url" value="${val('link')}"></div>
      <div id="imgFields">
        <div class="field"><label>PDF or image file</label><input type="file" id="fileIn" accept="application/pdf,image/*"><small>${editing && (editing.baseId || (editing.kind === 'img' && editing.docId)) ? 'Leave empty to keep the current pages. ' : ''}Each page is stored encrypted. Multi-page PDFs are fine.</small></div>
        <div id="filePrev" class="row"></div>
      </div>
      <div id="tplFields">
        <div class="row"><div class="field"><label>Role / kicker</label><input name="kicker" value="${val('kicker')}" placeholder="e.g. Retrieval Practice Engineer"></div>
        <div class="field"><label>Difficulty</label><select name="difficulty">${['Beginner', 'Intermediate', 'Advanced'].map(d => `<option${e.difficulty === d ? ' selected' : ''}>${d}</option>`).join('')}</select></div>
        <div class="field"><label>Read time</label><input name="read" value="${val('read', '5 mins')}"></div></div>
        <div class="row"><div class="field"><label>Time saved</label><input name="saved" value="${val('saved')}" placeholder="~20 mins"></div><div class="field"><label>…per</label><input name="savedPer" value="${val('savedPer')}" placeholder="per lesson"></div></div>
        <div class="field"><label>This week’s skill (aim)</label><input name="aim" value="${val('aim')}"></div>
        <div class="field"><label>How AI can help (blank line between paragraphs)</label><textarea name="intro" rows="5">${esc(Array.isArray(e.intro) ? e.intro.join('\n\n') : e.intro || '')}</textarea></div>
        <div class="field"><label>Try this prompt</label><textarea name="prompt" rows="4">${val('prompt')}</textarea></div>
        <div class="field"><label>Pro tip</label><textarea name="tip" rows="2">${val('tip')}</textarea></div>
        <div class="row"><div class="field"><label>Ideas box title</label><input name="ideasTitle" value="${val('ideasTitle', 'Ideas to try')}"></div></div>
        <div class="field"><label>Ideas (one per line)</label><textarea name="ideas" rows="4">${lines('ideas')}</textarea></div>
        <div class="field"><label>Department challenge</label><textarea name="challenge" rows="2">${val('challenge')}</textarea></div>
        <div class="row"><div class="field"><label>Bad prompt</label><textarea name="badp" rows="2">${esc(e.bad?.p || '')}</textarea></div><div class="field"><label>…result</label><textarea name="badr" rows="2">${esc(e.bad?.r || '')}</textarea></div></div>
        <div class="row"><div class="field"><label>Good prompt</label><textarea name="goodp" rows="3">${esc(e.good?.p || '')}</textarea></div><div class="field"><label>…result</label><textarea name="goodr" rows="3">${esc(e.good?.r || '')}</textarea></div></div>
        <div class="row"><div class="field"><label>Do (one per line)</label><textarea name="dos" rows="4">${lines('dos')}</textarea></div><div class="field"><label>Don’t (one per line)</label><textarea name="donts" rows="4">${lines('donts')}</textarea></div></div>
        <div class="field"><label>Key message</label><input name="key" value="${val('key')}"></div>
      </div>
      <div class="row"><button class="btn primary" type="submit" id="saveBtn">Save issue</button><button class="btn" type="button" id="cancelBtn">Cancel</button><span id="saveMsg" class="muted"></span></div>
    </form>
  </div>
  <div class="panel"><h2>All issues</h2><p class="muted">Edit any issue (title, number, theme or a replacement PDF), remove it, or upload a new one.</p><table class="rel"><thead><tr><th>#</th><th>Issue</th><th>Status</th><th>Release date</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
  ${removed.length ? `<div class="panel"><h2>Removed issues</h2><p class="muted">Hidden from everyone. Restore puts an issue back as locked.</p><table class="rel"><tbody>${removed.map(i => `<tr><td><b>${i.n}</b></td><td>${esc(i.title)}</td><td class="acts"><button class="btn small" data-restore="${esc(i.id)}">Restore</button></td></tr>`).join('')}</tbody></table></div>` : ''}`;
  wireAdmin(all);
}
function wireAdmin(all) {
  $('#so').addEventListener('click', () => signOut(AUTH));
  $('#relNext2').addEventListener('click', () => { const n = all.find(i => status(i) !== 'live' && status(i) !== 'removed'); if (n) setRelease(n.id, { s: 'live' }, `Issue ${n.n} released`); else toast('Everything is already released'); });
  $('#addBtn').addEventListener('click', () => { editing = { kind: 'img' }; formKind = 'img'; pendingPages = pendingThumb = null; renderAdmin(); $('#formPanel').scrollIntoView({ behavior: 'smooth' }); });
  document.querySelectorAll('[data-s]').forEach(s => s.addEventListener('change', () => {
    const id = s.dataset.s, v = s.value, cur = RELEASES[id] || {};
    setRelease(id, v === 'sched' ? { s: 'sched', d: cur.d || today() } : { s: v }, v === 'live' ? 'Released' : v === 'locked' ? 'Locked' : 'Pick a release date');
  }));
  document.querySelectorAll('[data-d]').forEach(d => d.addEventListener('change', () => setRelease(d.dataset.d, { s: 'sched', d: d.value }, 'Scheduled for ' + fmtDate(d.value))));
  document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => startEdit(all.find(i => i.id === b.dataset.edit))));
  const twice = (b, label, fn) => { let armed = false; b.addEventListener('click', async () => { if (!armed) { armed = true; const t = b.textContent; b.textContent = label; setTimeout(() => { armed = false; b.textContent = t; }, 3000); return; } await fn(); }); };
  document.querySelectorAll('[data-rm]').forEach(b => twice(b, 'Click again to remove', () => { const i = all.find(x => x.id === b.dataset.rm); setRelease(i.id, { s: 'removed' }, `Issue ${i.n} removed – restore it any time`); }));
  document.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', () => setRelease(b.dataset.restore, { s: 'locked' }, 'Restored (locked)')));
  document.querySelectorAll('[data-undo]').forEach(b => twice(b, 'Click again to undo', async () => {
    const i = all.find(x => x.id === b.dataset.undo);
    try { for (const p of i.ovPages || []) await deleteDoc(doc(DB, 'newsletterImgs', p)); await deleteDoc(doc(DB, 'newsletterIssues', i.ovDocId)); toast('Back to the original version'); } catch (e) { toast('Couldn’t undo: ' + (e.code || e.message)); }
  }));
  document.querySelectorAll('[data-del]').forEach(b => {
    let armed = false;
    b.addEventListener('click', async () => {
      if (!armed) { armed = true; b.textContent = 'Click again to delete'; setTimeout(() => { armed = false; b.textContent = 'Delete'; }, 3000); return; }
      const c = CUSTOM.find(x => x.id === b.dataset.del);
      try { for (const p of c.pageDocs || []) await deleteDoc(doc(DB, 'newsletterImgs', p)); await deleteDoc(doc(DB, 'newsletterIssues', c.docId)); toast('Issue deleted'); } catch (e) { toast('Couldn’t delete: ' + (e.code || e.message)); }
    });
  });
  const fp = $('#formPanel'); if (fp.hidden) return;
  const setKind = k => { formKind = k; $('#imgFields').hidden = k !== 'img'; $('#tplFields').hidden = k !== 'tpl'; document.querySelectorAll('#kindSeg button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); };
  setKind(editing?.kind || 'img');
  document.querySelectorAll('#kindSeg button').forEach(b => b.addEventListener('click', () => setKind(b.dataset.k)));
  $('#cancelBtn').addEventListener('click', () => { editing = null; formKind = 'tpl'; renderAdmin(); });
  $('#fileIn').addEventListener('change', async ev => {
    const f = ev.target.files[0]; if (!f) return;
    $('#saveMsg').textContent = 'Preparing pages…'; $('#saveBtn').disabled = true;
    try { const r = await fileToPages(f); pendingPages = r.pages; pendingThumb = r.thumb; $('#filePrev').innerHTML = `<img src="${r.thumb}" style="width:120px;border:1px solid var(--line);border-radius:6px"><span class="muted">${r.pages.length} page${r.pages.length > 1 ? 's' : ''} ready</span>`; $('#saveMsg').textContent = ''; }
    catch (e) { $('#saveMsg').textContent = 'Couldn’t read that file: ' + e.message; }
    $('#saveBtn').disabled = false;
  });
  $('#issueForm').addEventListener('submit', saveIssue);
}

async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return window.pdfjsLib;
}
const canvasBlob = (c, q) => new Promise(r => c.toBlob(r, 'image/jpeg', q));
async function fitJpeg(canvas) {
  for (const q of [0.82, 0.74, 0.66, 0.58, 0.5]) { const b = await canvasBlob(canvas, q); if (b.size < 640000) return new Uint8Array(await b.arrayBuffer()); }
  const s = document.createElement('canvas'); s.width = canvas.width * 0.75; s.height = canvas.height * 0.75; s.getContext('2d').drawImage(canvas, 0, 0, s.width, s.height); return fitJpeg(s);
}
async function fileToPages(f) {
  const canvases = [];
  if (f.type === 'application/pdf') {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
    if (pdf.numPages > 12) throw new Error('please keep issues to 12 pages or fewer');
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p); const vp0 = page.getViewport({ scale: 1 }); const vp = page.getViewport({ scale: 1240 / vp0.width });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise; canvases.push(c);
    }
  } else if (f.type.startsWith('image/')) {
    const img = await createImageBitmap(f); const sc = Math.min(1, 1240 / img.width);
    const c = document.createElement('canvas'); c.width = img.width * sc; c.height = img.height * sc;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height); canvases.push(c);
  } else throw new Error('choose a PDF or an image');
  const pages = []; for (const c of canvases) pages.push(await fitJpeg(c));
  const t = document.createElement('canvas'); t.width = 330; t.height = Math.round(canvases[0].height * 330 / canvases[0].width);
  t.getContext('2d').drawImage(canvases[0], 0, 0, t.width, t.height);
  return { pages, thumb: t.toDataURL('image/jpeg', 0.72) };
}
async function saveIssue(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target), g = k => (fd.get(k) || '').toString().trim(), ln = k => g(k).split('\n').map(s => s.trim()).filter(Boolean);
  const msg = $('#saveMsg'), btn = $('#saveBtn');
  const docId = editing?.docId || (editing?.baseId ? 'ov-' + editing.baseId : doc(collection(DB, 'newsletterIssues')).id);
  const base = { n: +g('n'), title: g('title'), theme: g('theme'), tools: fd.getAll('tools'), summary: g('summary'), link: g('link'), kind: formKind };
  let data;
  if (formKind === 'img') {
    if (!pendingPages && !editing?.baseId && !(editing?.kind === 'img' && editing.pageDocs?.length)) { msg.textContent = 'Choose a PDF or image first.'; return; }
    data = { ...base, pageDocs: editing?.pageDocs || [], thumb: editing?.thumb || '' };
  } else {
    data = { ...base, kicker: g('kicker'), difficulty: g('difficulty'), read: g('read'), saved: g('saved'), savedPer: g('savedPer'), aim: g('aim'), intro: g('intro'), prompt: g('prompt'), tip: g('tip'), ideasTitle: g('ideasTitle'), ideas: ln('ideas'), challenge: g('challenge'), bad: { p: g('badp'), r: g('badr') }, good: { p: g('goodp'), r: g('goodr') }, dos: ln('dos'), donts: ln('donts'), key: g('key') };
    if (!data.summary) data.summary = data.aim;
  }
  btn.disabled = true; msg.textContent = 'Saving…';
  try {
    if (formKind === 'img' && pendingPages) {
      const old = editing?.pageDocs || [], ids = [];
      for (let p = 0; p < pendingPages.length; p++) { const pid = `${docId}_${p}`; msg.textContent = `Uploading page ${p + 1} of ${pendingPages.length}…`; await setDoc(doc(DB, 'newsletterImgs', pid), { data: b64e(await enc(pendingPages[p])) }); ids.push(pid); }
      for (const o of old) if (!ids.includes(o)) await deleteDoc(doc(DB, 'newsletterImgs', o)).catch(() => {});
      data.pageDocs = ids; data.thumb = pendingThumb; [...imgCache.keys()].filter(k => k.startsWith('fs:' + docId)).forEach(k => imgCache.delete(k));
    }
    delete data.id; delete data.docId; delete data.custom; if (editing?.baseId) data.overrides = editing.baseId;
    await setDoc(doc(DB, 'newsletterIssues', docId), { enc: await encJSON(data), updated: serverTimestamp() });
    const relId = editing?.baseId || ('c' + docId);
    if (!editing?.docId && !editing?.baseId) setRelease(relId, { s: g('initial') === 'live' ? 'live' : 'locked' });
    else if (g('initial') === 'live') setRelease(relId, { s: 'live' });
    toast(`Issue ${data.n} saved`); editing = null; pendingPages = pendingThumb = null; formKind = 'tpl'; renderAdmin();
  } catch (e) { console.warn(e); msg.textContent = 'Couldn’t save: ' + (e.code || e.message); btn.disabled = false; }
}
/* ---------- install as an app ---------- */
const BASE = location.origin + location.pathname;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let deferredInstall = null;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (!standalone()) $('#installBtn').hidden = false; });
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('Installed – find AI in School on your home screen'); });
if (isIOS && !standalone()) $('#installBtn').hidden = false;
$('#installBtn').addEventListener('click', async () => {
  if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; $('#installBtn').hidden = true; }
  else if (isIOS) $('#iosTip').hidden = false;
  else toast('Use your browser menu → Install app / Add to Home screen');
});
$('#iosClose').addEventListener('click', () => { $('#iosTip').hidden = true; });

/* ---------- share (same card as ERGS Live) ---------- */
const LIB_ITEM = { label: 'AI in School', url: BASE, file: 'ai-in-school-qr', desc: 'The ERGS staff AI newsletter library. Staff need the staff password to open it.', shareText: 'AI in School: A Teacher’s Guide – the ERGS staff AI newsletter. Staff password needed.' };
function openShare(items) { if (!window.ERGSShare) return toast('Sharing isn’t available'); window.ERGSShare.open({ title: 'Share', crest: window.ERGS_CREST, items }); }
$('#shareBtn').addEventListener('click', () => openShare([LIB_ITEM]));
$('#shareIssueBtn').addEventListener('click', () => {
  const id = location.hash.slice(7), i = allIssues().find(x => x.id === id); if (!i) return openShare([LIB_ITEM]);
  openShare([{ label: 'Issue ' + i.n, url: BASE + '#issue-' + i.id, file: 'ai-in-school-issue-' + i.n, desc: `Issue ${i.n}: ${i.title}. Opens straight onto this issue (staff password needed).`, shareText: `AI in School – Issue ${i.n}: ${i.title}` }, LIB_ITEM]);
});
/* ---------- automatic updates ----------
   The app fingerprints its own files. When anything is pushed to GitHub, open and installed copies
   notice within minutes (and whenever they're reopened) and refresh themselves – no version numbers to bump. */
const WATCH = ['index.html', 'app.js', 'style.css', 'config.js', 'share.js', 'content.enc'];
let BUILD = null, updating = false;
async function fingerprint() {
  const bufs = await Promise.all(WATCH.map(f => fetch(f + '?v=' + Date.now(), { cache: 'no-store' }).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })));
  const all = new Uint8Array(bufs.reduce((n, b) => n + b.byteLength, 0)); let o = 0; for (const b of bufs) { all.set(new Uint8Array(b), o); o += b.byteLength; }
  return b64e(new Uint8Array(await crypto.subtle.digest('SHA-256', all)));
}
async function checkUpdate() {
  if (updating || !navigator.onLine) return;
  try {
    const fp = await fingerprint();
    if (!BUILD) { BUILD = fp; return; }
    if (fp === BUILD) return;
    updating = true;
    const busy = location.hash === '#admin' && !$('#formPanel')?.hidden;   // don't throw away a half-typed issue
    if (document.hidden || !busy) { await refreshApp(); return; }
    const bar = document.createElement('div'); bar.className = 'updbar';
    bar.innerHTML = '<span>A new version of AI in School is ready.</span><button class="btn small primary">Update now</button>';
    bar.querySelector('button').onclick = refreshApp; document.body.appendChild(bar);
  } catch (e) {}
}
async function refreshApp() {
  try { const r = await navigator.serviceWorker?.getRegistration(); await r?.update(); const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch (e) {}
  sessionStorage.setItem('ergsNL.updated', '1'); location.reload();
}
checkUpdate();
setInterval(checkUpdate, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
window.addEventListener('online', checkUpdate);
if (SS.get('ergsNL.updated')) { SS.del('ergsNL.updated'); setTimeout(() => toast('Updated to the latest version'), 800); }

/* ---------- binder: flip through every released issue like a real book ---------- */
const Binder = (() => {
  let pages = [], spread = 0, single = false, busy = false, built = false, sig = '';
  const st = () => $('#bkStage');
  const issuesInBinder = () => allIssues().filter(i => status(i) === 'live' || (canManage() && status(i) !== 'removed'));
  function buildPages() {
    const list = issuesInBinder();
    const P = [{ kind: 'cover' }, { kind: 'contents', list }];
    list.forEach(i => {
      const srcs = i.imgs || i.pageDocs || [];
      if (!srcs.length) P.push({ kind: 'info', issue: i }); // template issues without page images
      srcs.forEach((src, k) => P.push({ kind: 'img', issue: i, src, k, of: srcs.length }));
    });
    // contents page numbers (1-based, cover = page 1)
    list.forEach(i => { i._page = P.findIndex(p => p.issue === i) + 1; });
    P.push({ kind: 'back' });
    pages = P;
    const sel = $('#bkJump');
    sel.innerHTML = '<option value="">Jump to issue…</option>' + list.map(i => `<option value="${i._page - 1}">Issue ${i.n}: ${esc(i.title)}</option>`).join('');
  }
  function pageEl(idx) {
    const el = document.createElement('div'); el.className = 'bk-page';
    const p = pages[idx];
    if (!p) { el.classList.add('blank'); return el; }
    if (p.kind === 'cover') {
      el.classList.add('cover');
      el.innerHTML = `<div class="bk-cv"><img src="${window.ERGS_CREST || ''}" alt=""><p class="bk-sch">Enniskillen Royal Grammar School</p><h1>AI in School</h1><h2>A Teacher’s Guide</h2><div class="bk-rule"></div><p>Whole-School AI Skills CPD Portfolio</p><p class="bk-small">${issuesInBinder().length} issues · for staff use</p></div>`;
    } else if (p.kind === 'contents') {
      el.classList.add('contents');
      el.innerHTML = `<h3>Contents</h3><ol>${p.list.map(i => `<li data-go="${i._page - 1}"><b>${i.n}</b><span>${esc(i.title)}${status(i) !== 'live' ? ' <em>locked</em>' : ''}</span><i>${i._page}</i></li>`).join('')}</ol>`;
      el.querySelectorAll('[data-go]').forEach(li => li.addEventListener('click', e => { e.stopPropagation(); go(+li.dataset.go); }));
    } else if (p.kind === 'back') {
      el.classList.add('cover', 'back');
      el.innerHTML = `<div class="bk-cv"><img src="${window.ERGS_CREST || ''}" alt=""><h2>Keep learning</h2><div class="bk-rule"></div><p>New issues are released through the term.<br>Approved tools: Copilot · Gemini · NotebookLM</p></div>`;
    } else if (p.kind === 'info') {
      el.innerHTML = `<div class="bk-info"><small>Issue ${p.issue.n}</small><h3>${esc(p.issue.title)}</h3><p>${esc(p.issue.summary || '')}</p><a href="#issue-${esc(p.issue.id)}">Open this issue</a></div>`;
    } else {
      const img = document.createElement('img'); img.alt = `Issue ${p.issue.n}, page ${p.k + 1}`; img.draggable = false;
      (p.issue.fsPages ? customPageImg(p.src) : fileImg(p.src)).then(u => { img.src = u; }).catch(() => {});
      el.appendChild(img);
      if (status(p.issue) !== 'live') { const r = document.createElement('span'); r.className = 'bk-lock'; r.textContent = 'Locked – only you can see this'; el.appendChild(r); }
    }
    el.dataset.n = idx + 1;
    return el;
  }
  function preload(i) { for (let k = i - 2; k <= i + 4; k++) { const p = pages[k]; if (p && p.kind === 'img') (p.issue.fsPages ? customPageImg(p.src) : fileImg(p.src)).catch(() => {}); } }
  // spread s: left = pages[2s-1], right = pages[2s]
  const maxSpread = () => single ? pages.length - 1 : Math.ceil((pages.length - 1) / 2);
  const leftIdx = s => 2 * s - 1, rightIdx = s => 2 * s;
  function layout() {
    const box = $('#bkArea').getBoundingClientRect();
    single = box.width < 760;
    const ratio = 1.4142, availH = Math.max(240, innerHeight - box.top - 24), availW = box.width - 16;
    let pw = Math.min(availH / ratio, single ? availW : availW / 2);
    pw = Math.floor(pw); const ph = Math.floor(pw * ratio);
    const s = st(); s.style.setProperty('--pw', pw + 'px'); s.style.setProperty('--ph', ph + 'px');
    s.classList.toggle('single', single);
  }
  function draw() {
    const s = st(); s.innerHTML = '';
    if (single) {
      const slot = document.createElement('div'); slot.className = 'bk-slot r'; slot.appendChild(pageEl(spread)); s.appendChild(slot);
      preload(spread);
    } else {
      const L = document.createElement('div'); L.className = 'bk-slot l'; L.appendChild(pageEl(leftIdx(spread)));
      const R = document.createElement('div'); R.className = 'bk-slot r'; R.appendChild(pageEl(rightIdx(spread)));
      s.append(L, R); s.classList.toggle('closed', spread === 0); s.classList.toggle('end', rightIdx(spread) >= pages.length);
      preload(rightIdx(spread));
    }
    updateBar();
  }
  function curIssue() { const i = single ? spread : Math.max(leftIdx(spread), 0); const p = pages[i] || pages[i + 1]; return p && p.issue; }
  function updateBar() {
    const total = pages.length;
    const label = single ? `Page ${spread + 1} of ${total}` : spread === 0 ? `Cover · ${total} pages` : `Pages ${leftIdx(spread) + 1}${rightIdx(spread) < total ? '–' + (rightIdx(spread) + 1) : ''} of ${total}`;
    $('#bkPos').textContent = label;
    $('#bkPrev').disabled = spread <= 0; $('#bkNext').disabled = spread >= maxSpread();
    const iss = curIssue(); $('#bkOpen').hidden = !iss; if (iss) $('#bkOpen').href = '#issue-' + iss.id;
    $('#bkRange').max = maxSpread(); $('#bkRange').value = spread;
  }
  function flip(dir) {
    if (busy) return;
    const target = spread + dir; if (target < 0 || target > maxSpread()) return;
    busy = true;
    const s = st(), f = document.createElement('div'), front = document.createElement('div'), back = document.createElement('div');
    f.className = 'bk-flip'; front.className = 'bk-face front'; back.className = 'bk-face back';
    const shade = document.createElement('div'); shade.className = 'bk-shade';
    if (single) {
      const slot = s.querySelector('.bk-slot');
      if (dir > 0) { front.appendChild(pageEl(spread)); slot.replaceChildren(pageEl(target)); f.classList.add('r'); }
      else { front.appendChild(pageEl(target)); f.classList.add('r', 'from'); }
      back.appendChild(Object.assign(document.createElement('div'), { className: 'bk-page paper' }));
    } else if (dir > 0) {
      front.appendChild(pageEl(rightIdx(spread))); back.appendChild(pageEl(leftIdx(target)));
      s.querySelector('.bk-slot.r').replaceChildren(pageEl(rightIdx(target))); f.classList.add('r');
      s.classList.remove('end'); if (rightIdx(target) >= pages.length) s.classList.add('end');
      s.classList.remove('closed');
    } else {
      front.appendChild(pageEl(leftIdx(spread))); back.appendChild(pageEl(rightIdx(target)));
      s.querySelector('.bk-slot.l').replaceChildren(pageEl(leftIdx(target))); f.classList.add('l');
    }
    f.append(front, back, shade); s.appendChild(f);
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.add('go')));
    const done = () => { spread = target; busy = false; draw(); };
    f.addEventListener('transitionend', e => { if (e.target === f) done(); }, { once: false });
    setTimeout(() => { if (busy) done(); }, 1100);
  }
  function go(pageIndex) {
    spread = single ? pageIndex : Math.ceil(pageIndex / 2);
    spread = Math.max(0, Math.min(spread, maxSpread())); draw();
  }
  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    $('#bkPrev').addEventListener('click', () => flip(-1));
    $('#bkNext').addEventListener('click', () => flip(1));
    $('#bkJump').addEventListener('change', e => { if (e.target.value !== '') go(+e.target.value); e.target.value = ''; });
    $('#bkRange').addEventListener('input', e => { spread = +e.target.value; draw(); });
    $('#bkFull').addEventListener('click', () => { const el = $('#binder'); (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.())?.catch?.(() => {}); });
    document.addEventListener('fullscreenchange', () => setTimeout(() => { layout(); draw(); }, 120));
    st().addEventListener('click', e => {
      if (e.target.closest('a,[data-go]')) return;
      const r = st().getBoundingClientRect(); flip(e.clientX - r.left > r.width / 2 ? 1 : -1);
    });
    let x0 = null, y0 = null;
    st().addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    st().addEventListener('touchend', e => {
      if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { e.preventDefault(); flip(dx < 0 ? 1 : -1); }
    });
    document.addEventListener('keydown', e => { if (location.hash !== '#binder') return; if (e.key === 'ArrowRight') flip(1); if (e.key === 'ArrowLeft') flip(-1); });
    let rt; window.addEventListener('resize', () => { if (location.hash !== '#binder') return; clearTimeout(rt); rt = setTimeout(() => { const wasSingle = single; const pIdx = single ? spread : Math.max(0, leftIdx(spread)); layout(); if (wasSingle !== single) go(pIdx); else draw(); }, 150); });
  }
  return {
    active: false,
    open() { this.active = true; wire(); const s2 = JSON.stringify(issuesInBinder().map(i => i.id + status(i))); if (!built || s2 !== sig) { buildPages(); built = true; sig = s2; spread = 0; } layout(); draw(); document.title = 'Binder · AI in School'; },
    refresh() { const s2 = JSON.stringify(issuesInBinder().map(i => i.id + status(i))); if (s2 !== sig) { sig = s2; buildPages(); spread = Math.min(spread, maxSpread()); layout(); draw(); } }
  };
})();
window.addEventListener('hashchange', () => { if (location.hash !== '#binder') Binder.active = false; });

boot();
