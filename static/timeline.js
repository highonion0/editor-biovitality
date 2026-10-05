/* BioVitality Editor - timeline (etapa 2).
   Pista principala = bucatile pastrate din video-ul sursa, lipite una dupa alta (timp "final").
   Suprapunerile (poze / video) traiesc pe timpul final. Subtitrarile traiesc pe timpul sursei,
   deci urmeaza singure orice schimbare de taieturi. */

const TL = { PAD: 14, LANE_OV: 36, LANE_CAP: 26, LANE_ZOOM: 22, LANE_MAIN: 74, LANE_AU: 34, RULER: 26, SNAP_PX: 8 };
const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i;
const deep = o => JSON.parse(JSON.stringify(o));
const fmtTC = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };
const fmtS = t => (Math.round(t * 100) / 100).toString().replace('.', ',') + ' s';

/* ---------------------------------------------------------------- matematica timpului */
function tlTotal() { return T.segs.reduce((n, s) => n + (s[1] - s[0]), 0); }
function tlStarts() { let acc = 0; return T.segs.map(s => { const a = acc; acc += s[1] - s[0]; return a; }); }
function tlOutToSrc(t) {
  let acc = 0;
  for (let i = 0; i < T.segs.length; i++) {
    const s = T.segs[i], d = s[1] - s[0];
    if (t < acc + d || i === T.segs.length - 1) return { i, src: s[0] + clamp(t - acc, 0, d) };
    acc += d;
  }
  return { i: 0, src: 0 };
}
// bucatile pot fi in orice ordine (mutate); un timp dintr-o pauza taiata ajunge la bucata care urmeaza in sursa
function tlSrcToOut(t) {
  let acc = 0, nxt = null, last = null;
  for (const s of T.segs) {
    if (t >= s[0] && t <= s[1]) return acc + (t - s[0]);
    if (s[0] > t && (!nxt || s[0] < nxt[0])) nxt = [s[0], acc];
    if (!last || s[1] > last[0]) last = [s[1], acc + s[1] - s[0]];
    acc += s[1] - s[0];
  }
  return nxt ? nxt[1] : last ? last[1] : 0;
}
// unde apare o fraza pe timeline (prima ei parte, daca o bucata mutata a rupt-o in doua) - ca in core.captions_to_out
function tlCueOut(c) {
  const runs = []; let acc = 0, prev = -2;
  T.segs.forEach((s, i) => {
    const x = Math.max(s[0], c.start), y = Math.min(s[1], c.end);
    if (y - x > 1e-4) {
      const o = acc + (x - s[0]), r = runs[runs.length - 1];
      if (r && prev === i - 1 && x >= r.se - 1e-3) { r.b = o + (y - x); r.se = y; }
      else runs.push({ a: o, b: o + (y - x), ss: x, se: y });
      prev = i;
    }
    acc += s[1] - s[0];
  });
  if (!runs.length) { const a = tlSrcToOut(c.start); return { a, b: a }; }
  return runs.reduce((m, r) => (r.ss < m.ss ? r : m));
}
// cat se poate lungi bucata i fara sa intre peste alta bucata din aceeasi sursa
function tlSrcBounds(i) {
  const s = T.segs[i]; let lo = 0, hi = T.dur;
  T.segs.forEach((o, j) => { if (j === i) return; if (o[1] <= s[0] + 1e-3) lo = Math.max(lo, o[1]); if (o[0] >= s[1] - 1e-3) hi = Math.min(hi, o[0]); });
  return [lo, hi];
}
const xOf = t => TL.PAD + t * T.pps;
const tOf = x => (x - TL.PAD) / T.pps;

/* ---------------------------------------------------------------- deschidere / inchidere */
async function openTimeline(j) {
  let d;
  try { const r = await fetch(`/api/project/${j.id}`); d = await r.json(); if (!r.ok) throw new Error(d.error); }
  catch (err) { toast((err && err.message) || 'Nu pot deschide proiectul.'); return; }
  if (d.busy) { toast('Așteaptă să se termine procesarea video-ului.'); return; }
  // copia usoara pentru previzualizare (o face o singura data, apoi o refoloseste)
  const slow = setTimeout(() => toast('Pregătesc o copie ușoară pentru previzualizare (o singură dată)…'), 700);
  const pv = await fetch(`/api/preview/${j.id}`).then(r => r.json()).catch(() => ({}));
  clearTimeout(slow);
  if (pv.url) d.source = pv.url;
  Object.assign(T, {
    on: true, id: j.id, name: j.name, pr: d.project, visionDefault: d.vision_default || '', src: d.source, assetBase: d.asset_base, assets: d.assets,
    segs: deep(d.project.segments), ovs: deep(d.project.overlays || []), auds: deep(d.project.audio || []),
    look: deep(d.project.look || { color: { preset: 'original', brightness: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0 }, audio: { denoise: 'off', clear: false, loudness: false } }),
    zooms: deep(d.project.zooms || []), trans: deep(d.project.transitions || {}),
    dur: d.project.source_duration,
    sel: null, t: 0, playing: false, seg: 0, dirty: false, undo: [], redo: [], zoom: 1, pps: 60,
    film: null, filmImg: null, wave: null, ovEls: new Map(), auEls: new Map(), cur: 0, prep: -1, clip: T.clip || null, tab: 'props',
  });
  LK.presets = d.look_presets || {}; LK.def = d.look_default || null; LK.applied = JSON.stringify(T.look.audio);
  S.rendered = null; renderMain();
  if (d.draft) tlOfferDraft(d.draft);
  fetch(`/api/filmstrip/${j.id}`).then(r => r.json()).then(m => {
    if (m.error) return; const img = new Image(); img.onload = () => { T.film = m; T.filmImg = img; tlDrawClips(); }; img.src = m.url;
  }).catch(() => {});
  fetch(`/api/waveform/${j.id}`).then(r => r.json()).then(w => { if (!w.error) { T.wave = w; tlDrawClips(); } }).catch(() => {});
}
function leaveTimeline() {
  if (T.dirty && !confirm('Ai modificări care nu sunt încă în video. Ies acum? Rămân păstrate ca ciornă și le poți recupera când revii.')) return false;
  clearTimeout(T.asTimer); if (T.dirty) tlAutosave();
  tlPause(); T.on = false; T.ovEls = new Map(); T.auEls = new Map(); S.rendered = null; return true;
}

