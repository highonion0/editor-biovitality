/* BioVitality Editor - tabul „📜 Script” din Timeline: pentru fiecare frază din script, toate dublele găsite
   în filmare, care e aleasă, și poți alege alta (o asculți întâi). Bucățile și subtitrările se refac singure. */

S.script = {};
let scAudio = null, scStop = null;

async function renderScriptTab(force) {
  const body = $('#tInspBody'); if (!body || T.tab !== 'script') return;
  const id = T.id;
  if (!S.script[id] || force) {
    body.innerHTML = '<div class="sub2">Citesc potrivirea cu scriptul…</div>';
    S.script[id] = await fetch(`/api/script/${id}`).then(r => r.json()).catch(() => ({ units: [] }));
    S.script[id].saved = (S.script[id].units || []).map(u => u.chosen);       // alegerea salvata in proiect
    if (!T.on || T.id !== id || T.tab !== 'script') return;
  }
  const d = S.script[id];
  // alegerea curenta (cu Ctrl+Z si nesalvata inca) are prioritate fata de ce e salvat in proiect
  (d.units || []).forEach((u, k) => { u.chosen = T.scChosen ? (T.scChosen[k] ?? null) : d.saved[k]; });
  if (!d.units || !d.units.length) {
    body.innerHTML = `<div class="pbox"><h4 style="margin:0">📜 Script</h4>
      <p class="sub2">Aici vezi, pentru fiecare frază din script, toate dublele găsite în filmare și pe care a ales-o aplicația — și poți alege alta.</p>
      <p class="sub2">Video-ul acesta n-a fost procesat cu script, sau a fost procesat cu o versiune mai veche a aplicației.
        Dacă are script: în pagina video-ului apasă <b>„Refă cu setările actuale”</b>.</p></div>`;
    return;
  }
  const found = d.units.filter(u => u.chosen != null).length;
  body.innerHTML = `<div class="scbox">
    <div class="sub2" style="margin:0"><b>${found} din ${d.units.length}</b> fraze sunt în video, în ordinea din script.
      ▶ = ascultă dubla · click pe o dublă = o folosești pe ea. „🔈 încet” = spusă încet (probabil citită de pe ecran).</div>
    ${d.units.map((u, k) => `<div class="scu ${u.chosen == null ? 'miss' : ''}">
      <div class="scuh"><span class="scn">${k + 1}</span><span class="sct">${esc(u.text)}</span></div>
      ${u.takes.length ? `<div class="sctk">${u.takes.map((t, i) => `<span class="sctake ${u.chosen === i ? 'on' : ''}" data-k="${k}" data-i="${i}" title="${esc(t.said)}">
          <button class="scplay" data-play="${k}:${i}" title="Ascultă">▶</button>
          <span class="scpick">${fmtTC(t.a)} · ${Math.round(t.score * 100)}%${t.quiet ? ' · 🔈 încet' : ''}${u.chosen === i ? ' · ✓ aleasă' : ''}</span></span>`).join('')}
        ${u.chosen != null ? `<button class="btn sm" data-drop="${k}" title="Scoate fraza din video">✕ Scoate</button>` : ''}</div>`
        : '<div class="sub2" style="margin:0">✗ N-am găsit fraza asta în filmare (poate ai formulat-o mult diferit).</div>'}
    </div>`).join('')}</div>`;
  body.querySelectorAll('[data-play]').forEach(b => b.onclick = e => { e.stopPropagation(); const [k, i] = b.dataset.play.split(':').map(Number); scPlay(d.units[k].takes[i], b); });
  body.querySelectorAll('.sctake').forEach(el => el.onclick = () => {
    const k = +el.dataset.k, i = +el.dataset.i;
    if (d.units[k].chosen !== i) scChoose(k, i);
  });
  body.querySelectorAll('[data-drop]').forEach(b => b.onclick = () => scChoose(+b.dataset.drop, null));
}
// asculta o dubla din filmare (chiar daca nu e pe timeline): sunetul copiei de previzualizare, de la a la b
function scPlay(t, btn) {
  if (scAudio) { scAudio.pause(); clearTimeout(scStop); document.querySelectorAll('.scplay.on').forEach(x => { x.classList.remove('on'); x.textContent = '▶'; }); }
  if (btn && btn._on) { btn._on = false; return; }
  tlPause();
  scAudio = scAudio || new Audio();
  if (scAudio.src !== new URL(T.src, location.href).href) scAudio.src = T.src;
  scAudio.currentTime = Math.max(0, t.a - 0.1);
  scAudio.play().catch(() => toast('Nu pot reda sunetul.'));
  if (btn) { btn.classList.add('on'); btn.textContent = '■'; btn._on = true; }
  scStop = setTimeout(() => { scAudio.pause(); if (btn) { btn.classList.remove('on'); btn.textContent = '▶'; btn._on = false; } }, (t.b - t.a + 0.3) * 1000);
}
async function scChoose(k, i) {
  const r = await fetch(`/api/script/${T.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit: k, take: i, chosen: T.scChosen }) }).then(r => r.json()).catch(() => ({ error: 'Nu mă pot conecta la aplicație.' }));
  if (r.error) { toast(r.error); return; }
  S.script[T.id] = { units: r.units, saved: S.script[T.id].saved };
  tlChange(() => { T.segs = r.segments; if (r.captions && T.pr.captions) T.pr.captions = r.captions; T.scChosen = r.units.map(u => u.chosen); });
  toast(i == null ? `Am scos fraza ${k + 1}. Apasă „Salvează și randează” ca să intre în video.`
    : `Fraza ${k + 1} folosește acum dubla de la ${fmtTC(r.units[k].takes[i].a)}. Apasă „Salvează și randează” ca să intre în video.`);
  renderScriptTab();
}
