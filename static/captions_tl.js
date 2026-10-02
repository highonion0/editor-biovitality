/* BioVitality Editor - subtitrarile editate direct din Timeline (tabul „Aa Subtitrari”).
   Lucreaza pe T.pr.captions (timpul sursei), deci totul intra in Ctrl+Z si se salveaza cu „Salveaza si randeaza”. */

const TC = { sel: new Set(), anchor: null, open: false, focus: -1, local: false };
// modificare facuta chiar din lista: nu redesenez tot (ca sa nu sara derularea), doar ce s-a schimbat
function tcChange(fn) { TC.local = true; try { tlChange(fn); } finally { TC.local = false; } }
const tcKey = (c, w) => c + ':' + w;

function tcCues() {
  const cap = T.pr.captions; if (!cap || !cap.cues) return [];
  return cap.cues.map((c, i) => ({ c, i, ...tlCueOut(c) })).filter(x => x.b - x.a >= 0.05);
}
function tcWords() {
  const cap = T.pr.captions;
  return [...TC.sel].map(k => { const [c, w] = k.split(':').map(Number); return cap.cues[c] && cap.cues[c].words[w]; }).filter(Boolean);
}

function renderCaptionsTab() {
  const body = $('#tInspBody'); if (!body || T.tab !== 'cap') return;
  const keepList = $('#tcList') ? $('#tcList').scrollTop : null, main = $('#main'), keepMain = main ? main.scrollTop : 0;
  const cap = T.pr.captions;
  if (!cap || !cap.cues || !cap.cues.length) { body.innerHTML = '<div class="sub2">Video-ul acesta nu are subtitrări.</div>'; return; }
  body.innerHTML = `<div class="tcbox">
    <div id="tcBar"></div>
    <details class="tcstyle" id="tcDet" ${TC.open ? 'open' : ''}><summary>Stil pentru toate subtitrările · font, mărime, culoare, contur, poziție</summary><div id="tcStyle"></div></details>
    <div class="tclist" id="tcList"></div>
    <div class="hint" style="margin:0">Click pe cuvinte = selectezi (Shift = mai multe) · ✎ = rescrii fraza · se salvează cu „Salvează și randează”.</div></div>`;
  $('#tcDet').ontoggle = e => { TC.open = e.target.open; };
  tcBar(); tcStyle(); tcList();
  if (keepList != null) $('#tcList').scrollTop = keepList;
  if (main) main.scrollTop = keepMain;
}

