/* BioVitality Editor - biblioteca de sunete din timeline.
   Folderele tale cu sunete -> categorii (numele subfolderelor). ▶ asculti, + pui la cursor. */

S.sfx = null;
let sfxAudio = null, sfxPlaying = null, sfxQuery = '', sfxOpen = null;   // sfxOpen = categoria deschisa
// „whoosh”, „woosh”, „swoosh” -> acelasi lucru la cautare
const sfxNorm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/wh/g, 'w').replace(/sw(o+)sh/g, 'w$1sh').replace(/o+/g, 'o');
const sfxUrl = it => `/sfx/${it.lib}/${it.rel.split('/').map(encodeURIComponent).join('/')}`;

async function sfxLoad(force) {
  if (S.sfx && !force) return S.sfx;
  S.sfx = await fetch('/api/sfx').then(r => r.json()).catch(() => ({ libs: [], items: [] }));
  return S.sfx;
}
async function sfxPost(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
    .then(r => r.json()).catch(() => ({ error: 'Nu mă pot conecta la aplicație.' }));
}

async function renderSfx() {
  const body = $('#tInspBody'); if (!body || T.tab !== 'sfx') return;
  if (!S.sfx) { body.innerHTML = '<div class="sub2">Citesc sunetele…</div>'; await sfxLoad(); if (T.tab !== 'sfx') return; }
  const d = S.sfx;
  if (!d.libs.length) {
    body.innerHTML = `<div class="sfxsetup">
      <h4 style="margin:0">♪ Biblioteca ta de sunete</h4>
      <p>Alege folderul cu efectele tale sonore. Fiecare subfolder devine o categorie (Click, Woosh, Riser…). Poți adăuga oricâte foldere.</p>
      <button class="cta" id="sfxPick">📁 Alege folderul</button>
      <p>sau lipește calea (în Explorer: click în bara de adresă sus → copiază):</p>
      <div class="row2"><input type="text" id="sfxPath" placeholder="C:\\Users\\...\\Sunete"><button class="btn" id="sfxAddPath">Adaugă</button></div></div>`;
    sfxBindSetup(); return;
  }
  body.innerHTML = `<div class="sfxbox">
    <div class="sfxtop"><input type="text" id="sfxQ" placeholder="Caută: whoosh, pop, riser…" value="${esc(sfxQuery)}">
      <button class="btn sm" id="sfxMore" title="Adaugă încă un folder">📁 +</button><button class="btn sm" id="sfxRe" title="Citește din nou folderele">↻</button></div>
    <div class="sfxlibs">${d.libs.map((l, i) => `<span class="${l.ok ? '' : 'bad'}" title="${esc(l.path)}">${esc(l.name)}${l.ok ? '' : ' · lipsă'}<button data-rm="${i}" title="Scoate din bibliotecă">×</button></span>`).join('')}</div>
    <div class="sfxlist" id="sfxList"></div>
    <div class="hint" style="margin:0">▶ = ascultă · + sau dublu-click pe nume = pune la cursor</div></div>`;
  sfxList();
  $('#sfxQ').oninput = e => { sfxQuery = e.target.value; sfxList(); };
  $('#sfxRe').onclick = async () => { await sfxLoad(true); renderSfx(); };
  $('#sfxMore').onclick = async () => { const r = await sfxPost('/api/sfx/pick'); if (r.path) sfxAddFolder(r.path); else if (r.error) { toast(r.error); sfxShowPathBox(); } };
  body.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { S.sfx = await sfxPost('/api/sfx/remove', { index: +b.dataset.rm }); renderSfx(); });
}
function sfxShowPathBox() {
  const top = $('.sfxtop'); if (!top || $('#sfxPath')) return;
  top.insertAdjacentHTML('afterend', `<div class="sfxsetup"><div class="row2"><input type="text" id="sfxPath" placeholder="C:\\Users\\...\\Sunete"><button class="btn" id="sfxAddPath">Adaugă</button></div></div>`);
  sfxBindSetup();
}
function sfxBindSetup() {
  const pick = $('#sfxPick');
  if (pick) pick.onclick = async () => {
    pick.disabled = true; pick.textContent = 'Alege folderul în fereastra deschisă…';
    const r = await sfxPost('/api/sfx/pick');
    pick.disabled = false; pick.textContent = '📁 Alege folderul';
    if (r.path) sfxAddFolder(r.path); else if (r.error) toast(r.error);
  };
  const add = $('#sfxAddPath');
  if (add) add.onclick = () => { const v = $('#sfxPath').value.trim(); if (v) sfxAddFolder(v); };
}
async function sfxAddFolder(path) {
  const r = await sfxPost('/api/sfx/folder', { path });
  if (r.error) { toast(r.error); return; }
  S.sfx = r; toast(`Am găsit ${r.items.length} sunete.`); renderSfx();
}
function sfxList() {
  const box = $('#sfxList'); if (!box) return;
  const q = sfxNorm(sfxQuery.trim());
  const items = S.sfx.items.map((it, i) => ({ ...it, i })).filter(it => !q || sfxNorm(it.name + ' ' + it.cat).includes(q));
  if (!items.length) { box.innerHTML = `<div class="sub2" style="margin:6px 2px">${q ? 'Niciun sunet nu se potrivește.' : 'Nu am găsit sunete (MP3, WAV…) în folderele alese.'}</div>`; return; }
  const cats = new Map();
  items.forEach(it => { if (!cats.has(it.cat)) cats.set(it.cat, []); cats.get(it.cat).push(it); });
  box.innerHTML = [...cats].map(([cat, list]) => `<details data-cat="${esc(cat)}" ${q || sfxOpen === cat ? 'open' : ''}><summary>${esc(cat)} <em>${list.length}</em></summary>
    ${list.map(it => `<div class="sfxrow" data-i="${it.i}"><button class="play ${sfxPlaying === it.i ? 'on' : ''}" data-play="${it.i}" title="Ascultă">${sfxPlaying === it.i ? '■' : '▶'}</button>
      <span class="nm" title="${esc(it.rel)}">${esc(it.name)}</span><button class="add" data-add="${it.i}" title="Pune la cursor">+</button></div>`).join('')}</details>`).join('');
  // o singura categorie deschisa: cand deschizi alta, se inchide cea veche; o inchizi si manual
  box.querySelectorAll('details').forEach(d => d.addEventListener('toggle', () => {
    if (sfxQuery.trim()) return;
    if (d.open) { sfxOpen = d.dataset.cat; box.querySelectorAll('details[open]').forEach(o => { if (o !== d) o.open = false; }); }
    else if (sfxOpen === d.dataset.cat) sfxOpen = null;
  }));
  box.onclick = e => {
    const p = e.target.closest('[data-play]'), a = e.target.closest('[data-add]');
    if (p) sfxPreview(+p.dataset.play); else if (a) sfxUse(+a.dataset.add);
  };
  box.ondblclick = e => { const r = e.target.closest('.sfxrow'); if (r && e.target.closest('.nm')) sfxUse(+r.dataset.i); };
}
function sfxMarkPlaying() {   // schimb doar butoanele, lista ramane cum e (deschisa)
  document.querySelectorAll('#sfxList [data-play]').forEach(b => {
    const on = +b.dataset.play === sfxPlaying; b.classList.toggle('on', on); b.textContent = on ? '■' : '▶';
  });
}
function sfxPreview(i) {
  if (!sfxAudio) { sfxAudio = new Audio(); sfxAudio.onended = () => { sfxPlaying = null; sfxMarkPlaying(); }; }
  if (sfxPlaying === i) { sfxAudio.pause(); sfxPlaying = null; sfxMarkPlaying(); return; }
  sfxAudio.src = sfxUrl(S.sfx.items[i]); sfxAudio.currentTime = 0; sfxAudio.play().catch(() => {});
  sfxPlaying = i; sfxMarkPlaying();
}
async function sfxUse(i) {
  const it = S.sfx.items[i]; if (!it) return;
  const info = await sfxPost(`/api/sfx/use/${T.id}`, { lib: it.lib, rel: it.rel });
  if (info.error) { toast(info.error); return; }
  if (!T.assets.some(a => a.asset === info.asset)) T.assets.push(info);
  const total = tlTotal(), a = clamp(T.t, 0, Math.max(0, total - 0.1));
  const b = Math.min(total, a + (info.duration || 1));
  const item = { id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: 'audio', asset: info.asset,
    start: +a.toFixed(3), end: +b.toFixed(3), source_start: 0, volume: 0.8, fade_in: 0, fade_out: 0.05, lane: tlFreeAuLane(a, b) };
  tlChange(() => { T.auds.push(item); });
  toast(`Am pus „${it.name}” la ${fmtTC(a)}. Îl reglezi din tabul Proprietăți.`);
}