/* ---------------------------------------------------------------- schelet */
function buildTimeline() {
  S.rendered = 'timeline';
  const ar = `${T.pr.width} / ${T.pr.height}`;
  $('#main').innerHTML = `
    <div class="tlhead">
      <button class="btn" id="tBack">${ICON.back}Înapoi</button>
      <h2>Timeline · ${esc(T.name)}</h2>
      <span class="dirty" id="tDirty"></span>
      <button class="btn sm" id="tUndo" title="Anulează (Ctrl+Z)">↶ Anulează</button>
      <button class="btn sm" id="tRedo" title="Refă (Ctrl+Y)">↷ Refă</button>
      <button class="btn primary" id="tSave">${ICON.check}Salvează și randează</button>
    </div>
    <div class="tltop">
      <div class="card tlprev">
        <div class="tstage" id="tStage" style="aspect-ratio:${ar}">
          <div class="tbgl" id="tBgL"></div>
          <video class="tcutv" id="tCutV" muted playsinline preload="auto"></video>
          <div class="tvids" id="tVids">
            <video class="main" id="tVidA" src="${T.src}" preload="auto" playsinline></video>
            <video class="main" id="tVidB" src="${T.src}" preload="auto" playsinline muted style="visibility:hidden"></video>
          </div>
          <svg width="0" height="0" style="position:absolute"><filter id="tGrade" color-interpolation-filters="sRGB"><feColorMatrix id="tGradeM" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter></svg>
          <div class="tflash" id="tFlash"></div><div class="tzpt" id="tZoomPt" title="Punctul pe care se centrează zoom-ul"></div>
          <div class="tovl" id="tOvl"><div class="tbox" id="tBox"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i><b data-h="rot"></b></div></div>
          <div id="tAud" hidden></div>
          <div class="capbox" id="tCap" title="Trage ca să muți toate subtitrările"></div><div class="tguide" id="tGuide"></div>
        </div>
        <div class="tpctl">
          <button class="tbtn" id="tStart" title="La început (Home)">⏮</button>
          <button class="tbtn" id="tBackF" title="Un cadru înapoi (←)">◀</button>
          <button class="tbtn play" id="tPlay" title="Play / pauză (Space)">▶</button>
          <button class="tbtn" id="tFwdF" title="Un cadru înainte (→)">▶</button>
          <span class="tc" id="tTC"></span>
        </div>
        <div id="tSzHost"></div>
      </div>
      <div class="card tinsp" id="tInsp"><div class="itabs" id="tTabs"><button data-t="props">Proprietăți</button><button data-t="cap">Aa Subtitrări</button><button data-t="look">🎨 Look</button><button data-t="sfx">📚 Bibliotecă</button><button data-t="prop">💡 Propuneri</button><button data-t="pub">📣 Publicare</button><button data-t="ai">✦ Asistent</button></div><div id="tInspBody"></div></div>
    </div>
    <div class="card tlcard">
      <div class="tltools">
        <button class="tbtn" id="tAdd">${ICON.plus}Poză / video / muzică</button>
        <span class="gmenu"><button class="tbtn" id="tGfx">✦ Grafică</button><div class="gdrop" id="tGfxMenu" hidden>
          ${(S.templates || []).map(t => `<button data-tpl="${t.id}"><b>${esc(t.label)}</b><small>${esc(t.desc)}</small></button>`).join('')}</div></span>
        <button class="tbtn" id="tZoom" title="Zoom pe video la cursor (punch-in)">🔍 Zoom</button>
        <button class="tbtn" id="tSlot" title="Rezervă un loc pentru un clip generat în DaVinci">⬚ Loc B-roll</button>
        <button class="tbtn" id="tSplit" title="Taie bucata la cursor (S)">✂ Taie la cursor</button>
        <button class="tbtn" id="tDel" title="Șterge ce e selectat (Delete)">🗑 Șterge</button>
        <span class="sp"></span>
        <span class="zoom">Zoom <input type="range" id="tZoom" min="1" max="30" step="0.5" value="${T.zoom}"></span>
      </div>
      <div class="tlbody">
        <div class="tllabels" id="tLabels"></div>
        <div class="tlscroll" id="tScroll"><div class="tlinner" id="tInner"></div></div>
      </div>
    </div>
    <input type="file" id="tPick" accept="image/*,video/*,audio/*,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.m4v,.webm,.mkv,.mp3,.wav,.m4a,.aac,.ogg,.flac" multiple hidden>`;
  $('#tBack').onclick = () => { if (leaveTimeline()) renderAll(); };
  $('#tSave').onclick = tlSave;
  $('#tUndo').onclick = () => tlHistory(-1);
  $('#tRedo').onclick = () => tlHistory(1);
  $('#tPlay').onclick = () => (T.playing ? tlPause() : tlPlay());
  $('#tStart').onclick = () => tlSeek(0);
  $('#tBackF').onclick = () => tlSeek(T.t - 1 / T.pr.fps);
  $('#tFwdF').onclick = () => tlSeek(T.t + 1 / T.pr.fps);
  $('#tAdd').onclick = () => $('#tPick').click();
  $('#tGfx').onclick = e => { e.stopPropagation(); $('#tGfxMenu').hidden = !$('#tGfxMenu').hidden; };
  $('#tGfxMenu').onclick = e => { const b = e.target.closest('[data-tpl]'); if (!b) return; $('#tGfxMenu').hidden = true; tlAddGraphic(b.dataset.tpl); };
  document.addEventListener('click', () => { const m = $('#tGfxMenu'); if (m) m.hidden = true; });
  $('#tTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; T.tab = b.dataset.t; tlTabs(); };
  $('#tPick').onchange = e => { tlAddFiles([...e.target.files]); e.target.value = ''; };
  $('#tSplit').onclick = tlSplit;
  $('#tSlot').onclick = () => tlAddSlot({ start: T.t, end: T.t + 4, idea: '', prompt: '' }, true);
  $('#tZoom').onclick = () => moAddZoom();
  $('#tDel').onclick = tlDelete;
  $('#tZoom').oninput = e => { T.zoom = +e.target.value; tlRender(true); };
  T.vids = [$('#tVidA'), $('#tVidB')]; T.cur = 0; T.prep = -1;
  T.vids[0].addEventListener('loadedmetadata', () => { tlSeek(T.t); });
  T.vids.forEach(v => v.addEventListener('seeked', () => { if (!T.playing) tlPaint(); }));
  $('#tBox').addEventListener('pointerdown', tlBoxDown);
  lkApply(); szControl();
  $('#tCap').addEventListener('pointerdown', tlCapDown);
  new ResizeObserver(() => { tlPaint(); tlRender(); }).observe($('#tStage'));
  $('#tScroll').addEventListener('pointerdown', tlDown);
  $('#tOvl').addEventListener('pointerdown', tlStageDown);
  tlRender(true); tlTabs(); tlPaint(); tlDirtyUI();
}
function tlTabs() {
  document.querySelectorAll('#tTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === T.tab));
  if (T.tab === 'ai') renderAssistant(); else if (T.tab === 'sfx') renderLibrary(); else if (T.tab === 'prop') renderProposals();
  else if (T.tab === 'cap') renderCaptionsTab(); else if (T.tab === 'look') renderLook(); else if (T.tab === 'pub') renderPublish(); else tlInspector();
}

/* ---------------------------------------------------------------- randare timeline */
function tlAuLanes() { return T.auds.reduce((m, a) => Math.max(m, a.lane || 0), -1) + 2; }
function tlLanes() {
  const top = T.ovs.reduce((m, o) => Math.max(m, o.lane || 0), -1);
  return top + 2;   // pistele folosite + una libera deasupra
}
function tlRender(fit) {
  const sc = $('#tScroll'); if (!sc) return;
  const total = Math.max(0.5, tlTotal());
  const fitPps = Math.max(8, (sc.clientWidth - TL.PAD * 2 - 20) / total);
  const center = fit ? null : (sc.scrollLeft + sc.clientWidth / 2 - TL.PAD) / T.pps;
  T.pps = fitPps * T.zoom;
  const W = Math.ceil(xOf(total) + TL.PAD + 40);
  const nOv = tlLanes(), starts = tlStarts();
  // etichete
  let lab = `<div style="height:${TL.RULER}px"></div>`;
  for (let l = nOv - 1; l >= 0; l--) lab += `<div style="height:${TL.LANE_OV}px">${l === nOv - 1 ? 'Nou' : 'Supr. ' + (l + 1)}</div>`;
  lab += `<div style="height:${TL.LANE_CAP}px">Text</div><div style="height:${TL.LANE_ZOOM}px">🔍 Zoom</div><div style="height:${TL.LANE_MAIN}px">Video</div>`;
  const nAu = tlAuLanes();
  for (let l = 0; l < nAu; l++) lab += `<div style="height:${TL.LANE_AU}px">${l === nAu - 1 ? '♪ Nou' : '♪ Audio ' + (l + 1)}</div>`;
  $('#tLabels').innerHTML = lab;
  // rigla
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find(s => s * T.pps >= 70) || 60;
  let ruler = '';
  for (let t = 0; t <= total + 1e-6; t += step) ruler += `<i style="left:${xOf(t)}px"></i><span style="left:${xOf(t)}px">${fmtTC(t).replace(/\.0$/, '')}</span>`;
  let html = `<div class="truler" data-drag="scrub" style="width:${W}px">${ruler}</div>`;
  // suprapuneri
  for (let l = nOv - 1; l >= 0; l--) {
    html += `<div class="tlane ovlane ${l === nOv - 1 ? 'newlane' : ''}" data-lane="${l}" data-drag="scrub" style="width:${W}px">`;
    T.ovs.forEach((o, k) => {
      if ((o.lane || 0) !== l) return;
      const e = Math.min(o.end, total), sel = T.sel && T.sel.kind === 'ov' && T.sel.i === k;
      if (e <= o.start) return;
      const nm = o.type === 'graphic' ? `${tplLabel(o.template)}: ${tplText(o)}` : o.type === 'slot' ? `B-roll de pus: ${o.idea || 'fără descriere'}` : o.asset;
      html += `<div class="tov2 ${o.type} ${sel ? 'sel' : ''}" data-drag="ov" data-i="${k}" style="left:${xOf(o.start)}px;width:${Math.max(6, (e - o.start) * T.pps)}px">
        <span class="hdl l" data-drag="ovL" data-i="${k}"></span>${o.type === 'image' ? '🖼' : o.type === 'graphic' ? '✦' : o.type === 'slot' ? '⬚' : '🎬'}<span class="nm">${esc(nm)}</span>
        <span class="hdl r" data-drag="ovR" data-i="${k}"></span></div>`;
    });
    html += `</div>`;
  }
  // subtitrari (doar reper)
  html += `<div class="tlane caps" data-drag="scrub" style="width:${W}px">`;
  (T.pr.captions?.cues || []).forEach((c, ci) => {
    const { a, b } = tlCueOut(c);
    if (b - a < 0.05) return;
    html += `<div class="tcap ${c.hidden ? 'hid' : ''}" data-drag="capblk" data-i="${ci}" style="left:${xOf(a)}px;width:${(b - a) * T.pps}px" title="${c.hidden ? 'Ascunsă — nu apare pe video. Click = editează' : 'Click = editează fraza'}">${esc(c.words.map(w => w.t).join(' '))}</div>`;
  });
  html += `</div>`;
  // zoom-uri
  html += `<div class="tlane zoomlane" data-drag="scrub" style="width:${W}px">`;
  (T.zooms || []).forEach((z, k) => {
    const sel = T.sel && T.sel.kind === 'zoom' && T.sel.i === k;
    html += `<div class="tzoom ${sel ? 'sel' : ''}" data-drag="zoom" data-i="${k}" style="left:${xOf(z.start)}px;width:${Math.max(10, (z.end - z.start) * T.pps)}px">
      <span class="hdl l" data-drag="zoomL" data-i="${k}"></span>🔍 ${z.scale.toFixed(2)}×<span class="hdl r" data-drag="zoomR" data-i="${k}"></span></div>`;
  });
  html += `</div>`;
  // pista principala + taieturi
  html += `<div class="tlane main" data-drag="scrub" style="width:${W}px">`;
  T.segs.forEach((s, i) => {
    const sel = T.sel && T.sel.kind === 'clip' && T.sel.i === i;
    html += `<div class="tclip ${sel ? 'sel' : ''}" data-drag="clip" data-i="${i}" style="left:${xOf(starts[i])}px;width:${Math.max(4, (s[1] - s[0]) * T.pps)}px">
      <canvas data-c="${i}"></canvas><span class="hdl l" data-drag="clipL" data-i="${i}"></span><span class="hdl r" data-drag="clipR" data-i="${i}"></span></div>`;
  });
  tlCuts().forEach((c, k) => {
    const sel = T.sel && T.sel.kind === 'cut' && T.sel.i === k;
    const tr = c.kind === 'mid' || c.kind === 'join' ? (T.trans || {})[c.i] : null;
    html += `<button class="tcut ${sel ? 'sel' : ''} ${tr ? 'tr' : ''} ${c.kind === 'join' ? 'join' : ''}" data-drag="cut" data-i="${k}" style="left:${xOf(c.at)}px"
      title="${c.kind === 'join' ? 'Lipitură între bucăți mutate' : 'Pauză tăiată: ' + fmtS(c.len)}${tr ? ' · tranziție: ' + (TRANS.find(t => t[0] === tr.kind) || [])[1] : ''}">${tr ? '⇄' : c.kind === 'join' ? '⋮' : '✂'}</button>`;
  });
  html += `</div>`;
  for (let l = 0; l < nAu; l++) {
    html += `<div class="tlane aulane ${l === nAu - 1 ? 'newlane' : ''}" data-drag="scrub" style="width:${W}px">`;
    T.auds.forEach((a, k) => {
      if ((a.lane || 0) !== l) return;
      const e = Math.min(a.end, total); if (e <= a.start) return;
      const sel = T.sel && T.sel.kind === 'au' && T.sel.i === k;
      html += `<div class="tov2 tau ${sel ? 'sel' : ''}" data-drag="au" data-i="${k}" style="left:${xOf(a.start)}px;width:${Math.max(6, (e - a.start) * T.pps)}px">
        <span class="hdl l" data-drag="auL" data-i="${k}"></span>♪<span class="nm">${esc(a.asset)}</span><span class="vol">${Math.round((a.volume ?? 0.3) * 100)}%</span>
        <span class="hdl r" data-drag="auR" data-i="${k}"></span></div>`;
    });
    html += `</div>`;
  }
  html += `<div class="tphead" id="tPhead"></div>`;
  const inner = $('#tInner'); inner.style.width = W + 'px'; inner.innerHTML = html;
  if (center != null) sc.scrollLeft = Math.max(0, xOf(center) - sc.clientWidth / 2);
  tlDrawClips(); tlPlayhead();
}
function tlCuts() {
  // pauzele taiate: intre bucati, la inceput si la final. „join” = doua bucati mutate puse una langa alta
  const cuts = [], starts = tlStarts(), n = T.segs.length;
  if (n) { const lo = tlSrcBounds(0)[0]; if (T.segs[0][0] - lo > 0.01) cuts.push({ kind: 'head', at: 0, len: T.segs[0][0] - lo, a: lo, b: T.segs[0][0] }); }
  for (let i = 0; i + 1 < n; i++) {
    const a = T.segs[i][1], b = T.segs[i + 1][0], gap = b - a;
    const inside = T.segs.some((o, j) => j !== i && j !== i + 1 && o[0] < b && o[1] > a);
    if (gap > 0.005 && !inside) cuts.push({ kind: 'mid', i, at: starts[i + 1], len: gap, a, b });
    else if (Math.abs(gap) > 0.005) cuts.push({ kind: 'join', i, at: starts[i + 1], len: 0, a, b });
  }
  const last = T.segs[n - 1];
  if (last) { const hi = tlSrcBounds(n - 1)[1]; if (hi - last[1] > 0.01) cuts.push({ kind: 'tail', at: tlTotal(), len: hi - last[1], a: last[1], b: hi }); }
  return cuts;
}
function tlDrawClips() {
  if (!T.on) return;
  document.querySelectorAll('#tInner canvas[data-c]').forEach(cv => {
    const s = T.segs[+cv.dataset.c]; if (!s) return;
    const w = cv.parentElement.clientWidth, h = cv.parentElement.clientHeight, dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.min(16000, w * dpr)); cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const thH = h - 20;
    if (T.filmImg && T.film) {
      const f = T.film, tw = f.tile_w * thH / f.tile_h;
      for (let x = 0; x < w; x += tw) {
        const ts = s[0] + (x + tw / 2) / T.pps, idx = clamp(Math.floor(ts * f.rate), 0, f.count - 1);
        g.drawImage(T.filmImg, idx * f.tile_w, 0, f.tile_w, f.tile_h, x, 0, tw, thH);
      }
    }
    g.fillStyle = 'rgba(8,14,10,.75)'; g.fillRect(0, thH, w, 20);
    if (T.wave && T.wave.peaks.length) {
      g.fillStyle = 'rgba(148,193,160,.85)';
      for (let x = 0; x < w; x++) {
        const k = Math.floor((s[0] + x / T.pps) * T.wave.rate), v = (T.wave.peaks[k] || 0) / 255;
        const bh = Math.max(1, v * 16); g.fillRect(x, thH + 10 - bh / 2, 1, bh);
      }
    }
  });
}
function tlPlayhead() {
  const p = $('#tPhead'); if (!p) return;
  p.style.left = xOf(T.t) + 'px';
  $('#tTC').innerHTML = `<b>${fmtTC(T.t)}</b> / ${fmtTC(tlTotal())}`;
}

/* ---------------------------------------------------------------- previzualizare */
function tlPaint() {
  if (!T.on) return;
  const stage = $('#tStage'); if (!stage) return;
  const H = stage.clientHeight, total = tlTotal();
  // suprapuneri
  const ovl = $('#tOvl'), bgl = $('#tBgL'), seen = new Set();
  T.ovs.forEach((o, k) => {
    const id = o.id || (o.id = 'o' + Math.random().toString(36).slice(2, 8));
    seen.add(id);
    let el = T.ovEls.get(id);
    const key = o.type === 'graphic' ? 'gfx:' + o.template : o.type === 'slot' ? 'slot' : o.asset;
    if (!el || el.dataset.asset !== key) {
      if (el) { if (el._g) el._g.unmount(); el.remove(); }
      if (o.type === 'slot') {
        el = document.createElement('div'); el.className = 'tov slot';
      } else if (o.type === 'graphic') {
        el = document.createElement('div'); el.className = 'tov gfx';
        if (window.BVGraphics) el._g = window.BVGraphics.mount(el);
        else el.innerHTML = `<span class="gph">✦ ${esc(tplLabel(o.template))}</span>`;
      } else {
        el = document.createElement(o.type === 'image' ? 'img' : 'video');
        el.className = 'tov'; el.draggable = false;
        el.src = `${T.assetBase}/${encodeURIComponent(o.asset)}`;
        if (o.type === 'video') { el.preload = 'auto'; el.playsInline = true; }
      }
      el.dataset.asset = key;
      ovl.appendChild(el); T.ovEls.set(id, el);
    }
    const host = o.fit === 'bg' && bgl ? bgl : ovl;                // fundal = sub video-ul tau
    if (el.parentElement !== host) host.appendChild(el);
    el.dataset.i = k;
    const vis = T.t >= o.start && T.t < Math.min(o.end, total);
    const full = o.type === 'slot' || o.fit === 'cover';          // pe tot cadrul
    const m = moAt(o, T.t);                                        // keyframes + animatii de intrare/iesire
    if (o.fit === 'bg') {                                          // fundal: poza intreaga / decupata, cu marime si pozitie
      const r = moBgRect(o.bgimg || BG_DEFAULT, o.ar || 1, stage.clientWidth, stage.clientHeight);
      Object.assign(el.style, { display: vis ? 'block' : 'none', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px',
        objectFit: 'fill', opacity: m.opacity, zIndex: 0, transform: 'none', borderRadius: '0' });
    } else {
    const wpx = full ? stage.clientWidth : m.w * stage.clientWidth, hpx = full ? stage.clientHeight : wpx * (o.ar || 1);
    Object.assign(el.style, { display: vis ? 'block' : 'none', left: full ? '50%' : m.x * 100 + '%', top: full ? '50%' : m.y * 100 + '%',
      width: wpx + 'px', height: hpx + 'px', objectFit: full ? 'cover' : 'fill', opacity: m.opacity, zIndex: 10 + (o.lane || 0),
      transform: `translate(-50%, -50%) rotate(${full ? 0 : m.rotation}deg)`, borderRadius: full ? '0' : ((o.radius || 0) / 100) * Math.min(wpx, hpx) + 'px' });
    }
    if (o.type === 'slot') {
      const sig = (o.idea || '') + '|' + fmtTC(o.start) + fmtTC(o.end);
      if (el._sig !== sig) { el._sig = sig; el.innerHTML = `<div><b>⬚ B-roll de pus aici</b><span>${esc(o.idea || 'Scrie ce trebuie să se vadă')}</span>
        <small>${fmtTC(o.start)} – ${fmtTC(o.end)} · trage clipul din DaVinci aici</small></div>`; }
    }
    if (o.type === 'graphic' && el._g && vis) {
      const fps = T.pr.fps, f = Math.round((T.t - o.start) * fps), d = Math.max(1, Math.round((o.end - o.start) * fps));
      const sig = f + '|' + d + '|' + JSON.stringify(o.props);
      if (el._sig !== sig) { el._sig = sig; el._g.render(o.template, o.props || {}, f, d, fps); }
    }
    el.classList.toggle('sel', !!(T.sel && T.sel.kind === 'ov' && T.sel.i === k));
    if (o.type === 'video') {
      el.muted = o.muted !== false;
      const want = (o.source_start || 0) + (T.t - o.start);
      if (vis && T.playing) { if (el.paused) el.play().catch(() => {}); if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want; }
      else { if (!el.paused) el.pause(); if (vis && Math.abs(el.currentTime - want) > 0.04) el.currentTime = want; }
    }
  });
  for (const [id, el] of T.ovEls) if (!seen.has(id)) { if (el._g) el._g.unmount(); el.remove(); T.ovEls.delete(id); }
  // cutia cu manere pentru suprapunerea selectata
  const box = $('#tBox'), so = T.sel && T.sel.kind === 'ov' ? T.ovs[T.sel.i] : null;
  if (box) {
    const show = so && so.type !== 'slot' && so.fit !== 'cover' && so.fit !== 'bg' && T.t >= so.start && T.t < so.end && !T.playing;
    box.style.display = show ? 'block' : 'none';
    if (show) {
      const m = moAt(so, T.t), wpx = m.w * stage.clientWidth;
      Object.assign(box.style, { left: m.x * 100 + '%', top: m.y * 100 + '%', width: wpx + 'px', height: wpx * (so.ar || 1) + 'px',
        transform: `translate(-50%, -50%) rotate(${m.rotation}deg)` });
    }
  }
  // muzica / sunete
  const aud = $('#tAud'), seenA = new Set();
  T.auds.forEach(a => {
    const id = a.id || (a.id = 'a' + Math.random().toString(36).slice(2, 8));
    seenA.add(id);
    let el = T.auEls.get(id);
    if (!el || el.dataset.asset !== a.asset) {
      if (el) el.remove();
      el = document.createElement('audio'); el.preload = 'auto'; el.dataset.asset = a.asset;
      el.src = `${T.assetBase}/${encodeURIComponent(a.asset)}`; aud.appendChild(el); T.auEls.set(id, el);
    }
    const end = Math.min(a.end, total), vis = T.t >= a.start && T.t < end;
    const into = T.t - a.start, left = end - T.t, len = end - a.start;
    let g = 1;
    if (a.fade_in > 0) g = Math.min(g, into / Math.min(a.fade_in, len / 2));
    if (a.fade_out > 0) g = Math.min(g, left / Math.min(a.fade_out, len / 2));
    el.volume = clamp((a.volume ?? 0.3) * clamp(g, 0, 1), 0, 1);
    const want = (a.source_start || 0) + into;
    if (vis && T.playing) { if (el.paused) el.play().catch(() => {}); if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want; }
    else if (!el.paused) el.pause();
  });
  for (const [id, el] of T.auEls) if (!seenA.has(id)) { el.remove(); T.auEls.delete(id); }
  // subtitrarea curenta (subtitrarile sunt pe timpul sursei)
  const cap = T.pr.captions, capEl = $('#tCap');
  if (cap && cap.style && cap.cues && cap.cues.length) {
    const src = tlOutToSrc(T.t).src, cue = cap.cues.find(c => !c.hidden && src >= c.start && src < c.end);
    capPaint(capEl, cap.style, cue ? cue.words : null, H, src, cue);
  } else capEl.style.display = 'none';
  moPaintVideo();
  tlPlayhead();
}

/* zoom-ul si tranzitiile, pe playerele video (aceleasi formule ca la randare) */
function moPaintVideo() {
  const wrap = $('#tVids'); if (!wrap) return;
  // „tu peste el”: video-ul tau intra intr-o fereastra peste fundal (aceleasi formule ca la randare)
  const stage = $('#tStage'), r = stage ? moMainRect(T.t, stage.clientWidth, stage.clientHeight) : null;
  const bgo = T.ovs.find(x => x.fit === 'bg' && T.t >= x.start && T.t < x.end), bgl = $('#tBgL');
  if (bgl) bgl.style.background = bgo ? (bgo.bgimg || BG_DEFAULT).color : 'transparent';
  Object.assign(wrap.style, r ? { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', right: 'auto', bottom: 'auto',
    borderRadius: r.r + 'px', overflow: 'hidden', boxShadow: '0 8px 26px rgba(0,0,0,.45)' }
    : { left: '', top: '', width: '', height: '', right: '', bottom: '', borderRadius: '', overflow: '', boxShadow: '' });
  wrap.querySelectorAll('video.main').forEach(v => {
    const pos = r ? `${r.fx * 100}% ${r.fy * 100}%` : '';
    Object.assign(v.style, { objectFit: r ? 'cover' : '', objectPosition: pos, transform: r ? `scale(${r.zoom})` : '', transformOrigin: pos });
  });
  // decupat: video-ul tau ramane doar pentru sunet, iar peste fundal apare clipul transparent
  const cv = $('#tCutV'), co = r && bgo && bgo.pip && bgo.pip.shape === 'cut' ? bgo : null, cut = co && cutReady(co);
  if (cv) {
    if (cut) {
      if (cv.dataset.src !== cut) { cv.dataset.src = cut; cv.src = cut; }
      const pos = `${r.fx * 100}% ${r.fy * 100}%`, want = T.t - co.start;
      Object.assign(cv.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px',
        objectPosition: pos, transform: `scale(${r.zoom})`, transformOrigin: pos });
      if (T.playing) { if (cv.paused) cv.play().catch(() => {}); if (Math.abs(cv.currentTime - want) > 0.25) cv.currentTime = want; }
      else { if (!cv.paused) cv.pause(); if (Math.abs(cv.currentTime - want) > 0.04) cv.currentTime = want; }
    } else { cv.style.display = 'none'; if (!cv.paused) cv.pause(); }
  }
  const z = moZoomAt(T.t), tr = moTransAt(T.t);
  const sc = (z ? z.s : 1) * (tr.style.scale || 1);
  wrap.style.transform = z ? `scale(${sc}) translate(${z.ox / sc}%, ${z.oy / sc}%)` : (sc !== 1 ? `scale(${sc})` : '');
  const hideMain = $('#tCutV') && $('#tCutV').style.display === 'block';      // decupat: se vede doar clipul transparent
  wrap.style.opacity = hideMain ? 0 : tr.style.opacity != null ? tr.style.opacity : 1;
  const grade = T.look && !LK.off && !lkNeutral(T.look.color) ? 'url(#tGrade) ' : '';
  wrap.style.filter = (grade + (tr.style.blur ? `blur(${tr.style.blur.toFixed(2)}px)` : '')).trim() || 'none';
  const fl = $('#tFlash'); if (fl) { fl.style.opacity = tr.flash ? (tr.flash * 0.85).toFixed(3) : 0; }
  const zt = $('#tZoomPt');
  if (zt) {
    const sel = T.sel && T.sel.kind === 'zoom' ? T.zooms[T.sel.i] : null;
    zt.style.display = sel && !T.playing ? 'block' : 'none';
    if (sel) { zt.style.left = sel.x * 100 + '%'; zt.style.top = sel.y * 100 + '%'; }
  }
}
function moPipRect(pip, W, H) {    // ca core.pip_rect
  const ar = pip.shape === 'circle' ? 1 : pip.shape === 'tall' || pip.shape === 'cut' ? H / W : 1.25;
  const h = Math.min(H, pip.w * W * ar), w = h / ar;
  const x = Math.min(Math.max(0, pip.x * W - w / 2), W - w), y = Math.min(Math.max(0, pip.y * H - h / 2), H - h);
  return { x, y, w, h, r: pip.shape === 'circle' ? Math.min(w, h) / 2 : pip.shape === 'cut' ? 0 : Math.min(w, h) * 0.06 };
}
const BG_DEFAULT = { fit: 'contain', scale: 1, y: 0.5, color: '#000000' };
function moBgRect(b, ar, W, H) {   // ca core.bg_rect
  const w = (b.fit === 'cover' ? Math.max(W, H / ar) : Math.min(W, H / ar)) * b.scale, h = w * ar;
  return { x: (W - w) / 2, y: b.y * H - h / 2, w, h };
}
const PIP_KF = ['w', 'x', 'y', 'fx', 'fy', 'zoom'];      // ce se poate anima la fereastra (forma nu)
function moPipAt(pip, lt) {        // ca pipAt din Main.tsx: valorile ferestrei intre keyframes
  const p = { ...PIP_DEFAULT, ...pip };
  PIP_KF.forEach(f => { p[f] = moKeyAt(pip.keys, f, lt, p[f]); });
  return p;
}
function moMainRect(t, W, H) {     // ca mainRect din Main.tsx: intrare / iesire lina de 0,35 s
  const o = T.ovs.find(x => x.fit === 'bg' && x.pip && t >= x.start && t < x.end); if (!o) return null;
  const d = Math.min(0.35, (o.end - o.start) / 3), k = MO_EASE(Math.min(1, (t - o.start) / d, (o.end - t) / d));
  const pip = moPipAt(o.pip, t - o.start), p = moPipRect(pip, W, H), lerp = (a, b) => a + (b - a) * k;
  return { x: lerp(0, p.x), y: lerp(0, p.y), w: lerp(W, p.w), h: lerp(H, p.h), r: lerp(0, p.r),
    fx: lerp(0.5, pip.fx), fy: lerp(0.5, pip.fy), zoom: lerp(1, pip.zoom) };
}
/* Doua playere: cel activ ruleaza bucata curenta, cel de rezerva sta deja pozitionat la inceputul
   urmatoarei bucati dupa o taietura. La taietura isi schimba rolurile -> fara pauza de cautare. */