/* ---- bara: B / I / U / culori pentru cuvintele selectate */
function tcState() {
  const ws = tcWords(), st = T.pr.captions.style;
  if (!ws.length) return {};
  return { b: ws.every(w => (w.b ?? st.bold)), i: ws.every(w => (w.i ?? st.italic)), u: ws.every(w => w.u),
    color: ws.every(w => w.color === ws[0].color) ? ws[0].color : null };
}
function tcBar() {
  const n = TC.sel.size, dis = n ? '' : 'disabled', s = tcState();
  $('#tcBar').innerHTML = `<div class="tbar" style="padding:0 0 10px;border:0">
    <button class="tb ${s.b ? 'on' : ''}" data-a="b" ${dis} title="Bold (Ctrl+B)"><b>B</b></button>
    <button class="tb ${s.i ? 'on' : ''}" data-a="i" ${dis} title="Italic (Ctrl+I)"><i style="font-family:Georgia,serif">I</i></button>
    <button class="tb ${s.u ? 'on' : ''}" data-a="u" ${dis} title="Subliniat (Ctrl+U)"><u>U</u></button>
    <span class="tsep"></span>
    ${PALETTE.map(c => `<button class="swc ${s.color === c ? 'on' : ''}" data-color="${c}" style="background:${c}" ${dis}></button>`).join('')}
    <input type="color" id="tcColor" ${dis} value="${s.color || '#E8A83B'}" title="Altă culoare">
    <button class="tb" data-a="clear" ${dis} title="Scoate stilurile de pe cuvintele selectate">✕</button>
    <span class="tsep"></span>
    <button class="tb" data-a="del" ${dis} title="Șterge cuvintele selectate (Delete)">🗑</button>
    <button class="tb" data-a="hide" ${dis} title="Ascunde frazele în care ai selectat cuvinte">👁‍🗨</button>
    <span class="selinfo">${n ? `${n} ${n === 1 ? 'cuvânt' : 'cuvinte'}` : ''}</span>
    <button class="btn sm" data-a="${n ? 'none' : 'all'}">${n ? 'Deselectează' : 'Selectează tot'}</button></div>`;
  const bar = $('#tcBar');
  bar.onclick = e => { const b = e.target.closest('button'); if (!b || b.disabled) return; if (b.dataset.color) tcColor(b.dataset.color); else tcAction(b.dataset.a); };
  let prev = null;
  $('#tcColor').onpointerdown = () => { prev = tlSnap(); };
  $('#tcColor').oninput = e => { tcWords().forEach(w => { w.color = e.target.value.toUpperCase(); }); tcRefresh(false); tlPaint(); };
  $('#tcColor').onchange = () => { tlCommit(prev || tlSnap()); prev = null; tcBar(); };
}
function tcAction(a) {
  const cap = T.pr.captions, st = cap.style;
  if (a === 'all') { tcCues().forEach(x => x.c.words.forEach((_, w) => TC.sel.add(tcKey(x.i, w)))); tcRefresh(true); return; }
  if (a === 'none') { TC.sel.clear(); tcRefresh(true); return; }
  if (a === 'del') { tcDeleteWords(); return; }
  if (a === 'hide') { tcHide([...new Set([...TC.sel].map(k => +k.split(':')[0]))], true); return; }
  const ws = tcWords(); if (!ws.length) return;
  const s = tcState();
  tcChange(() => ws.forEach(w => {
    if (a === 'b') { const v = !s.b; if (v === st.bold) delete w.b; else w.b = v; }
    if (a === 'i') { const v = !s.i; if (v === st.italic) delete w.i; else w.i = v; }
    if (a === 'u') { if (s.u) delete w.u; else w.u = true; }
    if (a === 'clear') { delete w.b; delete w.i; delete w.u; delete w.color; }
  }));
  tcRefresh(true);
}
function tcColor(c) {
  tcChange(() => tcWords().forEach(w => { if (c === T.pr.captions.style.color) delete w.color; else w.color = c; }));
  tcRefresh(true);
}

/* ---- lista de fraze */
function tcList() {
  const list = $('#tcList'); if (!list) return;
  list.innerHTML = tcCues().map(x => `<div class="cue ${TC.focus === x.i ? 'now' : ''} ${x.c.hidden ? 'hid' : ''}" data-c="${x.i}">
    <div class="cuetop"><button class="ctime" title="Arată pe video">${fmtTC(x.a)} – ${fmtTC(x.b)}</button>
      ${x.c.hidden ? '<span class="hidtag">ascunsă · nu apare pe video</span>' : ''}
      <span class="tcacts"><button class="cedit tcvis" title="${x.c.hidden ? 'Arată din nou pe video' : 'Ascunde de pe video (textul rămâne aici)'}">${x.c.hidden ? '👁 Arată' : '👁 Ascunde'}</button>
      <button class="cedit" data-edit title="Rescrie textul (sau dublu-click)">${ICON.edit}Rescrie</button>
      <button class="cedit tcdel" title="Șterge fraza de tot">🗑</button></span></div>
    <div class="cwords">${tcWordsHTML(x.c, x.i)}</div></div>`).join('');
  list.onclick = e => {
    const row = e.target.closest('.cue'); if (!row) return;
    const ci = +row.dataset.c, cue = T.pr.captions.cues[ci];
    if (e.target.closest('.ctime')) { tcShow(ci); return; }
    if (e.target.closest('.tcvis')) { tcHide([ci], !cue.hidden); return; }
    if (e.target.closest('.tcdel')) { tcDeleteCues([ci]); return; }
    if (e.target.closest('[data-edit]')) { tcEdit(ci); return; }
    const wEl = e.target.closest('.w'); if (!wEl) return;
    const k = tcKey(ci, +wEl.dataset.w);
    if (e.shiftKey && TC.anchor) {
      const flat = tcCues().flatMap(x => x.c.words.map((_, w) => tcKey(x.i, w)));
      const [a, b] = [flat.indexOf(TC.anchor), flat.indexOf(k)].sort((x, y) => x - y);
      if (a >= 0) flat.slice(a, b + 1).forEach(x => TC.sel.add(x));
    } else if (TC.sel.has(k)) TC.sel.delete(k); else TC.sel.add(k);
    TC.anchor = k; tcShow(ci, true); tcRefresh(true);
    void cue;
  };
  list.ondblclick = e => { const row = e.target.closest('.cue'); if (row && e.target.closest('.cwords')) { window.getSelection()?.removeAllRanges(); tcEdit(+row.dataset.c); } };
}
const tcWordsHTML = (c, ci) => c.words.map((w, wi) =>
  `<span class="w ${TC.sel.has(tcKey(ci, wi)) ? 'sel' : ''}" data-w="${wi}" style="${listWordCss(w)}">${esc(w.t)}</span>`).join(' ');
