/* BioVitality Editor - zonele sigure TikTok / Reels / Shorts (unde acopera interfata aplicatiei) + verificare.
   Valori conservatoare pentru un cadru 1080x1920; platformele isi mai schimba interfata, deci verifica si la publicare. */

const SZ = {
  tiktok: { label: 'TikTok', rects: [
    { n: 'bara de sus', r: [0, 0, 1, 0.073] },
    { n: 'descrierea și sunetul', r: [0, 0.79, 1, 1] },
    { n: 'butoanele din dreapta', r: [0.833, 0.36, 1, 0.79] }] },
  reels: { label: 'Reels', rects: [
    { n: 'bara de sus', r: [0, 0, 1, 0.115] },
    { n: 'descrierea și butoanele', r: [0, 0.74, 1, 1] },
    { n: 'butoanele din dreapta', r: [0.86, 0.45, 1, 0.74] }] },
  shorts: { label: 'Shorts', rects: [
    { n: 'bara de sus', r: [0, 0, 1, 0.08] },
    { n: 'titlul și abonarea', r: [0, 0.8, 1, 1] },
    { n: 'butoanele din dreapta', r: [0.85, 0.4, 1, 0.8] }] },
};
const SZ_OPTS = [['off', 'Oprit'], ['tiktok', 'TikTok'], ['reels', 'Reels'], ['shorts', 'Shorts'], ['all', 'Toate']];
const szMode = () => S.settings.safezone || 'off';
function szRects(mode) {
  if (mode === 'off') return [];
  if (mode === 'all') {   // o singura zona comuna, cea mai stricta din toate trei
    const all = Object.values(SZ).flatMap(p => p.rects);
    const top = Math.max(...all.filter(x => x.r[1] === 0).map(x => x.r[3]));
    const bot = Math.min(...all.filter(x => x.r[3] === 1).map(x => x.r[1]));
    const rails = all.filter(x => x.r[0] > 0.5);
    return [{ n: 'bara de sus', r: [0, 0, 1, top], p: 'Toate' }, { n: 'descrierea și butoanele de jos', r: [0, bot, 1, 1], p: 'Toate' },
      { n: 'butoanele din dreapta', r: [Math.min(...rails.map(x => x.r[0])), Math.min(...rails.map(x => x.r[1])), 1, bot], p: 'Toate' }];
  }
  return SZ[mode].rects.map(x => ({ ...x, p: SZ[mode].label }));
}
// banda verticala sigura (intre bara de sus si zona de jos) pentru modul ales
function szBand(mode) {
  const rs = szRects(mode === 'off' ? 'all' : mode);
  const top = Math.max(0, ...rs.filter(x => x.r[1] === 0 && x.r[2] === 1).map(x => x.r[3]));
  const bot = Math.min(1, ...rs.filter(x => x.r[3] === 1 && x.r[0] === 0).map(x => x.r[1]));
  return [top, bot];
}

function szDraw() {
  const st = $('#tStage'); if (!st) return;
  let layer = $('#tSafe');
  if (!layer) { layer = document.createElement('div'); layer.id = 'tSafe'; st.appendChild(layer); }
  const rs = szRects(szMode());
  layer.innerHTML = rs.map(x => `<div class="szr" style="left:${x.r[0] * 100}%;top:${x.r[1] * 100}%;width:${(x.r[2] - x.r[0]) * 100}%;height:${(x.r[3] - x.r[1]) * 100}%">
    <span>${x.p === 'Toate' ? '' : esc(x.p) + ' · '}${esc(x.n)}</span></div>`).join('');
  document.querySelectorAll('#tSz button').forEach(b => b.classList.toggle('on', b.dataset.z === szMode()));
  szBadge();
}
function szControl() {
  const host = $('#tSzHost'); if (!host) return;
  host.innerHTML = `<div class="szctl"><span>Zone sigure</span><div class="segs" id="tSz">${SZ_OPTS.map(([v, l]) => `<button data-z="${v}">${l}</button>`).join('')}</div><span id="tSzBadge"></span></div>`;
  $('#tSz').onclick = e => { const b = e.target.closest('[data-z]'); if (!b) return; S.settings.safezone = b.dataset.z; saveSettings(); szDraw(); tlInspector(); };
  szDraw();
}