const tlActive = () => T.vids[T.cur], tlStandby = () => T.vids[1 - T.cur];
function tlShowActive() {
  T.vids.forEach((v, i) => { v.style.visibility = i === T.cur ? 'visible' : 'hidden'; v.muted = i !== T.cur; });
}
function tlNextJump(from) {
  for (let j = from + 1; j < T.segs.length; j++) if (Math.abs(T.segs[j][0] - T.segs[j - 1][1]) > 0.03) return j;
  return -1;
}
function tlPrep() {
  if (!T.vids) return;
  const j = tlNextJump(T.seg); T.prep = j;
  const sb = tlStandby();
  if (j >= 0 && sb.readyState >= 1) { sb.pause(); if (Math.abs(sb.currentTime - T.segs[j][0]) > 0.005) sb.currentTime = T.segs[j][0]; }
}
function tlSeek(t) {
  const total = tlTotal();
  T.t = clamp(t, 0, Math.max(0, total - 0.001));
  const m = tlOutToSrc(T.t); T.seg = m.i;
  const v = T.vids && tlActive(); if (v && v.readyState >= 1) v.currentTime = m.src;
  tlPrep(); tlPaint();
}
function tlPlay() {
  if (!T.vids) return;
  if (T.t >= tlTotal() - 0.05) T.t = 0;
  const m = tlOutToSrc(T.t); T.seg = m.i;
  const v = tlActive(); v.currentTime = m.src; tlShowActive();
  T.playing = true; $('#tPlay').textContent = '❚❚';
  v.play().catch(() => {}); tlPrep(); requestAnimationFrame(tlLoop);
}
function tlPause() {
  T.playing = false; if (T.vids) T.vids.forEach(v => v.pause());
  const b = $('#tPlay'); if (b) b.textContent = '▶';
  if (T.ovEls) for (const el of T.ovEls.values()) if (el.pause) el.pause();
  if (T.auEls) for (const el of T.auEls.values()) el.pause();
}
function tlLoop() {
  if (!T.playing || !T.on) return;
  const v = tlActive(), s = T.segs[T.seg]; if (!v || !s) { tlPause(); return; }
  let src = v.currentTime;
  if (src >= s[1] - 0.02) {
    const nx = T.segs[T.seg + 1];
    if (!nx) { tlPause(); T.t = tlTotal(); tlPaint(); return; }
    if (T.prep === T.seg + 1) {            // taietura: preda stafeta playerului de rezerva
      const sb = tlStandby();
      if (Math.abs(sb.currentTime - nx[0]) > 0.1) sb.currentTime = nx[0];
      sb.play().catch(() => {}); T.cur = 1 - T.cur; tlShowActive(); v.pause();
      T.seg++; src = Math.max(nx[0], sb.currentTime); tlPrep();
    } else {
      T.seg++;                              // bucati lipite (dupa „Taie la cursor”) -> continua acelasi player
      if (src < nx[0] - 0.05 || src > nx[0] + 0.1) { v.currentTime = nx[0]; src = nx[0]; }
    }
  }
  T.t = tlStarts()[T.seg] + clamp(src - T.segs[T.seg][0], 0, T.segs[T.seg][1] - T.segs[T.seg][0]);
  tlPaint();
  const sc = $('#tScroll'), x = xOf(T.t);
  if (sc && (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth - 40)) sc.scrollLeft = x - 60;
  requestAnimationFrame(tlLoop);
}

/* ---------------------------------------------------------------- istoric */
const tlSnap = () => JSON.stringify({ segs: T.segs, ovs: T.ovs, auds: T.auds, cs: T.pr.captions ? T.pr.captions.style : null,
  cc: T.pr.captions ? T.pr.captions.cues : null, lk: T.look, zo: T.zooms, tr: T.trans });
function tlCommit(prev) { if (prev === tlSnap()) return; T.undo.push(prev); if (T.undo.length > 200) T.undo.shift(); T.redo = []; T.dirty = true; tlDirtyUI(); tlAutosaveSoon(); }
function tlChange(fn) { const prev = tlSnap(); fn(); tlCommit(prev); tlAfter(); }
function tlHistory(dir) {
  const from = dir < 0 ? T.undo : T.redo, to = dir < 0 ? T.redo : T.undo;
  if (!from.length) return;
  to.push(tlSnap()); const st = JSON.parse(from.pop()); T.segs = st.segs; T.ovs = st.ovs; T.auds = st.auds || [];
  if (st.cs && T.pr.captions) T.pr.captions.style = st.cs;
  if (st.cc && T.pr.captions) T.pr.captions.cues = st.cc;
  if (st.lk) { T.look = st.lk; lkApply(); if (T.tab === 'look') renderLook(); }
  if (st.zo) T.zooms = st.zo;
  if (st.tr) T.trans = st.tr;
  T.sel = null; T.dirty = true; tlDirtyUI(); tlAfter(); tlAutosaveSoon();
}
function tlAfter() {
  T.t = Math.min(T.t, Math.max(0, tlTotal() - 0.001)); tlRender(); tlInspector(); tlSeek(T.t); szBadge();
  if (T.tab === 'cap' && !TC.local && !document.querySelector('#tcList textarea')) renderCaptionsTab();
}
function tlDirtyUI() {
  const d = $('#tDirty'); if (d) d.textContent = T.dirty ? '● Modificări nesalvate' : '';
  const u = $('#tUndo'), r = $('#tRedo'); if (u) u.disabled = !T.undo.length; if (r) r.disabled = !T.redo.length;
}

