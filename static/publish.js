/* BioVitality Editor - tabul „📣 Publicare” din Timeline.
   1) Pachetul de publicare: Claude scrie descrierea, hashtag-urile, textul de pe copertă și primul comentariu pentru fiecare
      platformă; coperta se face dintr-un cadru al video-ului, cu textul în stilul brandului (punctul 4).
   2) Variante de cârlig (A/B): același video cu alt început (o frază pusă în față și/sau alt titlu mare),
      randate ca fișiere separate: varianta_A.mp4, varianta_B.mp4... (punctul 6). */

S.pub = {};
const PUB_PLATFORMS = [['tiktok', 'TikTok'], ['instagram', 'Instagram'], ['youtube', 'YouTube Shorts'], ['facebook', 'Facebook']];
const pubState = () => S.pub[T.id] || (S.pub[T.id] = { loaded: false, pack: null, hooks: [], cover: null, packBusy: false, hookBusy: false,
  packErr: '', hookErr: '', note: '', platforms: pubPlatformsSaved() });
function pubPlatformsSaved() {
  try { const v = JSON.parse(localStorage.getItem('bv_pub_platforms') || 'null'); if (Array.isArray(v) && v.length) return v; } catch (e) { /* fara memorie locala */ }
  return PUB_PLATFORMS.map(p => p[0]);
}
const pubPost = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(r => r.json()).catch(() => ({ error: 'Nu mă pot conecta la aplicație.' }));
const pubCopy = (txt, what) => navigator.clipboard.writeText(txt).then(() => toast(`${what} — copiat.`), () => toast('Nu am putut copia. Selectează textul și apasă Ctrl+C.'));
const pubTags = p => (p.hashtags || []).map(t => '#' + t).join(' ');
const pubJob = () => S.jobs.get(T.id) || {};
const pubBusyJob = () => ['running', 'queued'].includes(pubJob().status);

async function renderPublish() {
  const body = $('#tInspBody'); if (!body || T.tab !== 'pub') return;
  const st = pubState(), id = T.id;
  if (!st.loaded) {
    body.innerHTML = '<div class="pbox"><div class="msg wait"><span class="spin"></span>Încarc…</div></div>';
    const r = await fetch(`/api/publish/${id}`).then(r => r.json()).catch(() => ({}));
    if (!r.error) Object.assign(st, { pack: r.pack, hooks: r.hooks || [], cover: r.cover });
    st.loaded = true;
    if (!T.on || T.id !== id || T.tab !== 'pub') return;
  }
  const keep = body.scrollTop;
  body.innerHTML = `<div class="pubwrap">${pubPackHTML(st)}${pubHooksHTML(st)}</div>`;
  body.scrollTop = keep;
  pubBindPack(body, st); pubBindHooks(body, st);
}
// cand se termina randarea variantelor, apar linkurile
function pubOnJob() { if (T.on && T.tab === 'pub' && !document.activeElement?.closest?.('.pubwrap input, .pubwrap textarea')) renderPublish(); }