function tcRefresh(bar) {
  document.querySelectorAll('#tcList .cue').forEach(row => {
    const ci = +row.dataset.c, cue = T.pr.captions.cues[ci];
    const box = row.querySelector('.cwords'); if (cue && box && !box.querySelector('textarea')) box.innerHTML = tcWordsHTML(cue, ci);
  });
  if (bar) tcBar();
}
function tcShow(ci, keepList) {
  const cue = T.pr.captions.cues[ci]; if (!cue) return;
  TC.focus = ci; tlPause(); tlSeek(tlSrcToOut(cue.start) + 0.05);
  document.querySelectorAll('#tcList .cue').forEach(r => r.classList.toggle('now', +r.dataset.c === ci));
  void keepList;
}
function tcFocus(ci) {   // venit din click pe pista „Text”
  TC.focus = ci;
  const row = document.querySelector(`#tcList .cue[data-c="${ci}"]`);
  if (row) { row.scrollIntoView({ block: 'center' }); document.querySelectorAll('#tcList .cue').forEach(r => r.classList.toggle('now', r === row)); }
}
function tcEdit(ci) {
  const row = document.querySelector(`#tcList .cue[data-c="${ci}"] .cwords`); if (!row || row.querySelector('textarea')) return;
  const cue = T.pr.captions.cues[ci];
  row.innerHTML = `<textarea class="cinput">${esc(cue.words.map(w => w.t).join(' '))}</textarea><div class="cehint">Enter = salvează · Esc = renunță · gol = șterge fraza</div>`;
  const ta = row.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  let done = false;
  const finish = save => {
    if (done) return; done = true;
    if (!save) { row.innerHTML = tcWordsHTML(cue, ci); return; }
    const toks = ta.value.trim().split(/\s+/).filter(Boolean);
    [...TC.sel].forEach(k => { if (k.startsWith(ci + ':')) TC.sel.delete(k); });
    if (!toks.length) { tcDeleteCues([ci]); return; }
    const before = cue.words.map(w => w.t).join(' ');
    if (toks.join(' ') !== before) tcChange(() => { cue.words = alignStyles(cue.words, toks); });
    row.innerHTML = tcWordsHTML(cue, ci); tcBar();
  };
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); } if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
  ta.onblur = () => finish(true);
}