/* ---------------------------------------------------------------- actiuni */
function tlSplit() {
  const m = tlOutToSrc(T.t), s = T.segs[m.i];
  m.src = Math.round(m.src * 1000) / 1000;
  if (!s || m.src - s[0] < 0.05 || s[1] - m.src < 0.05) { toast('Mută cursorul în interiorul unei bucăți ca s-o tai.'); return; }
  tlChange(() => { T.segs.splice(m.i, 1, [s[0], m.src], [m.src, s[1]]); T.sel = { kind: 'clip', i: m.i + 1 }; });
}
function tlDelete() {
  if (!T.sel) { toast('Selectează întâi o bucată sau o suprapunere.'); return; }
  if (T.sel.kind === 'clip') {
    if (T.segs.length < 2) { toast('Nu poți șterge ultima bucată video.'); return; }
    tlChange(() => { T.segs.splice(T.sel.i, 1); T.sel = null; });
  } else if (T.sel.kind === 'ov') {
    tlChange(() => { T.ovs.splice(T.sel.i, 1); T.sel = null; });
  } else if (T.sel.kind === 'au') {
    tlChange(() => { T.auds.splice(T.sel.i, 1); T.sel = null; });
  } else if (T.sel.kind === 'zoom') { tlChange(() => { T.zooms.splice(T.sel.i, 1); T.sel = null; }); }
  else if (T.sel.kind === 'cut') { tlRestoreCut(T.sel.i); }
}
function tlRestoreCut(k, only) {
  const c = tlCuts()[k]; if (!c) return;
  if (c.kind === 'join') { toast('Aici nu e o pauză tăiată, ci două bucăți mutate una lângă alta.'); return; }
  tlChange(() => {
    const r3 = v => Math.round(v * 1000) / 1000;
    if (c.kind === 'head') T.segs[0][0] = only ? r3(Math.max(c.a, T.segs[0][0] - only)) : c.a;
    else if (c.kind === 'tail') { const l = T.segs[T.segs.length - 1]; l[1] = only ? r3(Math.min(c.b, l[1] + only)) : c.b; }
    else if (only) { T.segs[c.i][1] = r3(Math.min(T.segs[c.i + 1][0], T.segs[c.i][1] + only)); }
    else { T.segs[c.i][1] = T.segs[c.i + 1][1]; T.segs.splice(c.i + 1, 1); }
    T.sel = null;
  });
}
/* „🧍 Tu peste el”: fereastra in care apari tu peste fundal */
const PIP_DEFAULT = { shape: 'rect', w: 0.62, x: 0.5, y: 0.74, fx: 0.5, fy: 0.35, zoom: 1 };
// poza intreaga; daca e mai lata decat ecranul, sta putin mai sus, ca fereastra ta sa incapa dedesubt
const bgDefaultFor = o => ({ ...BG_DEFAULT, y: (o.ar || 1) < 16 / 9 ? 0.4 : 0.5 });
/* „✂ Decupat”: clipul cu tine decupat (facut o data pe server, de cutout.py) pentru portiunea acestui fundal */
const cutKey = o => `${o.start}|${o.end}|${JSON.stringify(T.segs)}`;
const cutReady = o => (o._cut && o._cut.key === cutKey(o) && o._cut.url) || null;
async function cutFetch(o, make) {
  const key = cutKey(o);
  if (make) { o._cut = { key, busy: true }; tlInspector(); }
  const r = await fetch(`/api/cutout/${T.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start: o.start, end: o.end, segments: T.segs, make }) }).then(r => r.json()).catch(() => ({ error: 'Nu mă pot conecta la aplicație.' }));
  o._cut = { key, url: r.url || null, error: r.error || null };
  if (make && r.error) toast(r.error);
  tlPaint(); if (T.sel && T.sel.kind === 'ov' && T.ovs[T.sel.i] === o) tlInspector();
}
function cutPanel(o) {
  if (!S.cutout) { fetch('/api/cutout-status').then(r => r.json()).then(s => { S.cutout = s; tlInspector(); }).catch(() => {}); return '<span class="sub2">…</span>'; }
  if (!S.cutout.ok) return `<div class="msg err" style="max-width:none">${esc(S.cutout.hint)} Până atunci, la randare apari într-o fereastră verticală.</div>`;
  const c = o._cut && o._cut.key === cutKey(o) ? o._cut : null;
  if (!c) { setTimeout(() => cutFetch(o, false), 0); return '<span class="sub2">Verific decuparea…</span>'; }
  if (c.busy) return `<div class="msg wait"><span class="spin"></span>Te decupez din fundal (${fmtS(o.end - o.start)} de video, ${esc(S.cutout.label)})… poate dura puțin.</div>`;
  if (c.url) return '<span class="sub2" style="margin:0">✓ Decuparea e gata și se vede în previzualizare. Dacă muți sau lungești fundalul, se refă.</span>';
  return `<div class="row"><button class="tbtn" id="cutMake">✂ Decupează acum (pentru previzualizare)</button></div>
    <span class="sub2" style="margin:0">Oricum se face singură la „Salvează și randează”.</span>`;
}
function pipPanel(o) {
  const lt = clamp(T.t - o.start, 0, o.end - o.start);
  const p = moPipAt(o.pip || PIP_DEFAULT, lt), keys = (o.pip && o.pip.keys) || [];
  const sh = (k, l) => `<button class="tbtn ${p.shape === k ? 'on' : ''}" data-shape="${k}">${l}</button>`;
  const cutBox = p.shape === 'cut' ? `<div class="cutbox">${cutPanel(o)}</div>` : '';
  const sl = (k, l, min, max, fmt) => `<label>${l}</label><input type="range" data-pk="${k}" min="${min}" max="${max}" step="0.005" value="${p[k]}"><output data-po="${k}">${fmt(p[k])}</output>`;
  const pc = v => Math.round(v * 100) + '%', zx = v => (+v).toFixed(2) + '×';
  const g = o.bgimg || BG_DEFAULT;
  const gsl = (k, l, min, max, fmt) => `<label>${l}</label><input type="range" data-gk="${k}" min="${min}" max="${max}" step="0.01" value="${g[k]}"><output data-go="${k}">${fmt(g[k])}</output>`;
  return `<div class="pipbox"><b>🖼 Poza din spate</b>
    <div class="row"><button class="tbtn ${g.fit === 'contain' ? 'on' : ''}" data-gfit="contain">Se vede toată</button>
      <button class="tbtn ${g.fit === 'cover' ? 'on' : ''}" data-gfit="cover">Umple ecranul</button>
      <label class="gcol">Culoare fundal <input type="color" id="gCol" value="${g.color}"></label></div>
    <div class="kv">${gsl('scale', 'Mărime poză', 0.3, 2, pc)}${gsl('y', 'Poziție verticală', 0, 1, pc)}</div></div>
    <div class="pipbox"><b>🧍 Fereastra ta</b><span class="sub2" style="margin:0">Poza / clipul e în spate, tu apari aici. Intră și iese lin.</span>
    <div class="row">${sh('rect', '▭ Dreptunghi')}${sh('circle', '● Cerc')}${sh('tall', '▯ Vertical')}${sh('cut', '✂ Decupat')}</div>
    ${cutBox}
    <div class="row"><button class="tbtn" data-ppos="0.5,0.74">⬇ Jos</button><button class="tbtn" data-ppos="0.3,0.76">↙ Stânga jos</button>
      <button class="tbtn" data-ppos="0.7,0.76">↘ Dreapta jos</button><button class="tbtn" data-ppos="0.5,0.28">⬆ Sus</button></div>
    <div class="kv">${sl('w', 'Mărime', 0.2, 1, pc)}${sl('x', 'Orizontal', 0, 1, pc)}${sl('y', 'Vertical', 0, 1, pc)}</div>
    <b style="margin-top:4px">Ce se vede din tine</b>
    <div class="kv">${sl('zoom', 'Zoom pe tine', 1, 3, zx)}${sl('fx', 'Încadrare stânga ↔ dreapta', 0, 1, pc)}${sl('fy', 'Încadrare sus ↕ jos', 0, 1, pc)}</div>
    <b style="margin-top:4px">◆ Keyframes ${keys.length ? `<span class="sub2" style="margin:0">(${keys.length})</span>` : ''}</b>
    <span class="sub2" style="margin:0">${keys.length ? 'Mută cursorul și schimbă fereastra: se salvează în keyframe-ul de la cursor (se face unul nou dacă nu e). Între ele se mișcă lin.'
      : 'Ca să te miști pe parcurs: pune un keyframe la început, mută cursorul, pune altul și schimbă poziția / mărimea / încadrarea.'}</span>
    <div class="row"><button class="tbtn" id="pkAdd">◆ Keyframe la cursor (${fmtTC(T.t)})</button>${keys.length ? '<button class="tbtn" id="pkClear">Șterge toate</button>' : ''}</div>
    ${keys.length ? `<div class="row pkl">${keys.map((k, i) => `<span class="pkc"><button class="btn sm" data-pkgo="${i}">◆ ${fmtTC(o.start + k.t)}</button><button class="btn sm" data-pkdel="${i}" title="Șterge keyframe-ul">✕</button></span>`).join('')}</div>` : ''}
    </div>`;
}
// o schimbare a ferestrei: fara keyframes -> valoarea de baza; cu keyframes -> keyframe-ul de la cursor (il face daca lipseste)
function pipSet(o, vals) {
  const pip = o.pip, keys = pip.keys || [];
  if (!keys.length) { Object.assign(pip, vals); return; }
  const lt = +clamp(T.t - o.start, 0, o.end - o.start).toFixed(3);
  let k = keys.find(x => Math.abs(x.t - lt) < 0.04);
  if (!k) { const cur = moPipAt(pip, lt); k = { t: lt }; PIP_KF.forEach(f => { k[f] = +(+cur[f]).toFixed(4); }); keys.push(k); keys.sort((a, b) => a.t - b.t); }
  Object.assign(k, vals);
}
function pipBind(p, o) {
  o.pip = o.pip || { ...PIP_DEFAULT };
  o.bgimg = o.bgimg || { ...BG_DEFAULT };
  p.querySelectorAll('[data-gfit]').forEach(b => b.onclick = () => tlChange(() => { o.bgimg.fit = b.dataset.gfit; o.bgimg.scale = 1; }));
  const col = $('#gCol', p); let cprev = null;
  col.onfocus = () => { cprev = tlSnap(); };
  col.oninput = () => { o.bgimg.color = col.value; tlPaint(); };
  col.onchange = () => { tlCommit(cprev || tlSnap()); cprev = null; };
  let gprev = null;
  p.querySelectorAll('input[data-gk]').forEach(inp => {
    inp.onpointerdown = () => { gprev = tlSnap(); };
    inp.oninput = () => { o.bgimg[inp.dataset.gk] = +inp.value; p.querySelector(`[data-go="${inp.dataset.gk}"]`).textContent = Math.round(+inp.value * 100) + '%'; tlPaint(); };
    inp.onchange = () => { tlCommit(gprev || tlSnap()); gprev = null; };
  });
  p.querySelectorAll('[data-shape]').forEach(b => b.onclick = () => {
    tlChange(() => { o.pip.shape = b.dataset.shape; if (b.dataset.shape === 'cut' && o.pip.w < 0.7) o.pip.w = 0.8; });
    if (b.dataset.shape === 'cut' && S.cutout && S.cutout.ok && !cutReady(o)) cutFetch(o, true);   // o pregatesc imediat
  });
  const cm = $('#cutMake', p); if (cm) cm.onclick = () => cutFetch(o, true);
  p.querySelectorAll('[data-ppos]').forEach(b => b.onclick = () => tlChange(() => { const [x, y] = b.dataset.ppos.split(',').map(Number); pipSet(o, { x, y }); }));
  let prev = null;
  p.querySelectorAll('input[data-pk]').forEach(inp => {
    const k = inp.dataset.pk;
    inp.onpointerdown = () => { prev = tlSnap(); };
    inp.oninput = () => { pipSet(o, { [k]: +inp.value }); p.querySelector(`[data-po="${k}"]`).textContent = k === 'zoom' ? (+inp.value).toFixed(2) + '×' : Math.round(+inp.value * 100) + '%'; tlPaint(); };
    inp.onchange = () => { tlCommit(prev || tlSnap()); prev = null; tlInspector(); };
  });
  $('#pkAdd', p).onclick = () => tlChange(() => {
    const pip = o.pip, lt = +clamp(T.t - o.start, 0, o.end - o.start).toFixed(3), cur = moPipAt(pip, lt);
    pip.keys = (pip.keys || []).filter(k => Math.abs(k.t - lt) >= 0.04);
    const k = { t: lt }; PIP_KF.forEach(f => { k[f] = +(+cur[f]).toFixed(4); });
    pip.keys.push(k); pip.keys.sort((a, b) => a.t - b.t);
  });
  const clr = $('#pkClear', p); if (clr) clr.onclick = () => tlChange(() => { const cur = moPipAt(o.pip, clamp(T.t - o.start, 0, o.end - o.start)); PIP_KF.forEach(f => { o.pip[f] = cur[f]; }); delete o.pip.keys; });
  p.querySelectorAll('[data-pkgo]').forEach(b => b.onclick = () => { tlPause(); tlSeek(o.start + o.pip.keys[+b.dataset.pkgo].t + 0.001); tlInspector(); });
  p.querySelectorAll('[data-pkdel]').forEach(b => b.onclick = () => tlChange(() => { o.pip.keys.splice(+b.dataset.pkdel, 1); if (!o.pip.keys.length) delete o.pip.keys; }));
}
function tlFreeLane(a, b) {
  for (let l = 0; l < 20; l++) if (!T.ovs.some(o => (o.lane || 0) === l && o.start < b && a < o.end)) return l;
  return 0;
}
// o poza / un clip pe timeline, intr-unul din cele 3 moduri: small = mic peste video, full = tot ecranul, bg = tu peste el
const MEDIA_MODES = [['small', '▣ Mic peste video'], ['full', '⛶ Tot ecranul'], ['bg', '🧍 Tu peste el']];
function tlMediaOverlay(info, a, b, mode) {
  const portrait = (info.height || 1) >= (info.width || 1);   // patrate (logo) si verticale -> mai inguste
  const o = { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: info.type, asset: info.asset,
    start: +a.toFixed(3), end: +b.toFixed(3), x: 0.5, y: 0.35, w: portrait ? 0.45 : 0.8, opacity: 1, muted: true, source_start: 0,
    lane: tlFreeLane(a, b), rotation: 0, radius: 0, ar: info.width ? +(info.height / info.width).toFixed(5) : 1 };
  if (mode === 'full') o.fit = 'cover';
  else if (mode === 'bg') { o.fit = 'bg'; o.pip = { ...PIP_DEFAULT }; o.bgimg = bgDefaultFor(o); }
  else if (mode === 'small') { o.radius = 4; o.anim_in = 'pop'; o.anim_out = 'fade'; }
  return o;
}
function tlAddAsset(info, mode) {
  const total = tlTotal(), a = clamp(T.t, 0, Math.max(0, total - 0.2));
  const len = info.type === 'video' ? Math.min(info.duration || 3, 6) : 3;
  const b = Math.min(total, a + len);
  if (info.type === 'audio') return tlAddAudio(info);
  const o = tlMediaOverlay(info, a, b, mode);
  tlChange(() => { T.ovs.push(o); T.sel = { kind: 'ov', i: T.ovs.length - 1 }; });
}
const tplOf = id => (S.templates || []).find(t => t.id === id);
const tplLabel = id => (tplOf(id) || {}).label || id;
function tplText(o) {
  const t = tplOf(o.template); if (!t) return '';
  const f = t.fields.find(f => f.t === 'text'); return f ? String((o.props || {})[f.k] ?? f.d) : '';
}
function tplTranscriptAt(a, b) {   // ce se spune intre a si b (timp final), ca idee implicita pentru B-roll
  const cues = (T.pr.captions && T.pr.captions.cues) || [];
  return cues.filter(c => { const r = tlCueOut(c); return r.b > a && r.a < b; }).map(c => c.words.map(w => w.t).join(' ')).join(' ').slice(0, 300);
}
function tplDefaults(t) { const p = {}; t.fields.forEach(f => { p[f.k] = f.d; }); return p; }
function tlNewGraphic(tid, a, b, extra) {
  const t = tplOf(tid); if (!t) return null;
  return Object.assign({ id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: 'graphic', template: tid,
    props: tplDefaults(t), start: +a.toFixed(3), end: +b.toFixed(3), x: t.x, y: t.y, w: t.w, opacity: 1, rotation: 0,
    lane: tlFreeLane(a, b), ar: t.ar }, extra || {});
}
function tlAddGraphic(tid) {
  const t = tplOf(tid), total = tlTotal(); if (!t) return;
  const a = clamp(T.t, 0, Math.max(0, total - 0.5)), b = Math.min(total, a + t.dur);
  const o = tlNewGraphic(tid, a, b);
  tlChange(() => { T.ovs.push(o); T.sel = { kind: 'ov', i: T.ovs.length - 1 }; });
  T.tab = 'props'; tlTabs(); tlSeek(a + Math.min(1, (b - a) / 2));
}
function tlAddSlot(o, select) {
  const total = tlTotal(), a = clamp(+o.start || 0, 0, Math.max(0, total - 0.3)), b = clamp(+o.end || a + 4, a + 0.3, total);
  const it = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: 'slot', start: +a.toFixed(3), end: +b.toFixed(3),
    idea: String(o.idea || '').slice(0, 300), prompt: String(o.prompt || '').slice(0, 3000), lane: tlFreeLane(a, b) };
  if (select) {
    tlChange(() => { T.ovs.push(it); T.sel = { kind: 'ov', i: T.ovs.length - 1 }; });
    T.tab = 'props'; tlTabs(); tlSeek(a + 0.2);
  } else T.ovs.push(it);
  return it;
}
// clipul descarcat din DaVinci ia locul rezervat: pe tot ecranul, fara sunet, taiat pe durata locului
function tlFillSlot(i, info) {
  const sl = T.ovs[i]; if (!sl || sl.type !== 'slot') return;
  const end = info.type === 'video' && info.duration ? Math.min(sl.end, sl.start + info.duration) : sl.end;
  tlChange(() => {
    T.ovs[i] = { id: sl.id, type: info.type, asset: info.asset, start: sl.start, end: +end.toFixed(3), x: 0.5, y: 0.5, w: 1, opacity: 1,
      muted: true, source_start: 0, lane: sl.lane, rotation: 0, radius: 0, ar: info.width ? +(info.height / info.width).toFixed(5) : 1,
      fit: 'cover', prompt: sl.prompt, idea: sl.idea };
    T.sel = { kind: 'ov', i };
  });
  toast(end < sl.end - 0.05 ? `Clipul are doar ${fmtS(info.duration)}; l-am pus pe cât ține.` : 'Am pus clipul în locul rezervat.');
}
function tlSlotAt(ev) {
  if (!ev || ev.clientX == null) return -1;
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  const hit = el && (el.closest('.tov.slot') || el.closest('.tov2.slot'));
  return hit ? +hit.dataset.i : -1;
}
function tlFreeAuLane(a, b) {
  for (let l = 0; l < 10; l++) if (!T.auds.some(x => (x.lane || 0) === l && x.start < b && a < x.end)) return l;
  return 0;
}
function tlAddAudio(info) {
  const total = tlTotal(), a = T.t < 0.5 ? 0 : clamp(T.t, 0, Math.max(0, total - 0.2));
  const b = Math.min(total, a + (info.duration || total));
  const it = { id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: 'audio', asset: info.asset,
    start: +a.toFixed(3), end: +b.toFixed(3), source_start: 0, volume: 0.3, fade_in: 0.5, fade_out: 1.5, lane: tlFreeAuLane(a, b) };
  tlChange(() => { T.auds.push(it); T.sel = { kind: 'au', i: T.auds.length - 1 }; });
}
function tlAddFiles(files, ev) {
  // tras pe un loc de B-roll (sau cand un loc e selectat) -> clipul umple locul
  let slot = tlSlotAt(ev);
  if (slot < 0 && T.sel && T.sel.kind === 'ov' && T.ovs[T.sel.i] && T.ovs[T.sel.i].type === 'slot' && files.length === 1) slot = T.sel.i;
  if (slot >= 0) {
    const f = files.find(f => /\.(mp4|mov|m4v|webm|mkv|png|jpe?g|webp)$/i.test(f.name));
    if (!f) { toast('Pune aici un clip video (sau o poză).'); return; }
    const sid = T.ovs[slot].id;
    toast(`Încarc „${f.name}” în locul de B-roll…`);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/asset/${T.id}`);
    xhr.setRequestHeader('X-Filename', encodeURIComponent(f.name));
    xhr.onload = () => {
      let r = {}; try { r = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status !== 200 || !r.asset) { toast(r.error || 'Încărcarea a eșuat.'); return; }
      T.assets.push(r);
      const i = T.ovs.findIndex(o => o.id === sid); if (i >= 0) tlFillSlot(i, r); else tlAddAsset(r);
    };
    xhr.onerror = () => toast('Nu mă pot conecta la aplicație.');
    xhr.send(f);
    return;
  }
  const ok = files.filter(f => /\.(png|jpe?g|webp|gif|mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name) || AUDIO_RE.test(f.name));
  if (ok.length < files.length) toast('Unele fișiere nu sunt poze, video-uri sau sunete și le-am sărit.');
  ok.forEach(f => {
    toast(`Încarc „${f.name}”…`);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/asset/${T.id}`);
    xhr.setRequestHeader('X-Filename', encodeURIComponent(f.name));
    xhr.onload = () => {
      let r = {}; try { r = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status !== 200 || !r.asset) { toast(r.error || 'Încărcarea a eșuat.'); return; }
      T.assets.push(r); tlAddAsset(r);
    };
    xhr.onerror = () => toast('Nu mă pot conecta la aplicație.');
    xhr.send(f);
  });
}

/* ---------------------------------------------------------------- tras cu mouse-ul pe timeline */
let TD = null;
function tlSnapT(t, exclude, list) {
  const pts = [0, tlTotal(), T.t, ...tlStarts()];
  T.ovs.forEach((o, k) => { if (!(list === T.ovs && k === exclude)) pts.push(o.start, o.end); });
  T.auds.forEach((a, k) => { if (!(list === T.auds && k === exclude)) pts.push(a.start, a.end); });
  const lim = TL.SNAP_PX / T.pps;
  let best = t, dist = lim;
  pts.forEach(p => { const d = Math.abs(p - t); if (d < dist) { dist = d; best = p; } });
  return best;
}
function tlDown(e) {
  const el = e.target.closest('[data-drag]'); if (!el || e.button !== 0) return;
  const kind = el.dataset.drag, i = +el.dataset.i;
  e.preventDefault();
  const r = $('#tInner').getBoundingClientRect();
  TD = { kind, i, x0: e.clientX, y0: e.clientY, prev: tlSnap(), moved: false, left: r.left };
  if (kind === 'scrub') { T.sel = null; tlInspector(); tlRender(); TD.scrub = true; tlSeek(tOf(e.clientX - r.left)); }
  else if (kind === 'zoom' || kind === 'zoomL' || kind === 'zoomR') {
    const z = T.zooms[i]; if (!z) { TD = null; return; }
    T.sel = { kind: 'zoom', i }; if (T.tab !== 'props') { T.tab = 'props'; tlTabs(); }
    TD = { ...TD, kind, i, z0: { ...z } }; tlRender(); tlInspector(); tlPaint();
  }
  else if (kind === 'capblk') {
    const cue = T.pr.captions.cues[i]; TD = null;
    if (cue) { tlSeek(tlSrcToOut(cue.start) + 0.05); T.sel = null; T.tab = 'cap'; tlTabs(); tcFocus(i); }
    return;
  }
  else if (kind === 'cut') { T.sel = { kind: 'cut', i }; if (T.tab !== 'props') { T.tab = 'props'; tlTabs(); } tlRender(); tlInspector(); TD = null; return; }
  else if (kind.startsWith('clip')) { T.sel = { kind: 'clip', i }; TD.orig = deep(T.segs[i]); if (kind === 'clip') tlSeek(tOf(e.clientX - r.left)); }
  else if (kind.startsWith('au')) { T.sel = { kind: 'au', i }; TD.orig = deep(T.auds[i]); }
  else { T.sel = { kind: 'ov', i }; TD.orig = deep(T.ovs[i]); }
  if (!TD.scrub) { if (T.tab !== 'props') { T.tab = 'props'; tlTabs(); } tlRender(); tlInspector(); tlPaint(); }
  window.addEventListener('pointermove', tlMove);
  window.addEventListener('pointerup', tlUp, { once: true });
}
function tlMove(e) {
  if (!TD) return;
  const dx = e.clientX - TD.x0, dt = dx / T.pps;
  if (Math.abs(dx) > 2 || Math.abs(e.clientY - TD.y0) > 4) TD.moved = true;
  if (TD.scrub) { tlSeek(tOf(e.clientX - TD.left)); return; }
  if (!TD.moved) return;
  const k = TD.kind, i = TD.i, total = tlTotal();
  if (k === 'zoom' || k === 'zoomL' || k === 'zoomR') { tlZoomMove(dt); tlRender(); tlPaint(); return; }
  if (k === 'clip') { tlReorderMove(e); return; }
  if (k === 'clipL') {
    const lo = tlSrcBounds(i)[0];
    T.segs[i][0] = +clamp(TD.orig[0] + dt, lo, TD.orig[1] - 0.1).toFixed(3);
  } else if (k === 'clipR') {
    const hi = tlSrcBounds(i)[1];
    T.segs[i][1] = +clamp(TD.orig[1] + dt, TD.orig[0] + 0.1, hi).toFixed(3);
  } else if (k === 'ov' || k === 'au') {
    const au = k === 'au', list = au ? T.auds : T.ovs, o = list[i], len = TD.orig.end - TD.orig.start;
    let a = clamp(TD.orig.start + dt, 0, Math.max(0, total - len));
    const sa = tlSnapT(a, i, list), sb = tlSnapT(a + len, i, list);
    a = sa !== a ? sa : (sb !== a + len ? sb - len : a);
    o.start = +clamp(a, 0, Math.max(0, total - len)).toFixed(3); o.end = +(o.start + len).toFixed(3);
    if (au) {   // pistele audio sunt sub video: in jos = pista urmatoare
      const dl = Math.round((e.clientY - TD.y0) / TL.LANE_AU);
      o.lane = clamp((TD.orig.lane || 0) + dl, 0, Math.min(9, tlAuLanes() - 1 + (dl > 0 ? 1 : 0)));
    } else {
      const dl = -Math.round((e.clientY - TD.y0) / TL.LANE_OV);
      o.lane = clamp((TD.orig.lane || 0) + dl, 0, Math.min(19, tlLanes() - 1 + (dl > 0 ? 1 : 0)));
    }
  } else if (k === 'ovL' || k === 'auL') {
    const list = k === 'auL' ? T.auds : T.ovs, o = list[i], timed = o.type !== 'image';
    let a = tlSnapT(clamp(TD.orig.start + dt, 0, TD.orig.end - 0.1), i, list);
    if (timed) a = Math.max(a, TD.orig.start - (TD.orig.source_start || 0));   // nu inainte de inceputul fisierului
    o.start = +a.toFixed(3);
    if (timed) o.source_start = +Math.max(0, (TD.orig.source_start || 0) + (a - TD.orig.start)).toFixed(3);
  } else if (k === 'ovR' || k === 'auR') {
    const list = k === 'auR' ? T.auds : T.ovs, o = list[i];
    let b = tlSnapT(clamp(TD.orig.end + dt, TD.orig.start + 0.1, total), i, list);
    const info = T.assets.find(x => x.asset === o.asset);
    if (o.type !== 'image' && info && info.duration) b = Math.min(b, o.start + info.duration - (o.source_start || 0));
    o.end = +b.toFixed(3);
  }
  if (!TD.raf) TD.raf = requestAnimationFrame(() => { if (TD) TD.raf = 0; tlRender(); tlInspector(); tlPaint(); });
}
function tlUp() {
  window.removeEventListener('pointermove', tlMove);
  if (TD && TD.kind === 'clip') {
    const d = TD; TD = null; tlReorderEnd(d);
    if (d.reorder && d.to !== d.i) tlMoveSeg(d.i, d.to); else if (d.reorder) tlRender();
    return;
  }
  if (TD && TD.moved && !TD.scrub) { tlCommit(TD.prev); tlAfter(); }
  TD = null;
}

/* ---------------------------------------------------------------- mutarea bucatilor (reordonare) */
// tragi bucata de pe pista principala: un semn arata unde ajunge; la eliberare se muta acolo
function tlReorderMove(e) {
  const dx = e.clientX - TD.x0;
  if (!TD.reorder) { if (Math.abs(dx) < 8 || T.segs.length < 2) return; TD.reorder = true; tlPause(); }
  const el = document.querySelector(`#tInner .tclip[data-i="${TD.i}"]`);
  if (el) { el.classList.add('moving'); el.style.transform = `translateX(${dx}px)`; }
  const tp = tOf(e.clientX - TD.left), starts = tlStarts();
  let to = 0;
  T.segs.forEach((s, j) => { if (j !== TD.i && tp > starts[j] + (s[1] - s[0]) / 2) to++; });
  TD.to = to;
  // pozitia semnului: intre bucatile ramase, in ordinea lor
  const rest = T.segs.map((s, j) => j).filter(j => j !== TD.i);
  const x = to < rest.length ? starts[rest[to]] : tlTotal();
  let mk = $('#tDropMk');
  if (!mk) { mk = document.createElement('div'); mk.id = 'tDropMk'; mk.className = 'tdropmk'; const lane = document.querySelector('#tInner .tlane.main'); if (lane) lane.appendChild(mk); }
  mk.style.left = xOf(x) + 'px';
}
function tlReorderEnd() {   // curata semnul si bucata trasa
  const mk = $('#tDropMk'); if (mk) mk.remove();
  document.querySelectorAll('#tInner .tclip.moving').forEach(el => { el.classList.remove('moving'); el.style.transform = ''; });
}
// muta bucata `from` pe pozitia `to`. Suprapunerile, zoom-urile si sunetele aflate in intregime pe o bucata
// se muta odata cu ea; subtitrarile (pe timpul sursei) o urmeaza singure; tranzitia de dupa bucata merge cu ea.
function tlMoveSeg(from, to) {
  const n = T.segs.length;
  to = clamp(to, 0, n - 1);
  if (from === to || !T.segs[from]) return;
  tlChange(() => {
    const oldStarts = tlStarts(), lens = T.segs.map(s => s[1] - s[0]), ids = T.segs.map((_, j) => j);
    const tr = {}; Object.entries(T.trans || {}).forEach(([k, v]) => { tr[k] = v; });
    const [seg] = T.segs.splice(from, 1); T.segs.splice(to, 0, seg);
    const [id] = ids.splice(from, 1); ids.splice(to, 0, id);
    const newStarts = tlStarts(), delta = {};
    ids.forEach((old, j) => { delta[old] = newStarts[j] - oldStarts[old]; });
    const owner = it => {   // bucata (indice vechi) pe care sta elementul in intregime
      for (let j = 0; j < n; j++) if (it.start >= oldStarts[j] - 1e-3 && it.end <= oldStarts[j] + lens[j] + 1e-3) return j;
      return -1;
    };
    const shift = it => { const j = owner(it); if (j < 0 || !delta[j]) return; it.start = +(it.start + delta[j]).toFixed(3); it.end = +(it.end + delta[j]).toFixed(3); };
    T.ovs.forEach(shift); T.auds.forEach(shift); (T.zooms || []).forEach(shift);
    const nt = {};
    Object.entries(tr).forEach(([k, v]) => { const j = ids.indexOf(+k); if (j >= 0 && j + 1 < n) nt[j] = v; });
    T.trans = nt;
    T.sel = { kind: 'clip', i: to };
  });
  toast(`Am mutat bucata pe poziția ${to + 1} din ${n}.`);
}

/* ---------------------------------------------------------------- tras suprapunerile pe previzualizare */
// tragerea blocurilor de zoom pe pista lor
function tlZoomMove(dt) {
  const z = T.zooms[TD.i], z0 = TD.z0, total = tlTotal(), len = z0.end - z0.start;
  if (TD.kind === 'zoom') { const a = clamp(z0.start + dt, 0, Math.max(0, total - len)); z.start = +a.toFixed(3); z.end = +(a + len).toFixed(3); }
  else if (TD.kind === 'zoomL') z.start = +clamp(z0.start + dt, 0, z.end - 0.2).toFixed(3);
  else z.end = +clamp(z0.end + dt, z.start + 0.2, total).toFixed(3);
}

// cand elementul are keyframes, modificarile facute la cursor intra in keyframe-ul de acolo
function moSyncKey(o) {
  if (!o || !(o.keys || []).length) return;
  const dur = Math.max(0.01, o.end - o.start), lt = +clamp(T.t - o.start, 0, dur).toFixed(3);
  let k = (o.keys || []).find(x => Math.abs(x.t - lt) < 0.04);
  if (!k) { k = { t: lt }; o.keys.push(k); o.keys.sort((a, b) => a.t - b.t); }
  MO_FIELDS.forEach(f => { k[f] = +(+(f === 'rotation' ? (o.rotation || 0) : f === 'opacity' ? (o.opacity ?? 1) : o[f])).toFixed(4); });
}

function tlStageDown(e) {
  // cu un zoom selectat: clic pe video = punctul pe care se centreaza
  if (T.sel && T.sel.kind === 'zoom' && !e.target.closest('.tov')) {
    const z = T.zooms[T.sel.i], r = $('#tStage').getBoundingClientRect();
    if (z) {
      e.preventDefault();
      tlChange(() => { z.x = +clamp((e.clientX - r.left) / r.width, 0, 1).toFixed(4); z.y = +clamp((e.clientY - r.top) / r.height, 0, 1).toFixed(4); });
      tlInspector(); return;
    }
  }
  const el = e.target.closest('.tov'); if (!el) return;
  e.preventDefault();
  const k = +el.dataset.i, o = T.ovs[k]; if (!o) return;
  T.sel = { kind: 'ov', i: k }; if (T.tab !== 'props') { T.tab = 'props'; tlTabs(); } tlRender(); tlInspector(); tlPaint();
  if (o.type === 'slot' || o.fit === 'cover' || o.fit === 'bg') return;
  const r = $('#tOvl').getBoundingClientRect(), prev = tlSnap(), m0 = moAt(o, T.t);
  const dx = e.clientX - (r.left + m0.x * r.width), dy = e.clientY - (r.top + m0.y * r.height);
  el.classList.add('drag');
  const move = ev => {
    o.x = +clamp((ev.clientX - dx - r.left) / r.width, -0.4, 1.4).toFixed(4);
    o.y = +clamp((ev.clientY - dy - r.top) / r.height, -0.4, 1.4).toFixed(4);
    if (Math.abs(o.x - 0.5) < 0.02) o.x = 0.5;
    tlPaint();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', () => { window.removeEventListener('pointermove', move); el.classList.remove('drag'); moSyncKey(o); tlPaint(); tlCommit(prev); tlInspector(); }, { once: true });
}

function tlBoxDown(e) {
  const h = e.target.dataset.h; if (!h || !T.sel || T.sel.kind !== 'ov') return;
  e.preventDefault(); e.stopPropagation();
  const o = T.ovs[T.sel.i], r = $('#tOvl').getBoundingClientRect(), prev = tlSnap(), m0 = moAt(o, T.t);
  const cx = r.left + m0.x * r.width, cy = r.top + m0.y * r.height;
  const d0 = Math.hypot(e.clientX - cx, e.clientY - cy) || 1, w0 = m0.w;
  const a0 = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI, r0 = m0.rotation;
  const move = ev => {
    if (h === 'rot') {
      let deg = r0 + Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI - a0;
      deg = ((deg + 540) % 360) - 180;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      else { const q = Math.round(deg / 90) * 90; if (Math.abs(deg - q) < 4) deg = q; }   // se lipeste de 0 / 90 / 180
      o.rotation = +deg.toFixed(1);
    } else {
      o.w = +clamp(w0 * Math.hypot(ev.clientX - cx, ev.clientY - cy) / d0, 0.03, 3).toFixed(4);
    }
    tlPaint();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', () => { window.removeEventListener('pointermove', move); moSyncKey(o); tlPaint(); tlCommit(prev); tlInspector(); }, { once: true });
}

/* Subtitrarea: tragi una, se muta toate (pozitia e a stilului, pentru tot video-ul). */
function tlCapDown(e) {
  const cs = T.pr.captions && T.pr.captions.style; if (!cs) return;
  e.preventDefault(); e.stopPropagation(); tlPause();
  const r = $('#tStage').getBoundingClientRect(), prev = tlSnap(), box = $('#tCap'), guide = $('#tGuide');
  const dx = e.clientX - (r.left + cs.pos_x * r.width), dy = e.clientY - (r.top + cs.pos_y * r.height);
  box.classList.add('drag');
  const move = ev => {
    let x = clamp((ev.clientX - dx - r.left) / r.width, 0.05, 0.95);
    const y = clamp((ev.clientY - dy - r.top) / r.height, 0.04, 0.96);
    const snap = Math.abs(x - 0.5) < 0.025; if (snap) x = 0.5;
    guide.classList.toggle('on', snap);
    cs.pos_x = +x.toFixed(4); cs.pos_y = +y.toFixed(4); tlPaint();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', () => {
    window.removeEventListener('pointermove', move); box.classList.remove('drag'); guide.classList.remove('on');
    tlCommit(prev); tlInspector();
  }, { once: true });
}
function tlCapPreset(y) {
  const cs = T.pr.captions && T.pr.captions.style; if (!cs) return;
  tlChange(() => { cs.pos_y = y; cs.pos_x = 0.5; });
  const cue = (T.pr.captions.cues || [])[0];                 // arat o subtitrare, ca sa se vada unde a ajuns
  if (cue && !T.pr.captions.cues.some(c => { const s = tlOutToSrc(T.t).src; return s >= c.start && s < c.end; })) tlSeek(tlSrcToOut(cue.start) + 0.05);
}

/* ---------------------------------------------------------------- copiere / lipire */
function tlCopy() {
  if (!T.sel || (T.sel.kind !== 'ov' && T.sel.kind !== 'au')) return false;
  const it = (T.sel.kind === 'ov' ? T.ovs : T.auds)[T.sel.i];
  T.clip = { kind: T.sel.kind, item: deep(it) };
  toast(`Copiat. Mută cursorul și apasă Ctrl+V ca s-o pui din nou.`);
  return true;
}
function tlPasteAt(t) {
  if (!T.clip) return false;
  const src = T.clip.item, len = src.end - src.start, total = tlTotal();
  const a = clamp(t, 0, Math.max(0, total - Math.min(len, total))), b = Math.min(total, a + len);
  if (b - a < 0.1) { toast('Nu mai e loc aici pe timeline.'); return true; }
  const it = { ...deep(src), id: (T.clip.kind === 'ov' ? 'o' : 'a') + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    start: +a.toFixed(3), end: +b.toFixed(3) };
  tlChange(() => {
    if (T.clip.kind === 'ov') { it.lane = tlFreeLane(a, b); T.ovs.push(it); T.sel = { kind: 'ov', i: T.ovs.length - 1 }; }
    else { it.lane = tlFreeAuLane(a, b); T.auds.push(it); T.sel = { kind: 'au', i: T.auds.length - 1 }; }
  });
  return true;
}

/* ---------------------------------------------------------------- panoul de proprietati */
function tlInspector() {
  if (T.tab !== 'props') return;
  const p = $('#tInspBody'); if (!p) return;
  const sel = T.sel;
  if (sel && sel.kind === 'clip' && T.segs[sel.i]) {
    const s = T.segs[sel.i];
    p.innerHTML = `<h4>Bucata ${sel.i + 1} din ${T.segs.length}</h4>
      <div class="sub2">Din video-ul original: ${fmtTC(s[0])} – ${fmtTC(s[1])} · durează ${fmtS(s[1] - s[0])}.<br>Trage de marginile ei pe timeline ca s-o lungești sau s-o scurtezi — poți intra și în porțiunea tăiată.
        Trage de mijlocul ei ca s-o muți în altă parte a video-ului.</div>
      <div class="kv"><label>Început</label><input class="tnum" id="iA" value="${s[0].toFixed(2)}"><span></span>
        <label>Sfârșit</label><input class="tnum" id="iB" value="${s[1].toFixed(2)}"><span></span></div>
      <div class="row"><button class="tbtn" id="iSplit">✂ Taie la cursor</button><button class="tbtn" id="iDel">🗑 Șterge bucata</button></div>
      <div class="row"><button class="tbtn" id="iEarly" ${sel.i ? '' : 'disabled'}>◀ Mută mai devreme</button>
        <button class="tbtn" id="iLate" ${sel.i + 1 < T.segs.length ? '' : 'disabled'}>Mută mai târziu ▶</button></div>`;
    const setEdge = (ix, v) => tlChange(() => {
      const n = parseFloat(String(v).replace(',', '.')); if (isNaN(n)) return;
      const lo = ix === 0 ? tlSrcBounds(sel.i)[0] : s[0] + 0.1;
      const hi = ix === 0 ? s[1] - 0.1 : tlSrcBounds(sel.i)[1];
      T.segs[sel.i][ix] = +clamp(n, lo, hi).toFixed(3);
    });
    $('#iA').onchange = e => setEdge(0, e.target.value);
    $('#iB').onchange = e => setEdge(1, e.target.value);
    $('#iSplit').onclick = tlSplit; $('#iDel').onclick = tlDelete;
    $('#iEarly').onclick = () => tlMoveSeg(sel.i, sel.i - 1);
    $('#iLate').onclick = () => tlMoveSeg(sel.i, sel.i + 1);
  } else if (sel && sel.kind === 'zoom' && T.zooms[sel.i]) {
    p.innerHTML = moZoomPanel(T.zooms[sel.i], sel.i);
    moBindZoom(p, T.zooms[sel.i], sel.i);
  } else if (sel && sel.kind === 'cut' && tlCuts()[sel.i]) {
    const c = tlCuts()[sel.i];
    const where = c.kind === 'head' ? 'la începutul video-ului' : c.kind === 'tail' ? 'la finalul video-ului' : 'între două bucăți';
    if (c.kind === 'join') {
      p.innerHTML = `<h4>⋮ Lipitură</h4>
        <div class="sub2">Aici se întâlnesc două bucăți pe care le-ai mutat (bucata ${c.i + 1} și bucata ${c.i + 2}). Poți pune o tranziție între ele.</div>
        ${moTransPanel(c.i)}`;
      moBindTrans(p, c.i);
      return;
    }
    p.innerHTML = `<h4>✂ Pauză tăiată</h4>
      <div class="sub2">${fmtS(c.len)} scoase ${where} (în original de la ${fmtTC(c.a)} la ${fmtTC(c.b)}).</div>
      <div class="row"><button class="tbtn" id="iRestore">↩ Readuce toată pauza</button>
        ${c.len > 0.25 ? `<button class="tbtn" id="iRestore2">Readuce doar 0,2 s</button>` : ''}</div>
      ${c.kind === 'mid' ? moTransPanel(c.i) : ''}`;
    $('#iRestore').onclick = () => tlRestoreCut(sel.i);
    const r2 = $('#iRestore2'); if (r2) r2.onclick = () => tlRestoreCut(sel.i, 0.2);
    if (c.kind === 'mid') moBindTrans(p, c.i);
  } else if (sel && sel.kind === 'ov' && T.ovs[sel.i] && T.ovs[sel.i].type === 'slot') {
    const o = T.ovs[sel.i];
    p.innerHTML = `<h4>⬚ Loc pentru B-roll</h4>
      <div class="sub2">Pe timeline de la ${fmtTC(o.start)} la ${fmtTC(o.end)} (${fmtS(o.end - o.start)}). Generezi clipul în DaVinci, apoi îl tragi aici.</div>
      <div class="gf"><label>Ce trebuie să se vadă (pentru tine)</label><input type="text" id="sIdea" value="${esc(o.idea)}" placeholder="ex: Neuroni care transmit semnale"></div>
      <div class="gf" style="margin-top:10px"><label>Prompt pentru DaVinci (engleză)</label>
        <textarea id="sPrompt" class="sprompt" placeholder="Scrie-l tu sau apasă „Scrie cu Claude”">${esc(o.prompt)}</textarea></div>
      <div class="row"><button class="cta" id="sCopy" ${o.prompt ? '' : 'disabled'}>📋 Copiază prompt-ul</button>
        <button class="tbtn" id="sWrite">✦ ${o.prompt ? 'Rescrie' : 'Scrie'} cu Claude</button></div>
      <div class="sub2" style="margin:12px 0 0">În DaVinci alege formatul <b>vertical 9:16</b> și o durată de cel puțin ${Math.ceil(o.end - o.start)} s.
        Generează, descarcă, apoi:</div>
      <div class="row" style="margin-top:6px"><button class="tbtn" id="sPick">🎬 Alege clipul descărcat</button><span class="hint" style="margin:0">sau trage-l pe locul din timeline / de pe video</span></div>
      <div class="kv" style="margin-top:14px">
        <label>Începe la</label><input class="tnum" data-n="start" value="${o.start.toFixed(2)}"><span></span>
        <label>Se termină la</label><input class="tnum" data-n="end" value="${o.end.toFixed(2)}"><span></span></div>
      <div class="row"><button class="tbtn" id="iDel">🗑 Șterge locul</button></div>
      <input type="file" id="sFile" accept="video/*,image/*" hidden>`;
    $('#sIdea').onchange = e => tlChange(() => { o.idea = e.target.value.slice(0, 300); });
    $('#sPrompt').onchange = e => tlChange(() => { o.prompt = e.target.value.slice(0, 3000); });
    $('#sPrompt').oninput = e => { $('#sCopy').disabled = !e.target.value.trim(); };
    $('#sCopy').onclick = () => {
      const txt = $('#sPrompt').value;
      navigator.clipboard.writeText(txt).then(() => toast('Prompt copiat. Lipește-l în DaVinci.'), () => { $('#sPrompt').select(); toast('Selectat — apasă Ctrl+C.'); });
    };
    $('#sWrite').onclick = async () => {
      const b = $('#sWrite'); b.disabled = true; b.textContent = '✦ Claude scrie…';
      const idea = $('#sIdea').value.trim() || tplTranscriptAt(o.start, o.end);
      const r = await fetch(`/api/broll-prompt/${T.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea, start: o.start, end: o.end, state: aiState() }) }).then(r => r.json()).catch(() => ({ error: 'Nu mă pot conecta la aplicație.' }));
      if (r.error) { toast(r.error); b.disabled = false; b.textContent = '✦ Scrie cu Claude'; return; }
      tlChange(() => { o.prompt = r.prompt; if (!o.idea) o.idea = idea.slice(0, 300); });
      tlInspector(); toast('Prompt-ul e gata.');
    };
    $('#sPick').onclick = () => $('#sFile').click();
    $('#sFile').onchange = e => { const f = e.target.files[0]; if (f) tlAddFiles([f]); e.target.value = ''; };
    p.querySelectorAll('input[data-n]').forEach(inp => inp.onchange = () => tlChange(() => {
      const n = parseFloat(inp.value.replace(',', '.')); if (isNaN(n)) return;
      if (inp.dataset.n === 'start') o.start = +clamp(n, 0, o.end - 0.3).toFixed(3); else o.end = +clamp(n, o.start + 0.3, tlTotal()).toFixed(3);
    }));
    $('#iDel').onclick = tlDelete;
  } else if (sel && sel.kind === 'ov' && T.ovs[sel.i] && T.ovs[sel.i].type === 'graphic') {
    const o = T.ovs[sel.i], t = tplOf(o.template) || { fields: [] };
    o.props = o.props || {};
    const pct = v => Math.round(v * 100) + '%';
    const field = f => {
      const v = o.props[f.k] ?? f.d;
      if (f.t === 'bool') return `<label class="chk" style="margin:4px 0"><input type="checkbox" data-f="${f.k}" ${v ? 'checked' : ''}>${esc(f.l)}</label>`;
      if (f.t === 'color') return `<div class="gf"><label>${esc(f.l)}</label><div class="colrow">${['#E8A83B', '#F3EDDD', '#94C1A0', '#FFFFFF', '#FF6B6B', '#4FC3F7']
        .map(c => `<button class="swc ${String(v).toUpperCase() === c ? 'on' : ''}" data-fc="${f.k}" data-c="${c}" style="background:${c}"></button>`).join('')}
        <input type="color" data-f="${f.k}" value="${esc(v)}"></div></div>`;
      return `<div class="gf"><label>${esc(f.l)}</label><input type="text" data-f="${f.k}" value="${esc(v)}"></div>`;
    };
    const sl = (key, label, min, max, step, fmt) => `<label>${label}</label><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${o[key] ?? (key === 'rotation' ? 0 : 1)}"><output data-o="${key}">${fmt(o[key] ?? (key === 'rotation' ? 0 : 1))}</output>`;
    p.innerHTML = `<h4>✦ ${esc(t.label || o.template)}</h4>
      <div class="sub2">${esc(t.desc || '')} Pe timeline de la ${fmtTC(o.start)} la ${fmtTC(o.end)}.
        ${S.engine && !S.engine.ok ? '<br><b style="color:var(--honey)">Grafica apare în video-ul final doar cu motorul Remotion.</b>' : ''}</div>
      <div class="gfields">${t.fields.map(field).join('')}</div>
      <div class="kv" style="margin-top:14px">
        <label>Apare la</label><input class="tnum" data-n="start" value="${o.start.toFixed(2)}"><span></span>
        <label>Dispare la</label><input class="tnum" data-n="end" value="${o.end.toFixed(2)}"><span></span>
        ${sl('w', 'Mărime', 0.2, 1.4, 0.01, pct)}${sl('x', 'Orizontal', 0, 1, 0.005, pct)}${sl('y', 'Vertical', 0, 1, 0.005, pct)}
        ${sl('opacity', 'Opacitate', 0.1, 1, 0.01, pct)}${sl('rotation', 'Rotire', -180, 180, 1, v => Math.round(v) + '°')}
      </div>
      ${moKeyRow(o)}
      <div class="row"><button class="tbtn" id="iUp">⬆ În față</button><button class="tbtn" id="iDown">⬇ În spate</button>
        <button class="tbtn" id="iDup">⧉ Duplică</button><button class="tbtn" id="iDel">🗑 Șterge</button></div>`;
    moBindKeys(p, o);
    p.querySelectorAll('input[type=text][data-f]').forEach(i => i.onchange = () => tlChange(() => { o.props[i.dataset.f] = i.value; }));
    p.querySelectorAll('input[type=text][data-f]').forEach(i => i.oninput = () => { o.props[i.dataset.f] = i.value; tlPaint(); });
    p.querySelectorAll('input[type=checkbox][data-f]').forEach(i => i.onchange = () => tlChange(() => { o.props[i.dataset.f] = i.checked; }));
    p.querySelectorAll('input[type=color][data-f]').forEach(i => { i.oninput = () => { o.props[i.dataset.f] = i.value.toUpperCase(); tlPaint(); }; i.onchange = () => tlChange(() => {}); });
    p.querySelectorAll('[data-fc]').forEach(b => b.onclick = () => tlChange(() => { o.props[b.dataset.fc] = b.dataset.c; }));
    let prev = null;
    p.querySelectorAll('input[type=range][data-k]').forEach(inp => {
      inp.onpointerdown = () => { prev = tlSnap(); };
      inp.oninput = () => { o[inp.dataset.k] = +inp.value; p.querySelector(`[data-o="${inp.dataset.k}"]`).textContent = inp.dataset.k === 'rotation' ? Math.round(+inp.value) + '°' : pct(+inp.value); moSyncKey(o); tlPaint(); };
      inp.onchange = () => { tlCommit(prev || tlSnap()); prev = null; };
    });
    p.querySelectorAll('input[data-n]').forEach(inp => inp.onchange = () => tlChange(() => {
      const n = parseFloat(inp.value.replace(',', '.')); if (isNaN(n)) return;
      if (inp.dataset.n === 'start') o.start = +clamp(n, 0, o.end - 0.2).toFixed(3); else o.end = +clamp(n, o.start + 0.2, tlTotal()).toFixed(3);
    }));
    $('#iUp').onclick = () => tlChange(() => { o.lane = Math.min(19, (o.lane || 0) + 1); });
    $('#iDown').onclick = () => tlChange(() => { o.lane = Math.max(0, (o.lane || 0) - 1); });
    $('#iDup').onclick = () => { T.clip = { kind: 'ov', item: deep(o) }; tlPasteAt(o.end); };
    $('#iDel').onclick = tlDelete;
  } else if (sel && sel.kind === 'ov' && T.ovs[sel.i]) {
    const o = T.ovs[sel.i], vid = o.type === 'video';
    const dflt = { radius: 0, rotation: 0 };
    const fmts = {};
    const slider = (key, label, min, max, step, fmt) => { fmts[key] = fmt; const v = o[key] ?? dflt[key] ?? 1; return `<label>${label}</label>
      <input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${v}"><output data-o="${key}">${fmt(v)}</output>`; };
    const pct = v => Math.round(v * 100) + '%';
    p.innerHTML = `<h4>${vid ? '🎬 Video suprapus' : '🖼 Poză'} · ${esc(o.asset)}</h4>
      <div class="sub2">Pe timeline de la ${fmtTC(o.start)} la ${fmtTC(o.end)}. Pe previzualizare: trage ca s-o muți, de colțuri ca s-o mărești, de bulina de sus ca s-o rotești. Ctrl+C / Ctrl+V ca s-o pui și în alte locuri.</div>
      <div class="kv">
        <label>Apare la</label><input class="tnum" data-n="start" value="${o.start.toFixed(2)}"><span></span>
        <label>Dispare la</label><input class="tnum" data-n="end" value="${o.end.toFixed(2)}"><span></span>
        ${o.fit === 'bg' ? slider('opacity', 'Opacitate fundal', 0.05, 1, 0.01, pct) : `${slider('w', 'Lățime', 0.05, 1.5, 0.01, pct)}
        ${slider('x', 'Orizontal', 0, 1, 0.005, pct)}
        ${slider('y', 'Vertical', 0, 1, 0.005, pct)}
        ${slider('opacity', 'Opacitate', 0.05, 1, 0.01, pct)}
        ${slider('radius', 'Colțuri rotunjite', 0, 50, 1, v => Math.round(v) + '%')}
        ${slider('rotation', 'Rotire', -180, 180, 1, v => Math.round(v) + '°')}`}
      </div>
      ${o.fit === 'bg' ? pipPanel(o) : ''}
      <div class="row" style="margin-top:10px">
        <button class="tbtn ${o.fit === 'cover' ? 'on' : ''}" id="iCover" title="Umple tot cadrul, decupat">⛶ Tot ecranul</button>
        <button class="tbtn ${o.fit === 'bg' ? 'on' : ''}" id="iBg" title="Poza / clipul umple ecranul în spate, iar tu apari într-o fereastră peste el">🧍 Tu peste el</button>
        <span class="pip"><button class="tbtn" data-pip="0.22,0.14" title="Colț stânga sus">↖</button><button class="tbtn" data-pip="0.78,0.14" title="Colț dreapta sus">↗</button>
        <button class="tbtn" data-pip="0.22,0.62" title="Colț stânga jos">↙</button><button class="tbtn" data-pip="0.78,0.62" title="Colț dreapta jos">↘</button></span></div>
      ${o.prompt ? `<div class="sub2" style="margin:10px 0 0">Prompt folosit: <button class="btn sm" id="iCopyP">📋 Copiază</button></div>` : ''}
      ${vid ? `<label class="chk" style="margin-top:12px"><input type="checkbox" id="iSound" ${o.muted === false ? 'checked' : ''}>Păstrează sunetul clipului</label>` : ''}
      ${o.fit === 'cover' || o.fit === 'bg' ? '' : moKeyRow(o)}
      <div class="row">
        <button class="tbtn" id="iUp" title="Pune-o deasupra">⬆ În față</button><button class="tbtn" id="iDown" title="Pune-o dedesubt">⬇ În spate</button>
        <button class="tbtn" id="iRot90">↻ 90°</button>
        <button class="tbtn" id="iDup">⧉ Duplică</button><button class="tbtn" id="iDel">🗑 Șterge</button>
      </div>`;
    if (o.fit !== 'cover' && o.fit !== 'bg') moBindKeys(p, o);
    if (o.fit === 'bg') pipBind(p, o);
    $('#iBg').onclick = () => tlChange(() => { if (o.fit === 'bg') { o.fit = 'free'; if (o.w > 0.95) o.w = 0.8; } else { o.fit = 'bg'; o.pip = o.pip || { ...PIP_DEFAULT }; o.bgimg = o.bgimg || bgDefaultFor(o); } });
    $('#iRot90').onclick = () => tlChange(() => { o.rotation = ((((o.rotation || 0) + 90) + 540) % 360) - 180; });
    let prev = null;
    p.querySelectorAll('input[type=range][data-k]').forEach(inp => {
      inp.onpointerdown = () => { prev = tlSnap(); };
      inp.oninput = () => { o[inp.dataset.k] = +inp.value; p.querySelector(`[data-o="${inp.dataset.k}"]`).textContent = fmts[inp.dataset.k](+inp.value); moSyncKey(o); tlPaint(); };
      inp.onchange = () => { tlCommit(prev || tlSnap()); prev = null; };
    });
    p.querySelectorAll('input[data-n]').forEach(inp => inp.onchange = () => tlChange(() => {
      const n = parseFloat(inp.value.replace(',', '.')); if (isNaN(n)) return;
      const total = tlTotal();
      if (inp.dataset.n === 'start') o.start = +clamp(n, 0, o.end - 0.1).toFixed(3);
      else o.end = +clamp(n, o.start + 0.1, total).toFixed(3);
    }));
    const snd = $('#iSound'); if (snd) snd.onchange = () => tlChange(() => { o.muted = !snd.checked; });
    $('#iCover').onclick = () => tlChange(() => { o.fit = o.fit === 'cover' ? 'free' : 'cover'; if (o.fit !== 'cover' && o.w > 0.95) o.w = 0.8; });
    p.querySelectorAll('[data-pip]').forEach(b => b.onclick = () => tlChange(() => {
      const [x, y] = b.dataset.pip.split(',').map(Number); o.fit = 'free'; o.w = 0.4; o.x = x; o.y = y; o.radius = o.radius || 12;
    }));
    const cpp = $('#iCopyP'); if (cpp) cpp.onclick = () => navigator.clipboard.writeText(o.prompt).then(() => toast('Prompt copiat.'));
    $('#iUp').onclick = () => tlChange(() => { o.lane = Math.min(19, (o.lane || 0) + 1); });
    $('#iDown').onclick = () => tlChange(() => { o.lane = Math.max(0, (o.lane || 0) - 1); });
    $('#iDup').onclick = () => tlChange(() => {
      const c = { ...deep(o), id: 'o' + Date.now().toString(36) }; const len = o.end - o.start, total = tlTotal();
      c.start = +Math.min(o.end, Math.max(0, total - len)).toFixed(3); c.end = +Math.min(total, c.start + len).toFixed(3);
      c.lane = tlFreeLane(c.start, c.end); T.ovs.push(c); T.sel = { kind: 'ov', i: T.ovs.length - 1 };
    });
    $('#iDel').onclick = tlDelete;
  } else if (sel && sel.kind === 'au' && T.auds[sel.i]) {
    const a = T.auds[sel.i], info = T.assets.find(x => x.asset === a.asset) || {};
    const row = (key, label, min, max, step, fmt) => `<label>${label}</label>
      <input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${a[key]}"><output data-o="${key}">${fmt(a[key])}</output>`;
    const f = { volume: v => Math.round(v * 100) + '%', fade_in: v => fmtS(v), fade_out: v => fmtS(v) };
    p.innerHTML = `<h4>♪ ${esc(a.asset)}</h4>
      <div class="sub2">Pe timeline de la ${fmtTC(a.start)} la ${fmtTC(a.end)}${info.duration ? ` · melodia are ${fmtTC(info.duration)}` : ''}. Trage-o ca s-o muți, de capete ca s-o scurtezi.</div>
      <div class="kv">
        <label>Apare la</label><input class="tnum" data-n="start" value="${a.start.toFixed(2)}"><span></span>
        <label>Se oprește la</label><input class="tnum" data-n="end" value="${a.end.toFixed(2)}"><span></span>
        <label>Pornește din melodie la</label><input class="tnum" data-n="source_start" value="${(a.source_start || 0).toFixed(2)}"><span></span>
        ${row('volume', 'Volum', 0, 2, 0.01, f.volume)}
        ${row('fade_in', 'Intrare lină', 0, 5, 0.1, f.fade_in)}
        ${row('fade_out', 'Ieșire lină', 0, 5, 0.1, f.fade_out)}
      </div>
      <div class="sub2" style="margin:10px 0 0">Pentru muzică sub voce, 20–35% e de obicei potrivit. În previzualizare volumul se oprește la 100%; peste, se aude doar în video-ul final.</div>
      <div class="row"><button class="tbtn" id="iFull">↔ Pe tot video-ul</button>
        <button class="tbtn" id="iDup">⧉ Duplică</button><button class="tbtn" id="iDel">🗑 Șterge</button></div>`;
    let prev = null;
    p.querySelectorAll('input[type=range][data-k]').forEach(inp => {
      inp.onpointerdown = () => { prev = tlSnap(); };
      inp.oninput = () => { a[inp.dataset.k] = +inp.value; p.querySelector(`[data-o="${inp.dataset.k}"]`).textContent = f[inp.dataset.k](+inp.value); tlPaint(); if (inp.dataset.k === 'volume') tlRender(); };
      inp.onchange = () => { tlCommit(prev || tlSnap()); prev = null; };
    });
    p.querySelectorAll('input[data-n]').forEach(inp => inp.onchange = () => tlChange(() => {
      const n = parseFloat(inp.value.replace(',', '.')); if (isNaN(n)) return;
      const total = tlTotal(), k = inp.dataset.n;
      if (k === 'start') a.start = +clamp(n, 0, a.end - 0.1).toFixed(3);
      else if (k === 'end') a.end = +clamp(n, a.start + 0.1, total).toFixed(3);
      else a.source_start = +clamp(n, 0, Math.max(0, (info.duration || 1e6) - 0.1)).toFixed(3);
    }));
    $('#iFull').onclick = () => tlChange(() => { a.start = 0; a.end = +Math.min(tlTotal(), (info.duration || 1e6) - (a.source_start || 0)).toFixed(3); });
    $('#iDup').onclick = () => { T.clip = { kind: 'au', item: deep(a) }; tlPasteAt(a.end); };
    $('#iDel').onclick = tlDelete;
  } else {
    const cuts = tlCuts().filter(c => c.kind !== 'join');
    p.innerHTML = `<h4>${T.segs.length} ${T.segs.length === 1 ? 'bucată' : 'bucăți'} · ${fmtTC(tlTotal())}</h4>
      <div class="sub2">${cuts.length} ${cuts.length === 1 ? 'pauză tăiată' : 'pauze tăiate'} (${fmtS(cuts.reduce((n, c) => n + c.len, 0))}). Click pe un ✂ ca s-o readuci, pe o bucată ca s-o ajustezi, pe o suprapunere ca s-o reglezi.</div>
      ${matPendingHTML()}
      ${szPanelHTML()}
      ${T.pr.captions && T.pr.captions.cues && T.pr.captions.cues.length ? `<div class="capq"><b>Subtitrări</b>
        <div class="segs" id="capPos"><button data-y="0.18">Sus</button><button data-y="0.5">Mijloc</button><button data-y="0.66">Jos</button></div>
        <span class="hint" style="margin:0">sau trage subtitrarea pe video — se mută toate odată</span></div>` : ''}
      <div class="keys"><kbd>Space</kbd><span>play / pauză</span><kbd>Z</kbd><span>zoom la cursor</span><kbd>S</kbd><span>taie bucata la cursor</span><kbd>Alt ←/→</kbd><span>mută bucata selectată</span>
        <kbd>Delete</kbd><span>șterge ce e selectat</span><kbd>← →</kbd><span>un cadru (Shift = o secundă)</span>
        <kbd>Ctrl+C / V</kbd><span>copiază / lipește la cursor</span>
        <kbd>Ctrl+Z / Y</kbd><span>anulează / refă</span></div>
      ${T.assets.length ? `<div class="sub2" style="margin:16px 0 0">Materialele tale — click ca să adaugi la cursor:</div>
      <div class="assets">${T.assets.map((a, k) => `<button class="asset" data-a="${k}"><div class="th" style="${a.type === 'image' ? `background-image:url('${T.assetBase}/${encodeURIComponent(a.asset)}')` : ''}">${a.type === 'video' ? '🎬 video' : a.type === 'audio' ? '♪ sunet' : ''}</div><small>${esc(a.asset)}</small></button>`).join('')}</div>` :
      `<div class="sub2" style="margin:16px 0 0">Trage poze, video-uri sau melodii (MP3, WAV…) direct în fereastră.</div>`}`;
    p.querySelectorAll('[data-a]').forEach(b => b.onclick = () => tlAddAsset(T.assets[+b.dataset.a]));
    const cp = $('#capPos'); if (cp) cp.onclick = e => { const b = e.target.closest('[data-y]'); if (b) tlCapPreset(+b.dataset.y); };
    szBindPanel(p);
    matBindPending(p);
  }
}

/* ---------------------------------------------------------------- salvare automata (ciorna) */
function tlState() {
  return { segments: T.segs, overlays: T.ovs, audio: T.auds, caption_style: T.pr.captions ? T.pr.captions.style : null,
    caption_cues: T.pr.captions ? T.pr.captions.cues : null, look: T.look, zooms: T.zooms, transitions: T.trans };
}
function tlAutosaveSoon() { clearTimeout(T.asTimer); T.asTimer = setTimeout(tlAutosave, 1000); }
async function tlAutosave() {
  if (!T.on || !T.dirty) return;
  const id = T.id;
  const r = await fetch(`/api/timeline-draft/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tlState()) }).then(r => r.json()).catch(() => null);
  const d = $('#tDirty');
  if (r && r.ok && T.on && T.id === id && d && T.dirty) {
    const hh = new Date(r.saved_at * 1000).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    d.textContent = `● Nesalvat în video · ciornă păstrată ${hh}`;
  }
}
function tlOfferDraft(draft) {
  const head = document.querySelector('.tlhead'); if (!head || !draft) return;
  const when = new Date(draft.saved_at * 1000).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  head.insertAdjacentHTML('afterend', `<div class="draftbar" id="tDraftBar"><span>🛟 Ai modificări nesalvate din <b>${esc(when)}</b> (ciornă păstrată automat).</span>
    <button class="btn sm primary" id="tDraftUse">Recuperează-le</button><button class="btn sm" id="tDraftDrop">Renunță la ele</button></div>`);
  $('#tDraftUse').onclick = () => {
    tlChange(() => {
      if (Array.isArray(draft.segments) && draft.segments.length) T.segs = draft.segments;
      if (Array.isArray(draft.overlays)) T.ovs = draft.overlays;
      if (Array.isArray(draft.audio)) T.auds = draft.audio;
      if (T.pr.captions && draft.caption_style) T.pr.captions.style = draft.caption_style;
      if (T.pr.captions && Array.isArray(draft.caption_cues)) T.pr.captions.cues = draft.caption_cues;
      if (draft.look) T.look = draft.look;
      if (Array.isArray(draft.zooms)) T.zooms = draft.zooms;
      if (draft.transitions) T.trans = draft.transitions;
    });
    lkApply(); $('#tDraftBar').remove(); tlTabs(); toast('Am recuperat modificările. Apasă „Salvează și randează” ca să intre în video.');
  };
  $('#tDraftDrop').onclick = async () => {
    if (!confirm('Renunți definitiv la modificările din ciornă?')) return;
    await fetch(`/api/timeline-draft/${T.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discard: true }) });
    $('#tDraftBar').remove(); toast('Am șters ciorna.');
  };
}

/* ---------------------------------------------------------------- tastatura + salvare */
document.addEventListener('keydown', e => {
  if (!T.on || e.target.closest('input,textarea')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (k === ' ') { e.preventDefault(); if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur(); T.playing ? tlPause() : tlPlay(); }
  else if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); tlHistory(-1); }
  else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); tlHistory(1); }
  else if (mod && T.tab === 'cap' && ['b', 'i', 'u'].includes(k) && TC.sel.size) { e.preventDefault(); tcAction(k); }
  else if (mod && k === 'c') { if (tlCopy()) e.preventDefault(); }
  else if (mod && k === 'v') { if (tlPasteAt(T.t)) e.preventDefault(); }
  else if (mod && k === 'd') { e.preventDefault(); if (tlCopy()) { const it = T.clip.item; tlPasteAt(it.end); } }
  else if (!mod && k === 's') { e.preventDefault(); tlSplit(); }
  else if (!mod && k === 'z') { e.preventDefault(); moAddZoom(); }
  else if ((k === 'delete' || k === 'backspace') && T.tab === 'cap' && TC.sel.size) { e.preventDefault(); tcDeleteWords(); }
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); tlDelete(); }
  else if (e.altKey && (k === 'arrowleft' || k === 'arrowright') && T.sel && T.sel.kind === 'clip') { e.preventDefault(); tlMoveSeg(T.sel.i, T.sel.i + (k === 'arrowleft' ? -1 : 1)); }
  else if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); tlPause(); tlSeek(T.t + (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / T.pr.fps)); }
  else if (k === 'home') { e.preventDefault(); tlSeek(0); }
  else if (k === 'escape') { T.sel = null; tlRender(); tlInspector(); tlPaint(); }
});

async function tlSave() {
  tlPause(); clearTimeout(T.asTimer);
  const btn = $('#tSave'); btn.disabled = true;
  const r = await fetch(`/api/timeline/${T.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments: T.segs, overlays: T.ovs, audio: T.auds, caption_style: T.pr.captions ? T.pr.captions.style : null,
      caption_cues: T.pr.captions ? T.pr.captions.cues : null, look: T.look, zooms: T.zooms, transitions: T.trans }) }).then(r => r.json()).catch(() => ({ error: 'Nu mă pot conecta la aplicație.' }));
  if (r.error) { toast(r.error); btn.disabled = false; return; }
  const id = T.id; T.dirty = false; T.on = false; T.ovEls = new Map(); T.auEls = new Map(); S.rendered = null;
  S.selected = id; S.mediaPick[id] = 'final';
  renderAll(); toast('Randez timeline-ul. Urmărește pașii 1 și 3.');
}