/* ---------------------------------------------------------------- 1) pachetul de publicare */
function pubPackHTML(st) {
  const ai = S.assistant || {}, p = st.pack, id = T.id;
  let h = `<section class="pubsec"><h4>📣 Pachet de publicare</h4>
    <p class="sub2">Claude scrie, pentru fiecare platformă, descrierea, hashtag-urile, textul de pe copertă și primul comentariu — doar din ce spui în video.
      Tu le verifici, le poți modifica și le copiezi cu un click.</p>`;
  if (!ai.has_key) return h + `<button class="cta" id="pubToAi">Setează cheia API în tabul Asistent</button></section>`;
  h += `<div class="pubplat">${PUB_PLATFORMS.map(([k, n]) => `<label><input type="checkbox" data-plat="${k}" ${st.platforms.includes(k) ? 'checked' : ''}> ${n}</label>`).join('')}</div>
    <textarea class="pubnote" id="pubNote" rows="2" placeholder="Indicații (opțional): ex. „menționează că urmează partea a 2-a”, „îndemn la salvare”">${esc(st.note || (p && p.note) || '')}</textarea>
    ${st.packErr ? `<div class="msg err" style="max-width:none">${esc(st.packErr)}</div>` : ''}
    <div class="row"><button class="cta" id="pubGen" ${st.packBusy ? 'disabled' : ''}>${st.packBusy ? '<span class="spin"></span> Claude scrie… (20–60 s)' : p ? '✦ Scrie din nou' : '✦ Scrie pachetul'}</button>
      ${p ? `<a class="btn sm" href="/download/${id}/pack" title="Toate textele într-un fișier">⬇ publicare.txt</a>` : ''}</div>`;
  if (!p) return h + '</section>';
  // coperta
  h += `<div class="pubcover"><div class="pubcf">
      <b>🖼 Coperta</b>
      <label>Titlu mare</label><input type="text" id="pubCT" value="${esc(p.cover.title)}" maxlength="80">
      <label>Subtitlu (opțional)</label><input type="text" id="pubCS" value="${esc(p.cover.subtitle)}" maxlength="100">
      <span class="sub2">Mută cursorul pe timeline la cadrul care-ți place, apoi:</span>
      <div class="row"><button class="btn sm" id="pubCover">🖼 Fă coperta din cadrul de la ${fmtTC(T.t)}</button>
        ${st.cover ? `<a class="btn sm" href="/download/${id}/cover">⬇ Descarcă</a>` : ''}</div></div>
      ${st.cover ? `<img class="pubimg" src="${st.cover}" alt="Coperta">` : '<div class="pubimg empty">Coperta apare aici</div>'}</div>`;
  // platformele
  p.platforms.forEach((x, i) => {
    const fld = (k, label, rows, val) => `<div class="pubf"><div class="pubfh"><label>${label}</label><button class="btn sm" data-cp="${i}:${k}">📋</button></div>
      ${rows ? `<textarea data-ed="${i}:${k}" rows="${rows}">${esc(val)}</textarea>` : `<input type="text" data-ed="${i}:${k}" value="${esc(val)}">`}</div>`;
    h += `<div class="pubcard"><div class="pubch"><b>${esc(x.name)}</b><button class="btn sm" data-cpall="${i}" title="Descrierea + hashtag-urile">📋 Copiază descrierea cu hashtag-uri</button></div>
      ${x.platform === 'youtube' ? fld('title', 'Titlu', 0, x.title) : ''}
      ${fld('description', 'Descriere', Math.min(8, 2 + Math.ceil(x.description.length / 70)), x.description)}
      ${fld('hashtags', 'Hashtag-uri', 0, pubTags(x))}
      ${fld('cover_text', 'Text pe copertă', 0, x.cover_text)}
      ${fld('first_comment', 'Primul comentariu', 2, x.first_comment)}</div>`;
  });
  return h + '</section>';
}
function pubBindPack(body, st) {
  const toAi = $('#pubToAi', body); if (toAi) { toAi.onclick = () => { T.tab = 'ai'; tlTabs(); }; return; }
  body.querySelectorAll('[data-plat]').forEach(cb => cb.onchange = () => {
    st.platforms = [...body.querySelectorAll('[data-plat]:checked')].map(x => x.dataset.plat);
    try { localStorage.setItem('bv_pub_platforms', JSON.stringify(st.platforms)); } catch (e) { /* fara memorie locala */ }
  });
  const note = $('#pubNote', body); if (note) note.oninput = () => { st.note = note.value; };
  $('#pubGen', body).onclick = () => pubGenerate(st);
  const p = st.pack; if (!p) return;
  const save = () => { clearTimeout(st.saveT); st.saveT = setTimeout(() => pubPost(`/api/publish-save/${T.id}`, { pack: st.pack }), 600); };
  $('#pubCT', body).oninput = e => { p.cover.title = e.target.value; save(); };
  $('#pubCS', body).oninput = e => { p.cover.subtitle = e.target.value; save(); };
  $('#pubCover', body).onclick = () => pubCover(st);
  body.querySelectorAll('[data-ed]').forEach(el => el.oninput = () => {
    const [i, k] = el.dataset.ed.split(':'), x = p.platforms[+i];
    x[k] = k === 'hashtags' ? el.value.split(/[\s,]+/).map(t => t.replace(/^#+/, '')).filter(Boolean) : el.value;
    save();
  });
  body.querySelectorAll('[data-cp]').forEach(b => b.onclick = () => {
    const [i, k] = b.dataset.cp.split(':'), x = p.platforms[+i];
    pubCopy(k === 'hashtags' ? pubTags(x) : x[k], b.closest('.pubf').querySelector('label').textContent);
  });
  body.querySelectorAll('[data-cpall]').forEach(b => b.onclick = () => {
    const x = p.platforms[+b.dataset.cpall];
    pubCopy([x.description, pubTags(x)].filter(Boolean).join('\n\n'), `Descrierea pentru ${x.name}`);
  });
}
async function pubGenerate(st) {
  if (!st.platforms.length) { toast('Bifează cel puțin o platformă.'); return; }
  const id = T.id;
  st.packBusy = true; st.packErr = ''; renderPublish();
  const r = await pubPost(`/api/publish-pack/${id}`, { platforms: st.platforms, note: st.note || '', state: aiState() });
  st.packBusy = false;
  if (r.error) st.packErr = r.error;
  else { st.pack = r.pack; st.note = r.pack.note; }
  if (T.on && T.id === id && T.tab === 'pub') renderPublish();
  else if (!r.error) toast('Pachetul de publicare e gata în tabul 📣 Publicare.');
}
async function pubCover(st) {
  const p = st.pack; if (!p.cover.title.trim()) { toast('Scrie întâi titlul copertei.'); return; }
  if (T.dirty) toast('Coperta se face după ultima variantă salvată a video-ului.');
  const b = $('#pubCover'); b.disabled = true; b.textContent = 'Fac coperta…';
  await pubPost(`/api/publish-save/${T.id}`, { pack: p });
  const r = await pubPost(`/api/cover/${T.id}`, { t: T.t, title: p.cover.title, subtitle: p.cover.subtitle });
  if (r.error) toast(r.error); else st.cover = r.url;
  renderPublish();
}

/* ---------------------------------------------------------------- 2) variantele de carlig */
function pubHooksHTML(st) {
  const ai = S.assistant || {}, files = pubJob().files || {}, busy = pubBusyJob();
  const dur = h => (h.clip || []).reduce((n, c) => n + c[1] - c[0], 0);
  let h = `<section class="pubsec"><h4>🪝 Variante de cârlig (A/B)</h4>
    <p class="sub2">Același video, cu alt început: o frază puternică din video pusă la început și/sau alt titlu mare în primele secunde.
      Fiecare variantă se randează separat (varianta_A.mp4, varianta_B.mp4…), ca să vezi pe care o urmăresc oamenii mai mult.</p>
    <div class="row">${ai.has_key ? `<button class="cta" id="hkGen" ${st.hookBusy ? 'disabled' : ''}>${st.hookBusy ? '<span class="spin"></span> Claude caută cârlige…' : '✦ Propune 3 cârlige'}</button>` : ''}
      <button class="btn sm" id="hkCur" ${st.hooks.length >= 5 ? 'disabled' : ''}>+ Variantă cu fraza de la cursor</button>
      <button class="btn sm" id="hkText" ${st.hooks.length >= 5 ? 'disabled' : ''}>+ Doar alt titlu</button></div>
    ${st.hookErr ? `<div class="msg err" style="max-width:none">${esc(st.hookErr)}</div>` : ''}`;
  st.hooks.forEach((x, i) => {
    const d = dur(x), file = files['var_' + x.label];
    h += `<div class="hkcard" data-h="${i}"><div class="hkhead"><span class="hkl">${esc(x.label)}</span>
        <span class="sub2" style="margin:0;flex:1">${esc(x.reason || '')}</span><button class="btn sm" data-hdel="${i}" title="Șterge varianta">🗑</button></div>
      <div class="hkrow"><label>La început</label>${d ? `<div class="hkclip">„${esc(x.spoken || '…')}” <em>${fmtS(d)}</em>
          <button class="btn sm" data-hplay="${i}">▶ Ascultă</button><button class="btn sm" data-hnoclip="${i}" title="Începe ca originalul">✕</button></div>`
        : '<div class="hkclip"><em>— nimic în plus, începe ca originalul</em></div>'}</div>
      <div class="hkrow"><label>Titlu mare</label><input type="text" data-ht="${i}:text" value="${esc(x.text)}" maxlength="120" placeholder="ex: Nu e vina ta că…"></div>
      <div class="hkrow"><label>Cuvânt colorat</label><input type="text" data-ht="${i}:accent" value="${esc(x.accent)}" maxlength="40" placeholder="un cuvânt din titlu"></div>
      ${file ? `<div class="hkrow"><label>Gata</label><div><a class="btn sm" href="/media/${T.id}/var_${x.label}" target="_blank">▶ Vezi</a>
        <a class="btn sm" href="/download/${T.id}/var_${x.label}">⬇ Descarcă ${esc(file)}</a></div></div>` : ''}</div>`;
  });
  if (st.hooks.length) {
    const why = busy ? 'Video-ul e în lucru — așteaptă să se termine.' : T.dirty ? 'Ai modificări nesalvate în timeline: apasă întâi „Salvează și randează”.' : '';
    h += `<div class="row"><button class="cta" id="hkRender" ${why ? 'disabled' : ''}>🎬 Randează ${st.hooks.length === 1 ? 'varianta' : `cele ${st.hooks.length} variante`}</button></div>
      ${why ? `<p class="sub2">${why}</p>` : `<p class="sub2">Durează cât ${st.hooks.length} randări obișnuite. Titlul mare apare cu animație doar cu motorul Remotion; cu motorul clasic apare ca un card fix.</p>`}`;
  }
  return h + '</section>';
}
function pubBindHooks(body, st) {
  const save = () => { clearTimeout(st.hookT); st.hookT = setTimeout(() => pubSaveHooks(st, false), 500); };
  const gen = $('#hkGen', body); if (gen) gen.onclick = () => pubProposeHooks(st);
  $('#hkCur', body).onclick = () => {
    const c = pubCueAt(T.t); if (!c) { toast('La cursor nu se vorbește. Mută cursorul pe fraza pe care o vrei la început.'); return; }
    st.hooks.push({ label: '', clip: c.clip, spoken: c.spoken, text: '', accent: '', reason: 'Fraza aleasă de tine' });
    pubSaveHooks(st, false);
  };
  $('#hkText', body).onclick = () => { st.hooks.push({ label: '', clip: [], text: 'Titlul tău aici', accent: '', reason: 'Doar alt titlu' }); pubSaveHooks(st, false); };
  body.querySelectorAll('[data-hdel]').forEach(b => b.onclick = () => { st.hooks.splice(+b.dataset.hdel, 1); pubSaveHooks(st, false); });
  body.querySelectorAll('[data-hnoclip]').forEach(b => b.onclick = () => {
    const x = st.hooks[+b.dataset.hnoclip]; x.clip = []; x.spoken = '';
    if (!x.text.trim()) x.text = 'Titlul tău aici';
    pubSaveHooks(st, false);
  });
  body.querySelectorAll('[data-hplay]').forEach(b => b.onclick = () => pubPlayClip(st.hooks[+b.dataset.hplay]));
  body.querySelectorAll('[data-ht]').forEach(el => el.oninput = () => { const [i, k] = el.dataset.ht.split(':'); st.hooks[+i][k] = el.value; save(); });
  const rb = $('#hkRender', body); if (rb) rb.onclick = () => pubSaveHooks(st, true);
}
// fraza (subtitrarea) de la cursor -> bucatile din sursa
function pubCueAt(t) {   // fraza de sub cursor, sau cea mai apropiata daca cursorul e intr-o pauza scurta (max 0,6 s)
  let best = null, dist = 0.6;
  ((T.pr.captions && T.pr.captions.cues) || []).forEach(c => {
    if (c.hidden) return;
    const r = tlCueOut(c), d = t < r.a ? r.a - t : t >= r.b ? t - r.b : 0;
    if (r.b - r.a >= 0.05 && d <= dist) { dist = d; best = { clip: pubOutToSrc(r.a, r.b), spoken: c.words.map(w => w.t).join(' ') }; }
  });
  return best;
}
function pubOutToSrc(oa, ob) {   // ca core.out_range_to_src
  const out = []; let acc = 0;
  T.segs.forEach(([a, b]) => {
    const d = b - a, x = Math.max(oa, acc), y = Math.min(ob, acc + d);
    if (y - x > 0.02) out.push([+(a + x - acc).toFixed(3), +(a + y - acc).toFixed(3)]);
    acc += d;
  });
  return out;
}
// asculta fraza-carlig pe timeline (unde e acum in video), apoi se opreste
function pubPlayClip(x) {
  if (!x.clip || !x.clip.length) return;
  const a = tlSrcToOut(x.clip[0][0]), d = x.clip.reduce((n, c) => n + c[1] - c[0], 0);
  tlPause(); tlSeek(a + 0.01); tlPlay();
  clearTimeout(S.pubPlayT); S.pubPlayT = setTimeout(() => tlPause(), d * 1000 + 150);
}
async function pubProposeHooks(st) {
  const id = T.id;
  st.hookBusy = true; st.hookErr = ''; renderPublish();
  const r = await pubPost(`/api/hooks-propose/${id}`, { state: aiState() });
  st.hookBusy = false;
  if (r.error) st.hookErr = r.error;
  else { st.hooks = r.hooks; await pubSaveHooks(st, false, true); }
  if (T.on && T.id === id && T.tab === 'pub') renderPublish();
  else if (!r.error) toast('Variantele de cârlig sunt gata în tabul 📣 Publicare.');
}
async function pubSaveHooks(st, render, quiet) {
  const r = await pubPost(`/api/hooks/${T.id}`, { hooks: st.hooks, render });
  if (r.error) { toast(r.error); return; }
  // pastrez ce scrie chiar acum in casute; serverul doar renumeroteaza (A, B, C...)
  const typing = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.ht;
  if (!typing || render) st.hooks = r.hooks;
  else st.hooks.forEach((x, i) => { if (r.hooks[i]) x.label = r.hooks[i].label; });
  if (render) toast('Am pus variantele la randat. Le găsești aici și în folderul cu rezultate.');
  if (!quiet && !typing) renderPublish();
}
