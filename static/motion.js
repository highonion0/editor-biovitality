/* BioVitality Editor - miscarea: zoom pe video, keyframes pe elemente, tranzitii la taieturi.
   ACELEASI formule ca in remotion/src/Main.tsx, deci previzualizarea arata ca video-ul randat. */

const MO_EASE = x => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const ZOOM_STYLES = [['punch', 'Punch', 'Mărește instant — zoom-ul clasic pe cuvinte-cheie'],
  ['smooth', 'Lin', 'Intră și iese cu o tranziție scurtă'], ['creep', 'Apropiere', 'Mărește încet, pe toată durata']];
const TRANS = [['none', 'Fără'], ['dissolve', 'Dizolvare'], ['fade', 'Prin negru'], ['flash', 'Flash'], ['zoom', 'Zoom'], ['blur', 'Blur']];
const ANIMS = [['none', 'Fără'], ['fade', 'Apariție'], ['slide_up', 'Urcă'], ['slide_down', 'Coboară'],
  ['slide_left', 'Din dreapta'], ['slide_right', 'Din stânga'], ['pop', 'Pop']];

function moKeyAt(keys, field, t, dflt) {
  const ks = (keys || []).filter(k => k[field] != null);
  if (!ks.length) return dflt;
  if (t <= ks[0].t) return ks[0][field];
  const last = ks[ks.length - 1];
  if (t >= last.t) return last[field];
  for (let i = 0; i < ks.length - 1; i++) {
    if (t >= ks[i].t && t <= ks[i + 1].t) {
      const span = ks[i + 1].t - ks[i].t || 1;
      return ks[i][field] + (ks[i + 1][field] - ks[i][field]) * MO_EASE((t - ks[i].t) / span);
    }
  }
  return dflt;
}
function moAnimAt(o, t, dur) {
  const d = Math.min(o.anim_dur ?? 0.35, dur / 2), res = { dx: 0, dy: 0, k: 1, op: 1 };
  const apply = (kind, p, out) => {
    if (!kind || kind === 'none') return;
    const e = MO_EASE(p), m = 1 - e;
    if (kind === 'fade') res.op *= out ? 1 - e : e;
    else if (kind === 'pop') { res.k *= out ? 1 - 0.25 * e : 0.75 + 0.25 * e; res.op *= out ? 1 - e : e; }
    else {
      const dist = 0.18 * m;
      if (kind === 'slide_up') res.dy += dist; else if (kind === 'slide_down') res.dy -= dist;
      else if (kind === 'slide_left') res.dx += dist; else if (kind === 'slide_right') res.dx -= dist;
      res.op *= out ? 1 - e : e;
    }
  };
  if (d > 0 && o.anim_in && t < d) apply(o.anim_in, t / d, false);
  if (d > 0 && o.anim_out && t > dur - d) apply(o.anim_out, (t - (dur - d)) / d, true);
  return res;
}
function moZoomAt(t) {
  for (const z of T.zooms || []) {
    if (t < z.start || t >= z.end) continue;
    const dur = z.end - z.start, p = (t - z.start) / dur;
    let k;
    if (z.style === 'punch') k = 1;
    else if (z.style === 'creep') k = p;
    else { const r = Math.min(0.25, dur / 3); k = Math.min(MO_EASE(Math.min(1, (t - z.start) / r)), MO_EASE(Math.min(1, (z.end - t) / r))); }
    const s = 1 + (z.scale - 1) * k;
    return { s, ox: (0.5 - z.x) * (s - 1) * 100, oy: (0.5 - z.y) * (s - 1) * 100, z };
  }
  return null;
}
// valorile efective ale unui element la momentul curent (pentru previzualizare si pentru mânere)
function moAt(o, t) {
  const dur = Math.max(0.01, o.end - o.start), lt = clamp(t - o.start, 0, dur), a = moAnimAt(o, lt, dur);
  return { x: moKeyAt(o.keys, 'x', lt, o.x) + a.dx, y: moKeyAt(o.keys, 'y', lt, o.y) + a.dy,
    w: moKeyAt(o.keys, 'w', lt, o.w) * a.k, rotation: moKeyAt(o.keys, 'rotation', lt, o.rotation || 0),
    opacity: moKeyAt(o.keys, 'opacity', lt, o.opacity ?? 1) * a.op, lt, anim: a.k !== 1 || a.dx || a.dy || a.op !== 1 };
}
// tranzitiile, aplicate pe previzualizare
function moTransAt(t) {
  const starts = tlStarts(), out = { style: {}, flash: 0 };
  Object.entries(T.trans || {}).forEach(([k, tr]) => {
    const i = +k; if (!tr || tr.kind === 'none' || i + 1 >= T.segs.length) return;
    const at = starts[i + 1], d = tr.dur || 0.4;
    if (t < at - d || t > at + d) return;
    const half = t < at ? (at - t) / d : (t - at) / d, e = 1 - MO_EASE(Math.min(1, half));
    if (tr.kind === 'fade') out.style.opacity = 1 - e;
    else if (tr.kind === 'dissolve') out.style.opacity = 1 - 0.75 * e;
    else if (tr.kind === 'blur') out.style.blur = 12 * e;
    else if (tr.kind === 'zoom') out.style.scale = 1 + 0.12 * e;
    else if (tr.kind === 'flash') out.flash = Math.max(out.flash, e);
  });
  return out;
}

