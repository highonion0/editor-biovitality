/* BioVitality Editor - tabul „📚 Bibliotecă”: pozele și clipurile tale (punctul 7) + sunetele.
   Folderele tale cu poze / clipuri (logo, produse, ingrediente, ambalaje) -> categorii (numele subfolderelor).
   Click pe o poză / un clip = îl pui la cursor, în modul ales sus. Claude le vede și le poate propune în „💡 Propuneri”. */

S.ml = null;
S.libKind = 'media';
let mlQuery = '', mlMode = (() => { try { return localStorage.getItem('bv_ml_mode') || 'small'; } catch (e) { return 'small'; } })();
const mlUrl = it => `/medialib/${it.lib}/${it.rel.split('/').map(encodeURIComponent).join('/')}`;

async function mlLoad(force) {
  if (S.ml && !force) return S.ml;
  S.ml = await fetch('/api/medialib').then(r => r.json()).catch(() => ({ libs: [], items: [] }));
  return S.ml;
}
// numele trimis de Claude („Produse / ashwagandha (poză)”) -> fisierul din biblioteca
function mlFind(name) {
  const items = (S.ml && S.ml.items) || [], q = pNorm(String(name || '').replace(/\s*\((poză|poza|clip)\)\s*$/i, ''));
  if (!q) return null;
  return items.find(it => pNorm(it.cat + ' / ' + it.name) === q) || items.find(it => pNorm(it.name) === q)
    || items.find(it => pNorm(it.cat + it.name).includes(q)) || null;
}

function renderLibrary() {
  const body = $('#tInspBody'); if (!body || T.tab !== 'sfx') return;
  if (!$('#libBody', body)) {
    body.innerHTML = `<div class="libsw"><button data-lk="media">🖼 Poze și clipuri</button><button data-lk="sfx">♪ Sunete</button></div><div id="libBody"></div>`;
    body.querySelectorAll('[data-lk]').forEach(b => b.onclick = () => { S.libKind = b.dataset.lk; renderLibrary(); });
  }
  body.querySelectorAll('[data-lk]').forEach(b => b.classList.toggle('on', b.dataset.lk === S.libKind));
  if (S.libKind === 'sfx') renderSfx(); else renderMediaLib();
}