/* ---- verificare */
const szHit = (a, b) => { const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); return w > 0 && h > 0 ? w * h : 0; };
function szCaptionRect() {
  const cs = T.pr.captions && T.pr.captions.style; if (!cs || !(T.pr.captions.cues || []).length) return null;
  const box = $('#tCap'), st = $('#tStage');
  if (box && st && box.style.display !== 'none' && box.textContent.trim()) {        // subtitrarea de pe ecran, masurata exact
    const a = st.getBoundingClientRect(), b = box.getBoundingClientRect();
    return { r: [(b.left - a.left) / a.width, (b.top - a.top) / a.height, (b.right - a.left) / a.width, (b.bottom - a.top) / a.height], exact: true };
  }
  const h = 2 * cs.size / 100;                                                       // estimare: 2 randuri
  return { r: [0.3, cs.pos_y - h / 2, 0.7, cs.pos_y + h / 2], exact: false };
}
function szIssues() {
  const mode = szMode(); if (mode === 'off') return [];
  const rs = szRects(mode), out = [];
  const cap = szCaptionRect();
  if (cap) rs.forEach(z => { const a = szHit(cap.r, z.r), area = (cap.r[2] - cap.r[0]) * (cap.r[3] - cap.r[1]);
    if (area && a / area > 0.02 && (cap.exact || z.r[0] === 0)) out.push({ kind: 'cap', what: 'Subtitrările', z }); });
  T.ovs.forEach((o, i) => {
    if (o.type === 'slot' || o.fit === 'cover' || o.end <= o.start) return;
    const h = o.w * (o.ar || 1) * (T.pr.width / T.pr.height);
    const r = [o.x - o.w / 2, o.y - h / 2, o.x + o.w / 2, o.y + h / 2], area = o.w * h;
    const name = o.type === 'graphic' ? `${tplLabel(o.template)} „${tplText(o).slice(0, 28)}”` : o.type === 'image' ? `Poza „${o.asset}”` : `Video-ul „${o.asset}”`;
    rs.forEach(z => { const a = szHit(r, z.r); if (area && a / area > 0.02) out.push({ kind: 'ov', i, what: `${name} (${fmtTC(o.start)})`, z }); });
  });
  const seen = new Set();   // un rand pe element si zona
  return out.filter(x => { const k = x.kind + (x.i ?? '') + x.z.n + x.z.p; if (seen.has(k)) return false; seen.add(k); return true; });
}
function szBadge() {
  const b = $('#tSzBadge'); if (!b) return;
  const n = new Set(szIssues().map(x => x.kind + (x.i ?? ''))).size;
  b.className = n ? 'szwarn' : 'szok'; b.textContent = szMode() === 'off' ? '' : n ? `⚠ ${n}` : '✓';
  b.title = n ? 'Unele elemente intră sub interfața platformei — vezi panoul Proprietăți' : 'Totul e în zona sigură';
}
function szFix(kind, i) {
  const [top, bot] = szBand(szMode());
  tlChange(() => {
    if (kind === 'cap') {
      const cs = T.pr.captions.style, cap = szCaptionRect(), h = cap ? cap.r[3] - cap.r[1] : 2 * cs.size / 100;
      cs.pos_y = +clamp(cs.pos_y, top + h / 2 + 0.015, bot - h / 2 - 0.015).toFixed(4);
    } else {
      const o = T.ovs[i]; if (!o) return;
      const h = o.w * (o.ar || 1) * (T.pr.width / T.pr.height);
      o.y = +clamp(o.y, top + h / 2 + 0.015, bot - h / 2 - 0.015).toFixed(4);
      const rail = szRects(szMode()).filter(z => z.r[2] === 1 && z.r[0] > 0.5).reduce((m, z) => Math.min(m, z.r[0]), 1);
      if (o.x + o.w / 2 > rail && o.w < rail - 0.1) o.x = +(rail - o.w / 2 - 0.015).toFixed(4);
    }
  });
  toast('Am mutat elementul în zona sigură.');
}
function szPanelHTML() {
  const mode = szMode();
  if (mode === 'off') return `<div class="szpanel"><b>Zone sigure</b><span class="hint" style="margin:0">Alege TikTok / Reels / Shorts sub video ca să vezi ce acoperă interfața.</span></div>`;
  const iss = szIssues();
  const label = mode === 'all' ? 'TikTok + Reels + Shorts' : SZ[mode].label;
  if (!iss.length) return `<div class="szpanel ok"><b>✓ Zone sigure (${esc(label)})</b><span class="hint" style="margin:0">Subtitrările și grafica de pe timeline nu intră sub interfață.</span></div>`;
  return `<div class="szpanel"><b>⚠ Zone sigure (${esc(label)})</b>${iss.map(x => `<div class="szrow"><span>${esc(x.what)} intră sub <em>${esc(x.z.n)}</em>${x.z.p === 'Toate' ? '' : ` (${esc(x.z.p)})`}</span>
    ${x.z.n.includes('dreapta') && x.kind === 'cap' ? '<small>micșorează textul sau scurtează fraza</small>' : `<button class="btn sm" data-szfix="${x.kind}" data-i="${x.i ?? ''}">Mută în zona sigură</button>`}</div>`).join('')}</div>`;
}
function szBindPanel(root) {
  root.querySelectorAll('[data-szfix]').forEach(b => b.onclick = () => szFix(b.dataset.szfix, b.dataset.i === '' ? null : +b.dataset.i));
}
