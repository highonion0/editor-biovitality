/* BioVitality Editor - look-ul video-ului: culoare + sunet (tabul „🎨 Look”).
   Culoarea se vede instant pe previzualizare (aceeasi formula ca la randare); sunetul il asculti dupa „Aplica si asculta”. */

const LK_PRESETS = [['original', 'Original'], ['natural', 'Natural'], ['cald', 'Cald'], ['luminos', 'Luminos'], ['cinematic', 'Cinematic'], ['albnegru', 'Alb-negru']];
const LK = { presets: {}, def: null, applied: null };

// ACEEASI formula ca in core.py (color_matrix): temperatura/nuanta -> saturatie -> contrast -> luminozitate
function lkMatrix(c) {
  const t = c.temperature, g = c.tint;
  const gains = [1 + 0.10 * t + 0.03 * g, 1 + 0.02 * t - 0.07 * g, 1 - 0.12 * t + 0.03 * g];
  const s = c.saturation, lr = 0.2126, lg = 0.7152, lb = 0.0722;
  const sat = [[lr + (1 - lr) * s, lg - lg * s, lb - lb * s], [lr - lr * s, lg + (1 - lg) * s, lb - lb * s], [lr - lr * s, lg - lg * s, lb + (1 - lb) * s]];
  const k = c.contrast, off = 0.5 * (1 - c.contrast) + c.brightness;
  const rows = [0, 1, 2].map(r => [0, 1, 2].map(j => k * sat[r][j] * gains[j]).concat([0, off]));
  return rows.concat([[0, 0, 0, 1, 0]]);
}
const lkNeutral = c => Math.abs(c.brightness) < 1e-3 && Math.abs(c.contrast - 1) < 1e-3 && Math.abs(c.saturation - 1) < 1e-3 && Math.abs(c.temperature) < 1e-3 && Math.abs(c.tint) < 1e-3;

function lkApply(off) {
  if (!T.look) return;
  const c = T.look.color, none = off || lkNeutral(c);
  const m = $('#tGradeM'); if (m && !none) m.setAttribute('values', lkMatrix(c).flat().map(v => +v.toFixed(5)).join(' '));
  LK.off = !!off;                       // „Ține apăsat: înainte”
  if (typeof moPaintVideo === 'function') moPaintVideo();
}
function lkAudioKey() { return JSON.stringify(T.look ? T.look.audio : {}); }