/* ---- zoom: adaugare si panou ---- */
function moAddZoom(at) {
  const total = tlTotal(), a = clamp(at ?? T.t, 0, Math.max(0, total - 0.3)), b = Math.min(total, a + 1.5);
  const z = { id: 'z' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), start: +a.toFixed(3), end: +b.toFixed(3),
    scale: 1.2, x: 0.5, y: 0.42, style: 'smooth' };
  tlChange(() => { T.zooms.push(z); T.zooms.sort((p, q) => p.start - q.start); T.sel = { kind: 'zoom', i: T.zooms.indexOf(z) }; });
  T.tab = 'props'; tlTabs(); tlSeek(a + Math.min(0.4, (b - a) / 2));
  return z;
}
function moZoomPanel(z, i) {
  const pct = v => Math.round(v * 100) + '%';
  return `<h4>🔍 Zoom pe video</h4>
    <div class="sub2">De la ${fmtTC(z.start)} la ${fmtTC(z.end)} (${fmtS(z.end - z.start)}). Click pe previzualizare ca să alegi punctul pe care se centrează.
      ${S.engine && !S.engine.ok ? '<br><b style="color:var(--honey)">Zoom-ul apare în video doar cu motorul Remotion.</b>' : ''}</div>
    <div class="segs" id="zStyle">${ZOOM_STYLES.map(([v, l]) => `<button data-v="${v}" class="${z.style === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="hint">${esc((ZOOM_STYLES.find(s => s[0] === z.style) || [])[2] || '')}</div>
    <div class="kv" style="margin-top:12px">
      <label>Începe la</label><input class="tnum" data-n="start" value="${z.start.toFixed(2)}"><span></span>
      <label>Se termină la</label><input class="tnum" data-n="end" value="${z.end.toFixed(2)}"><span></span>
      <label>Cât de mult</label><input type="range" data-z="scale" min="1.05" max="1.6" step="0.01" value="${z.scale}"><output data-o="scale">${z.scale.toFixed(2)}×</output>
      <label>Centru orizontal</label><input type="range" data-z="x" min="0" max="1" step="0.005" value="${z.x}"><output data-o="x">${pct(z.x)}</output>
      <label>Centru vertical</label><input type="range" data-z="y" min="0" max="1" step="0.005" value="${z.y}"><output data-o="y">${pct(z.y)}</output>
    </div>
    <div class="row"><button class="tbtn" id="zDup">⧉ Duplică</button><button class="tbtn" id="zDel">🗑 Șterge zoom-ul</button></div>`;
}
function moBindZoom(p, z, i) {
  const pct = v => Math.round(v * 100) + '%';
  $('#zStyle').onclick = e => { const b = e.target.closest('[data-v]'); if (b) { tlChange(() => { z.style = b.dataset.v; }); tlInspector(); } };
  let prev = null;
  p.querySelectorAll('input[type=range][data-z]').forEach(inp => {
    inp.onpointerdown = () => { prev = tlSnap(); };
    inp.oninput = () => { z[inp.dataset.z] = +inp.value; p.querySelector(`[data-o="${inp.dataset.z}"]`).textContent = inp.dataset.z === 'scale' ? (+inp.value).toFixed(2) + '×' : pct(+inp.value); tlPaint(); };
    inp.onchange = () => { tlCommit(prev || tlSnap()); prev = null; };
  });
  p.querySelectorAll('input[data-n]').forEach(inp => inp.onchange = () => tlChange(() => {
    const n = parseFloat(inp.value.replace(',', '.')); if (isNaN(n)) return;
    if (inp.dataset.n === 'start') z.start = +clamp(n, 0, z.end - 0.2).toFixed(3); else z.end = +clamp(n, z.start + 0.2, tlTotal()).toFixed(3);
  }));
  $('#zDup').onclick = () => { const n = { ...deep(z), id: 'z' + Date.now().toString(36), start: z.end, end: Math.min(tlTotal(), z.end + (z.end - z.start)) };
    if (n.end - n.start > 0.2) tlChange(() => { T.zooms.push(n); T.zooms.sort((a, b) => a.start - b.start); }); };
  $('#zDel').onclick = () => { tlChange(() => { T.zooms.splice(i, 1); T.sel = null; }); };
}

/* ---- keyframes pe elemente ---- */
const MO_FIELDS = ['x', 'y', 'w', 'opacity', 'rotation'];
function moKeyHere(o) {
  const lt = +clamp(T.t - o.start, 0, o.end - o.start).toFixed(3);
  return (o.keys || []).find(k => Math.abs(k.t - lt) < 0.04);
}
function moAddKey(o) {
  const dur = o.end - o.start, lt = +clamp(T.t - o.start, 0, dur).toFixed(3);
  const now = moAt(o, T.t);
  tlChange(() => {
    o.keys = o.keys || [];
    if (!o.keys.length && lt > 0.02) o.keys.push({ t: 0, x: o.x, y: o.y, w: o.w, opacity: o.opacity ?? 1, rotation: o.rotation || 0 });
    const k = moKeyHere(o) || (o.keys.push({ t: lt }), o.keys[o.keys.length - 1]);
    MO_FIELDS.forEach(f => { k[f] = +(+now[f]).toFixed(4); });
    o.keys.sort((a, b) => a.t - b.t);
  });
  toast(`◆ Keyframe la ${fmtTC(T.t)}. Mută sau redimensionează elementul în alt punct și pune încă unul.`);
}
function moDelKey(o) {
  const k = moKeyHere(o); if (!k) return;
  tlChange(() => { o.keys = (o.keys || []).filter(x => x !== k); if (!o.keys.length) delete o.keys; });
  toast('Am șters keyframe-ul.');
}
function moKeyRow(o) {
  const has = !!moKeyHere(o), n = (o.keys || []).length;
  return `<div class="morow"><b>◆ Mișcare</b>
    <button class="btn sm ${has ? 'primary' : ''}" id="moKey">${has ? '◆ Actualizează aici' : '◆ Keyframe la cursor'}</button>
    ${has ? '<button class="btn sm" id="moKeyDel">Șterge keyframe-ul</button>' : ''}
    ${n ? `<button class="btn sm" id="moKeyClr">Fără mișcare (${n})</button>` : ''}
    <span class="hint" style="margin:0">${n ? 'Pune keyframes în momente diferite; între ele trece lin.' : 'Pune unul aici, mută cursorul, mută elementul: restul vine singur.'}</span></div>
  <div class="kv">
    <label>Intrare</label><div class="segs sm" id="moIn">${ANIMS.map(([v, l]) => `<button data-v="${v}" class="${(o.anim_in || 'none') === v ? 'on' : ''}">${l}</button>`).join('')}</div><span></span>
    <label>Ieșire</label><div class="segs sm" id="moOut">${ANIMS.map(([v, l]) => `<button data-v="${v}" class="${(o.anim_out || 'none') === v ? 'on' : ''}">${l}</button>`).join('')}</div><span></span>
    ${(o.anim_in && o.anim_in !== 'none') || (o.anim_out && o.anim_out !== 'none') ? `<label>Durata animației</label>
      <input type="range" data-mo="anim_dur" min="0.1" max="1.2" step="0.05" value="${o.anim_dur ?? 0.35}"><output data-o="anim_dur">${fmtS(o.anim_dur ?? 0.35)}</output>` : ''}
  </div>`;
}
function moBindKeys(p, o) {
  const k = $('#moKey'); if (k) k.onclick = () => { moAddKey(o); tlInspector(); };
  const kd = $('#moKeyDel'); if (kd) kd.onclick = () => { moDelKey(o); tlInspector(); };
  const kc = $('#moKeyClr'); if (kc) kc.onclick = () => { tlChange(() => { delete o.keys; }); tlInspector(); toast('Am scos mișcarea.'); };
  ['In', 'Out'].forEach(side => {
    const el = $('#mo' + side); if (!el) return;
    el.onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return;
      tlChange(() => { o['anim_' + side.toLowerCase()] = b.dataset.v === 'none' ? undefined : b.dataset.v; }); tlInspector(); };
  });
  let prev = null;
  p.querySelectorAll('input[data-mo]').forEach(inp => {
    inp.onpointerdown = () => { prev = tlSnap(); };
    inp.oninput = () => { o[inp.dataset.mo] = +inp.value; p.querySelector('[data-o="anim_dur"]').textContent = fmtS(+inp.value); tlPaint(); };
    inp.onchange = () => { tlCommit(prev || tlSnap()); prev = null; };
  });
}

/* ---- tranzitii la taieturi ---- */
function moTransPanel(ci) {
  const tr = (T.trans || {})[ci] || { kind: 'none', dur: 0.4 };
  return `<div class="morow" style="margin-top:12px"><b>⇄ Tranziție aici</b>
    ${S.engine && !S.engine.ok ? '<span class="hint" style="margin:0;color:var(--honey)">doar cu motorul Remotion</span>' : ''}</div>
    <div class="segs" id="trKind">${TRANS.map(([v, l]) => `<button data-v="${v}" class="${tr.kind === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${tr.kind !== 'none' ? `<div class="kv" style="margin-top:10px"><label>Durata</label>
      <input type="range" data-tr="dur" min="0.1" max="1.2" step="0.05" value="${tr.dur}"><output data-o="trdur">${fmtS(tr.dur)}</output></div>
      <div class="hint">Tranziția nu schimbă durata video-ului — subtitrările rămân pe aceleași cuvinte.</div>` : ''}`;
}
function moBindTrans(p, ci) {
  const el = $('#trKind'); if (!el) return;
  el.onclick = e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    tlChange(() => {
      T.trans = T.trans || {};
      if (b.dataset.v === 'none') delete T.trans[ci];
      else T.trans[ci] = { kind: b.dataset.v, dur: (T.trans[ci] || {}).dur || 0.4 };
    });
    tlInspector(); tlRender();
  };
  let prev = null;
  p.querySelectorAll('input[data-tr]').forEach(inp => {
    inp.onpointerdown = () => { prev = tlSnap(); };
    inp.oninput = () => { T.trans[ci].dur = +inp.value; p.querySelector('[data-o="trdur"]').textContent = fmtS(+inp.value); tlPaint(); };
    inp.onchange = () => { tlCommit(prev || tlSnap()); prev = null; tlRender(); };
  });
}
