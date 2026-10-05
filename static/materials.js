/* BioVitality Editor - „📎 Materiale obligatorii”: poze / clipuri urcate odată cu video-ul (înainte să pornești).
   După transcriere, aplicația le pune singură pe timeline: unde ai scris tu („când zic de ashwagandha”, „la final”, „0:12”),
   iar unde n-ai scris nimic alege Claude (dacă are cheia API). Ce nu-și găsește locul rămâne „de pus” în Timeline. */

S.mats = {};
const MAT_IMG = /\.(png|jpe?g|webp|gif)$/i, MAT_VID = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const matList = id => S.mats[id] || (S.mats[id] = ((S.jobs.get(id) || {}).draft || {}).materials || []);

function matHTML(j) {
  return `<div class="dmat" id="dMat">
    <div class="dmath"><b>📎 Materiale obligatorii</b> <span class="count">opțional</span></div>
    <p class="sub2" style="margin:0">Poze sau clipuri care trebuie să apară sigur în video. Trage-le aici. La fiecare scrie, dacă vrei, <b>unde</b> să apară
      („când zic de ashwagandha”, „la început”, „la final”, „0:12”). Fără indicație, alege Claude locul.</p>
    <div class="dmatlist" id="dMatList"></div>
    <div class="row2"><button class="btn sm" id="dMatAdd">+ Alege fișiere</button><input type="file" id="dMatFile" accept="image/*,video/*" multiple hidden></div></div>`;
}
function matBind(j) {
  $('#dMatAdd').onclick = () => $('#dMatFile').click();
  $('#dMatFile').onchange = e => { matAddFiles([...e.target.files], j.id); e.target.value = ''; };
  matRender(j.id);
}
function matRender(id) {
  const box = $('#dMatList'); if (!box) return;
  const list = matList(id);
  box.innerHTML = list.map((m, i) => `<div class="dmrow">
      ${m.type === 'image' ? `<img src="/material/${id}/${encodeURIComponent(m.asset)}" alt="">` : `<video muted preload="metadata" src="/material/${id}/${encodeURIComponent(m.asset)}#t=0.5"></video>`}
      <div class="dmf"><span class="nm" title="${esc(m.asset)}">${esc(m.asset)}</span>
        <input type="text" data-mw="${i}" value="${esc(m.where || '')}" placeholder="Unde? ex: când zic de ashwagandha">
        <div class="dmodes">${MEDIA_MODES.map(([k, l]) => `<button class="${m.mode === k ? 'on' : ''}" data-mm="${i}:${k}">${l}</button>`).join('')}</div></div>
      <button class="btn sm" data-mdel="${i}" title="Scoate">🗑</button></div>`).join('')
    || '<div class="dmempty">Trage aici poze sau clipuri</div>';
  box.querySelectorAll('[data-mw]').forEach(inp => inp.oninput = () => { list[+inp.dataset.mw].where = inp.value; matSaveSoon(id); });
  box.querySelectorAll('[data-mm]').forEach(b => b.onclick = () => { const [i, k] = b.dataset.mm.split(':'); list[+i].mode = k; matRender(id); matSave(id); });
  box.querySelectorAll('[data-mdel]').forEach(b => b.onclick = () => { list.splice(+b.dataset.mdel, 1); matRender(id); matSave(id); });
}
let matTimer = null;
function matSaveSoon(id) { clearTimeout(matTimer); matTimer = setTimeout(() => matSave(id), 500); }
function matSave(id) {
  return fetch(`/api/draft/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ materials: matList(id) }) }).catch(() => {});
}
function matAddFiles(files, id) {
  id = id || (S.rendered || '').replace(/^draft:/, '');
  const ok = files.filter(f => MAT_IMG.test(f.name) || MAT_VID.test(f.name));
  if (ok.length < files.length) toast('Unele fișiere nu sunt poze sau clipuri și le-am sărit.');
  ok.forEach(f => {
    toast(`Încarc „${f.name}”…`);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/asset/${id}`);
    xhr.setRequestHeader('X-Filename', encodeURIComponent(f.name));
    xhr.onload = () => {
      let r = {}; try { r = JSON.parse(xhr.responseText); } catch { /* raspuns invalid */ }
      if (xhr.status !== 200 || !r.asset) { toast(r.error || 'Încărcarea a eșuat.'); return; }
      matList(id).push({ asset: r.asset, type: r.type, mode: r.type === 'video' ? 'full' : 'small', where: '' });
      matRender(id); matSave(id);
    };
    xhr.onerror = () => toast('Nu mă pot conecta la aplicație.');
    xhr.send(f);
  });
}

/* ---- in Timeline: materialele care n-au avut loc („de pus”) */
function matPendingHTML() {
  const list = (T.pr && T.pr.materials_pending) || [];
  if (!list.length) return '';
  return `<div class="matpend"><b>📎 ${list.length === 1 ? 'Un material de pus' : `${list.length} materiale de pus`}</b>
    <span class="sub2" style="margin:0">N-am găsit singur unde se potrivesc. Mută cursorul unde vrei și apasă pe nume.</span>
    <div class="row">${list.map((a, i) => `<button class="btn sm" data-mp="${i}">＋ ${esc(a)}</button>`).join('')}</div></div>`;
}
function matBindPending(p) {
  p.querySelectorAll('[data-mp]').forEach(b => b.onclick = () => {
    const list = T.pr.materials_pending, name = list[+b.dataset.mp], info = T.assets.find(x => x.asset === name);
    if (!info) { toast('Nu mai găsesc fișierul în proiect.'); return; }
    list.splice(+b.dataset.mp, 1);
    tlAddAsset(info, info.type === 'video' ? 'full' : 'small');
  });
}