function renderLook() {
  const body = $('#tInspBody'); if (!body || T.tab !== 'look') return;
  const c = T.look.color, a = T.look.audio;
  const sl = (k, label, min, max, step, left, right) => `<div class="lkrow"><label>${label}</label>
    <input type="range" data-c="${k}" min="${min}" max="${max}" step="${step}" value="${c[k]}"><span class="lkends"><em>${left}</em><em>${right}</em></span></div>`;
  const pending = lkAudioKey() !== LK.applied;
  body.innerHTML = `<div class="lkbox">
    <h4>🎨 Culoare <small>doar pe video-ul tău, nu pe grafică sau B-roll</small></h4>
    <div class="lkpre">${LK_PRESETS.map(([id, l]) => `<button class="${c.preset === id ? 'on' : ''}" data-p="${id}">${l}</button>`).join('')}
      ${c.preset === 'custom' ? '<button class="on" disabled>Personalizat</button>' : ''}</div>
    ${sl('brightness', 'Luminozitate', -0.4, 0.4, 0.01, 'mai închis', 'mai luminos')}
    ${sl('contrast', 'Contrast', 0.5, 1.6, 0.01, 'moale', 'puternic')}
    ${sl('saturation', 'Saturație', 0, 2, 0.01, 'gri', 'vii')}
    ${sl('temperature', 'Temperatură', -1, 1, 0.01, 'rece', 'cald')}
    ${sl('tint', 'Nuanță', -1, 1, 0.01, 'verde', 'magenta')}
    <div class="row" style="margin-top:4px"><button class="tbtn" id="lkCmp" title="Ține apăsat ca să vezi originalul">◐ Ține apăsat: înainte</button></div>
    <h4 style="margin-top:18px">🔊 Sunet <small>se aplică pe vocea ta din video</small></h4>
    <div class="lkrow"><label>Reducere zgomot</label><div class="segs" id="lkNr">${[['off', 'Oprit'], ['usor', 'Ușor'], ['mediu', 'Mediu'], ['puternic', 'Puternic']]
      .map(([v, l]) => `<button data-v="${v}" class="${a.denoise === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <label class="tog"><span><b style="font-size:13.5px">Voce clară</b><br><small style="color:var(--muted)">Scoate bâzâitul și „nămolul”, adaugă prezență, uniformizează volumul</small></span>
      <input type="checkbox" id="lkClear" ${a.clear ? 'checked' : ''}><span class="sw"></span></label>
    <label class="tog" style="margin-top:8px"><span><b style="font-size:13.5px">Volum uniform (−14 LUFS)</b><br><small style="color:var(--muted)">Nivelul standard TikTok / Instagram: toate video-urile sună la fel de tare</small></span>
      <input type="checkbox" id="lkLoud" ${a.loudness ? 'checked' : ''}><span class="sw"></span></label>
    <div class="row"><button class="${pending ? 'cta' : 'tbtn'}" id="lkListen">🎧 ${pending ? 'Aplică și ascultă' : 'Sunetul din previzualizare e la zi'}</button>
      <span class="hint" style="margin:0" id="lkSt">${pending ? 'Ai schimbat sunetul — apasă ca să-l auzi.' : ''}</span></div>
    <div class="lkfoot"><button class="btn sm" id="lkSaveDef">★ Păstrează look-ul pentru video-urile noi</button>
      <button class="btn sm" id="lkUseDef">Aplică look-ul implicit aici</button></div></div>`;
  let prev = null;
  body.querySelectorAll('input[data-c]').forEach(i => {
    i.onpointerdown = () => { prev = tlSnap(); };
    i.oninput = () => { c[i.dataset.c] = +i.value; c.preset = 'custom'; lkApply(); };
    i.onchange = () => { tlCommit(prev || tlSnap()); prev = null; renderLook(); };
  });
  body.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
    const p = LK.presets[b.dataset.p]; if (!p) return;
    tlChange(() => { Object.assign(c, p, { preset: b.dataset.p }); }); lkApply(); renderLook();
  });
  const cmp = $('#lkCmp');
  cmp.onpointerdown = () => lkApply(true);
  ['pointerup', 'pointerleave'].forEach(ev => cmp.addEventListener(ev, () => lkApply()));
  $('#lkNr').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; tlChange(() => { a.denoise = b.dataset.v; }); renderLook(); };
  $('#lkClear').onchange = e => { tlChange(() => { a.clear = e.target.checked; }); renderLook(); };
  $('#lkLoud').onchange = e => { tlChange(() => { a.loudness = e.target.checked; }); renderLook(); };
  $('#lkListen').onclick = lkListen;
  $('#lkSaveDef').onclick = async () => {
    const r = await fetch('/api/look-default', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(T.look) })
      .then(r => r.json()).catch(() => ({ error: 'Nu mă pot conecta la aplicație.' }));
    if (r.error) { toast(r.error); return; }
    LK.def = r.look; toast('Gata. Video-urile noi vor primi acest look (culoare + sunet).');
  };
  $('#lkUseDef').onclick = () => {
    if (!LK.def) return;
    tlChange(() => { T.look = JSON.parse(JSON.stringify(LK.def)); }); lkApply(); renderLook();
    toast('Am aplicat look-ul implicit. Pentru sunet apasă „Aplică și ascultă”.');
  };
}

async function lkListen() {
  const b = $('#lkListen'); if (!b) return;
  b.disabled = true; b.textContent = '🎧 Procesez sunetul…'; $('#lkSt').textContent = 'câteva secunde';
  const key = lkAudioKey();
  const r = await fetch(`/api/look-audio/${T.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: T.look.audio }) }).then(r => r.json()).catch(() => ({ error: 'Nu mă pot conecta la aplicație.' }));
  if (r.error) { toast(r.error); renderLook(); return; }
  // reincarc playerele cu sunetul nou, la acelasi moment
  const t = T.t, was = T.playing; tlPause();
  T.vids.forEach(v => { v.src = r.url; });
  T.vids[0].addEventListener('loadedmetadata', () => { tlSeek(t); lkApply(); if (was) tlPlay(); }, { once: true });
  LK.applied = key; renderLook(); toast('Ascultă acum: previzualizarea are sunetul nou.');
}