async function renderMediaLib() {
  const body = $('#libBody'); if (!body || T.tab !== 'sfx' || S.libKind !== 'media') return;
  if (!S.ml) { body.innerHTML = '<div class="sub2">Citesc biblioteca…</div>'; await mlLoad(); if (T.tab !== 'sfx' || S.libKind !== 'media') return; }
  const d = S.ml;
  if (!d.libs.length) {
    body.innerHTML = `<div class="sfxsetup">
      <h4 style="margin:0">🖼 Biblioteca ta de poze și clipuri</h4>
      <p>Alege folderul cu materialele pe care le folosești des: logo, produse, ingrediente, ambalaje, clipuri B-roll filmate de tine.
        Fiecare subfolder devine o categorie. Dă fișierelor nume care spun ce e în ele (ex: „ashwagandha pudră.jpg”) — după nume le găsește și Claude.</p>
      <button class="cta" id="mlPick">📁 Alege folderul</button>
      <p>sau lipește calea (în Explorer: click în bara de adresă sus → copiază):</p>
      <div class="row2"><input type="text" id="mlPath" placeholder="C:\\Users\\...\\Biblioteca BioVitality"><button class="btn" id="mlAddPath">Adaugă</button></div></div>`;
    mlBindSetup(); return;
  }
  body.innerHTML = `<div class="sfxbox">
    <div class="sfxtop"><input type="text" id="mlQ" placeholder="Caută: logo, ashwagandha, ambalaj…" value="${esc(mlQuery)}">
      <button class="btn sm" id="mlMore" title="Adaugă încă un folder">📁 +</button><button class="btn sm" id="mlRe" title="Citește din nou folderele">↻</button></div>
    <div class="sfxlibs">${d.libs.map((l, i) => `<span class="${l.ok ? '' : 'bad'}" title="${esc(l.path)}">${esc(l.name)}${l.ok ? '' : ' · lipsă'}<button data-rm="${i}" title="Scoate din bibliotecă">×</button></span>`).join('')}</div>
    <div class="mlmode"><span>Cum apare:</span>${MEDIA_MODES.map(([k, l]) => `<button class="tbtn ${mlMode === k ? 'on' : ''}" data-mm="${k}">${l}</button>`).join('')}</div>
    <div class="mlgrid" id="mlGrid"></div>
    <div class="hint" style="margin:0">Click pe o poză / un clip = îl pui la cursor (${fmtTC(T.t)}), în modul ales mai sus.</div></div>`;
  mlGrid();
  $('#mlQ').oninput = e => { mlQuery = e.target.value; mlGrid(); };
  $('#mlRe').onclick = async () => { await mlLoad(true); renderMediaLib(); };
  $('#mlMore').onclick = async () => { const r = await sfxPost('/api/medialib/pick'); if (r.path) mlAddFolder(r.path); else if (r.error) toast(r.error); };
  body.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { S.ml = await sfxPost('/api/medialib/remove', { index: +b.dataset.rm }); renderMediaLib(); });
  body.querySelectorAll('[data-mm]').forEach(b => b.onclick = () => {
    mlMode = b.dataset.mm; try { localStorage.setItem('bv_ml_mode', mlMode); } catch (e) { /* fara memorie locala */ }
    body.querySelectorAll('[data-mm]').forEach(x => x.classList.toggle('on', x === b));
  });
}
function mlBindSetup() {
  const pick = $('#mlPick');
  if (pick) pick.onclick = async () => {
    pick.disabled = true; pick.textContent = 'Alege folderul în fereastra deschisă…';
    const r = await sfxPost('/api/medialib/pick');
    pick.disabled = false; pick.textContent = '📁 Alege folderul';
    if (r.path) mlAddFolder(r.path); else if (r.error) toast(r.error);
  };
  const add = $('#mlAddPath');
  if (add) add.onclick = () => { const v = $('#mlPath').value.trim(); if (v) mlAddFolder(v); };
}
async function mlAddFolder(path) {
  const r = await sfxPost('/api/medialib/folder', { path });
  if (r.error) { toast(r.error); return; }
  S.ml = r; toast(`Am găsit ${r.items.length} poze și clipuri.`); renderMediaLib();
}
function mlGrid() {
  const box = $('#mlGrid'); if (!box) return;
  const q = pNorm(mlQuery.trim());
  const items = S.ml.items.map((it, i) => ({ ...it, i })).filter(it => !q || pNorm(it.name + ' ' + it.cat).includes(q)).slice(0, 300);
  if (!items.length) { box.innerHTML = `<div class="sub2" style="margin:6px 2px">${q ? 'Nimic nu se potrivește.' : 'Nu am găsit poze sau clipuri în folderele alese.'}</div>`; return; }
  box.innerHTML = items.map(it => `<button class="mlit" data-i="${it.i}" title="${esc(it.cat + ' / ' + it.name)}">
    ${it.type === 'image' ? `<img loading="lazy" src="${mlUrl(it)}" alt="">` : `<video muted preload="metadata" src="${mlUrl(it)}#t=0.5"></video><i>▶</i>`}
    <span>${esc(it.name)}</span></button>`).join('');
  box.querySelectorAll('.mlit').forEach(b => b.onclick = () => mlUse(S.ml.items[+b.dataset.i], b));
}
async function mlUse(it, btn) {
  if (btn) btn.disabled = true;
  const info = await sfxPost(`/api/medialib/use/${T.id}`, { lib: it.lib, rel: it.rel });
  if (btn) btn.disabled = false;
  if (info.error) { toast(info.error); return; }
  if (!T.assets.some(a => a.asset === info.asset)) T.assets.push(info);
  tlAddAsset(info, mlMode);
  toast(`„${it.name}” pus la ${fmtTC(T.t)}. Îl ajustezi în Proprietăți.`);
}
