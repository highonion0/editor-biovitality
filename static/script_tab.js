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
    const noCaps = !(T.pr.captions && T.pr.captions.cues && T.pr.captions.cues.length);
    body.innerHTML = `<div class="pbox"><h4 style="margin:0">📜 Script</h4>
      <p class="sub2">Aici vezi, pentru fiecare frază din script, toate dublele găsite în filmare și pe care a ales-o aplicația — și poți alege alta.</p>
      ${noCaps ? `<p class="sub2">Scriptul se potrivește cu filmarea după ce faci subtitrările (aplicația trebuie întâi să „audă” ce ai spus).</p>
        <button class="btn" id="scToCap">💬 Mergi la subtitrări</button>`
      : `<p class="sub2">Video-ul acesta n-a fost procesat cu script, sau a fost procesat cu o versiune mai veche a aplicației.
        Dacă are script: în pagina video-ului apasă <b>„Refă cu setările actuale”</b>.</p>`}</div>`;
    const tc = $('#scToCap'); if (tc) tc.onclick = () => { T.tab = 'cap'; tlTabs(); };
    return;
  }
  const found = d.units.filter(u => u.chosen != null).length;
  const whole = d.cuts === false && !T.scCut;          // „✏ Editez eu”: scriptul n-a taiat inca nimic
  const cutBox = d.cuts !== false ? ''
    : whole ? `<div class="sccut"><div><b>✂ Taie după script</b><br><span class="sub2" style="margin:0">Din ce e acum pe timeline păstrez doar dubla aleasă
        pentru fiecare frază, în ordinea din script, și scot reluările, bâlbele și ce nu e în script. Ctrl+Z anulează.</span></div>
        <button class="cta" id="scCut">✂ Taie după script</button></div>`
    : `<div class="sccut on"><span class="sub2" style="margin:0">✓ <b>Tăiat după script.</b> Dacă alegi altă dublă, tăietura se reface singură.
        Ctrl+Z te duce înapoi la cum era înainte.</span></div>`;
  body.innerHTML = `<div class="scbox">${cutBox}
    <div class="sub2" style="margin:0"><b>${found} din ${d.units.length}</b> ${whole ? 'fraze găsite în filmare (video-ul e încă întreg — tai tu sau apeși butonul de mai sus)' : 'fraze sunt în video, în ordinea din script'}.
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
  const cb = $('#scCut'); if (cb) cb.onclick = () => scCutAll(cb);
}
// „✂ Taie după script”: din ce e pe timeline raman doar dublele alese, in ordinea din script
async function scCutAll(btn) {
  btn.disabled = true; btn.textContent = 'Tai…';
  const r = await fetch(`/api/script-cut/${T.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments: T.segs, chosen: T.scChosen, settings: { margin: S.settings.margin, margin_after: S.settings.margin_after } }) })
    .then(r => r.json()).catch(() => ({ error: 'Nu mă pot conecta la aplicație.' }));
  if (r.error) { toast(r.error); renderScriptTab(); return; }
  const old = deep(T.segs);
  tlChange(() => { tlRemapItems(old, r.segments); T.segs = r.segments; T.scCut = { base: r.base }; T.sel = null; T.range = null; });
  toast(`Am tăiat după script: ${fmtS(Math.max(0, r.removed))} scoase. Ctrl+Z anulează.`);
  renderScriptTab();
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
    body: JSON.stringify({ unit: k, take: i, chosen: T.scChosen, segments: T.segs, cut: T.scCut }) })
    .then(r => r.json()).catch(() => ({ error: 'Nu mă pot conecta la aplicație.' }));
  if (r.error) { toast(r.error); return; }
  S.script[T.id] = { units: r.units, cuts: S.script[T.id].cuts, saved: S.script[T.id].saved };
  const old = deep(T.segs);
  tlChange(() => {
    if (JSON.stringify(old) !== JSON.stringify(r.segments)) { tlRemapItems(old, r.segments); T.segs = r.segments; }
    if (r.captions && T.pr.captions) T.pr.captions = r.captions;
    T.scChosen = r.units.map(u => u.chosen);
  });
  toast(i == null ? `Am scos fraza ${k + 1}. Apasă „Salvează și randează” ca să intre în video.`
    : `Fraza ${k + 1} folosește acum dubla de la ${fmtTC(r.units[k].takes[i].a)}. Apasă „Salvează și randează” ca să intre în video.`);
  renderScriptTab();
}