/* ---- stilul (pentru toate) */
function tcStyle() {
  const st = T.pr.captions.style, box = $('#tcStyle'); if (!box) return;
  const seg = (key, opts) => `<div class="segs" data-seg="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${st[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const sw = (key, list) => list.map(c => `<button class="swc ${st[key] === c ? 'on' : ''}" data-sk="${key}" data-c="${c}" style="background:${c}"></button>`).join('')
    + `<input type="color" data-k="${key}" value="${st[key]}">`;
  box.innerHTML = `<div class="tcgrid">
    <label>Font</label><select id="tcFont">${(S.fonts || []).map(f => `<option value="${esc(f.id)}" ${st.font === f.id ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select>
    <label>Mărime <output id="tcSz">${st.size.toFixed(1)}</output></label><input type="range" data-r="size" min="2" max="10" step="0.1" value="${st.size}">
    <label>Culoare</label><div class="colrow">${sw('color', PALETTE)}</div>
    <label>Evidențiere</label>${seg('mode', [['outline', 'Contur'], ['box', 'Fundal'], ['none', 'Nimic']])}
    ${st.mode === 'outline' ? `<label>Grosime contur</label><input type="range" data-r="outline" min="0.05" max="0.9" step="0.01" value="${st.outline}">` : ''}
    ${st.mode === 'box' ? `<label>Fundal</label><div class="colrow">${sw('box_color', DARKS.concat(['#FFFFFF', '#E8A83B']))}</div>
      <label>Opacitate fundal</label><input type="range" data-r="box_opacity" min="10" max="100" step="1" value="${st.box_opacity}">` : ''}
    <label>Animație</label>${seg('anim', [['none', 'Fără'], ['highlight', 'Evidențiere'], ['pop', 'Pop'], ['reveal', 'Apariție'], ['pill', 'Fundal'], ['single', 'Un cuvânt']])}
    ${['highlight', 'pop', 'pill'].includes(st.anim) ? `<label>Culoare animație</label><div class="colrow">${sw('anim_color', PALETTE)}</div>` : ''}
    <label>Poziție</label><div class="segs" id="tcPos"><button data-y="0.18">Sus</button><button data-y="0.5">Mijloc</button><button data-y="0.66">Jos</button></div>
    <label></label><div class="tctogs">
      <label class="chk"><input type="checkbox" data-t="uppercase" ${st.uppercase ? 'checked' : ''}>MAJUSCULE</label>
      <label class="chk"><input type="checkbox" data-t="bold" ${st.bold ? 'checked' : ''}>Bold pentru toate</label>
      <label class="chk"><input type="checkbox" data-t="italic" ${st.italic ? 'checked' : ''}>Italic pentru toate</label></div>
  </div>`;
  const again = () => { tcStyle(); tcRefresh(true); tlPaint(); };
  $('#tcFont').onchange = e => { tcChange(() => { st.font = e.target.value; }); again(); };
  box.querySelectorAll('[data-sk]').forEach(b => b.onclick = () => { tcChange(() => { st[b.dataset.sk] = b.dataset.c; }); again(); });
  box.querySelectorAll('[data-seg]').forEach(g => g.onclick = e => { const b = e.target.closest('button'); if (!b) return; tcChange(() => { st[g.dataset.seg] = b.dataset.v; }); again(); });
  box.querySelectorAll('[data-t]').forEach(i => i.onchange = () => { tcChange(() => { st[i.dataset.t] = i.checked; }); again(); });
  $('#tcPos').onclick = e => { const b = e.target.closest('[data-y]'); if (b) tlCapPreset(+b.dataset.y); };
  let prev = null;
  box.querySelectorAll('input[type=range][data-r], input[type=color][data-k]').forEach(i => {
    const k = i.dataset.r || i.dataset.k;
    i.onpointerdown = () => { prev = tlSnap(); };
    i.oninput = () => { st[k] = i.type === 'color' ? i.value.toUpperCase() : +i.value; if (k === 'size') $('#tcSz').textContent = (+i.value).toFixed(1); tlPaint(); };
    i.onchange = () => { tlCommit(prev || tlSnap()); prev = null; if (i.type === 'color') again(); };
  });
}

/* ---- ascunde / sterge */
function tcHide(list, hide) {
  const cues = T.pr.captions.cues;
  tcChange(() => list.forEach(ci => { if (!cues[ci]) return; if (hide) cues[ci].hidden = true; else delete cues[ci].hidden; }));
  TC.sel.clear(); renderCaptionsTab(); tlPaint();
  toast(hide ? (list.length === 1 ? 'Fraza nu mai apare pe video.' : `${list.length} fraze nu mai apar pe video.`) : 'Fraza apare din nou pe video.');
}
function tcDeleteCues(list) {
  const set = new Set(list);
  tcChange(() => { T.pr.captions.cues = T.pr.captions.cues.filter((_, i) => !set.has(i)); });
  TC.sel.clear(); TC.focus = -1; renderCaptionsTab(); tlPaint();
  toast(list.length === 1 ? 'Am șters fraza. Ctrl+Z o aduce înapoi.' : `Am șters ${list.length} fraze.`);
}
function tcDeleteWords() {
  const by = new Map();
  [...TC.sel].forEach(k => { const [c, w] = k.split(':').map(Number); if (!by.has(c)) by.set(c, new Set()); by.get(c).add(w); });
  if (!by.size) return;
  let n = 0;
  tcChange(() => {
    const cues = T.pr.captions.cues;
    by.forEach((ws, c) => { if (!cues[c]) return; const before = cues[c].words.length; cues[c].words = cues[c].words.filter((_, i) => !ws.has(i)); n += before - cues[c].words.length; });
    T.pr.captions.cues = cues.filter(c => c.words.length);     // frazele ramase goale dispar
  });
  TC.sel.clear(); renderCaptionsTab(); tlPaint();
  toast(`Am șters ${n} ${n === 1 ? 'cuvânt' : 'cuvinte'}. Ctrl+Z le aduce înapoi.`);
}
