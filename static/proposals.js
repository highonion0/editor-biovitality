/* BioVitality Editor - „Cum as edita eu”: Claude propune, tu bifezi, abia apoi se aplica (punctul 5). */

S.props = {};
const P_ICON = { graphic: '✦', emphasis: 'A', sfx: '♪', cut: '✂', broll: '🎬', zoom: '🔍' };
const P_LABEL = { graphic: 'Grafică', emphasis: 'Evidențiere', sfx: 'Sunet', cut: 'Tăietură', broll: 'B-roll · DaVinci', zoom: 'Zoom' };
const P_APPLY = new Set(['graphic', 'emphasis', 'sfx', 'cut', 'broll', 'zoom']);
const pNorm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

// textul care va aparea efectiv pe ecran, ca sa-l vezi inainte sa bifezi
function pScreenText(p) {
  const t = tplOf(p.template); if (!t) return '';
  const pr = p.props && typeof p.props === 'object' ? p.props : {};
  return t.fields.filter(f => f.t === 'text').map(f => String(pr[f.k] ?? '').trim()).filter(Boolean).join(' · ');
}
function pState() { return S.props[T.id] || (S.props[T.id] = { state: 'idle', list: [], summary: '' }); }

function renderProposals() {
  const body = $('#tInspBody'); if (!body || T.tab !== 'prop') return;
  const st = pState(), ai = S.assistant || {};
  if (!ai.has_key) {
    body.innerHTML = `<div class="pbox"><h4 style="margin:0">💡 Cum aș edita eu</h4>
      <p class="sub2">Claude citește ce spui și îți propune grafică, cuvinte evidențiate, efecte sonore și tăieturi. Tu bifezi ce-ți place. Mai întâi setează cheia API.</p>
      <button class="cta" id="pToAi">Setează cheia în tabul Asistent</button></div>`;
    $('#pToAi').onclick = () => { T.tab = 'ai'; tlTabs(); };
    return;
  }
  if (st.state === 'loading') {
    body.innerHTML = `<div class="pbox"><div class="msg wait"><span class="spin"></span>Claude analizează video-ul… de obicei 20–60 de secunde.</div>
      <p class="sub2">Poți lucra între timp în celelalte taburi.</p></div>`;
    return;
  }
  if (st.state !== 'ready') {
    body.innerHTML = `<div class="pbox"><h4 style="margin:0">💡 Cum aș edita eu</h4>
      <p class="sub2">Claude citește transcrierea${T.pr.captions && T.pr.captions.cues && T.pr.captions.cues.length ? '' : ' (video-ul n-are subtitrări, deci propunerile vor fi puține)'} și ce e deja pe timeline,
        apoi îți propune editarea: grafică pe cifre și idei, cuvinte evidențiate în subtitrări, efecte sonore din biblioteca ta, tăieturi pentru bâlbe, plus idei de B-roll și zoom.
        Tu bifezi ce-ți place și abia apoi se aplică. O analiză = o singură cerere (câțiva cenți).</p>
      ${st.error ? `<div class="msg err" style="max-width:none">${esc(st.error)}</div>` : ''}
      <button class="cta" id="pRun">✦ Analizează și propune</button></div>`;
    $('#pRun').onclick = pRun;
    return;
  }
  const n = st.list.filter(p => p.checked).length;
  const row = (p, i) => `<div class="prow ${p.applied ? 'done' : ''} ${p.fail ? 'fail' : ''}" data-i="${i}">
      <input type="checkbox" data-c="${i}" ${p.checked ? 'checked' : ''} ${P_APPLY.has(p.kind) && !p.applied ? '' : 'disabled'}
        title="${P_APPLY.has(p.kind) ? 'Bifează ca să aplic' : 'Idee de făcut manual'}">
      <button class="ptime" data-seek="${i}" title="Arată pe video">${fmtTC(p.start)}</button>
      <div class="pt"><div class="phead"><span class="pk k-${p.kind}">${P_ICON[p.kind]} ${P_LABEL[p.kind]}</span><b>${esc(p.title)}</b></div>
        <small>${esc(p.reason)}</small>
        ${p.kind === 'graphic' ? `<small class="pscreen">Pe ecran: ${esc(pScreenText(p) || '—')} <em>(${esc(tplLabel(p.template))})</em></small>` : ''}
        ${p.warn ? `<small class="pwarn">⚠ ${esc(p.warn)}</small>` : ''}
        ${p.kind === 'broll' && p.broll ? `<small class="pidea">Ce să se vadă: ${esc(p.broll)}</small>` : ''}
        ${p.kind === 'broll' && p.prompt ? `<details class="pprompt"><summary>Prompt pentru DaVinci</summary><div>${esc(p.prompt)}</div></details>
          <span class="pbtns"><button class="btn sm" data-copy="${i}">📋 Copiază prompt-ul</button>${p.slotId ? `<button class="btn sm" data-open="${i}">⬚ Deschide locul</button>` : ''}</span>` : ''}
        ${p.kind === 'zoom' ? `<small class="pidea">Zoom ${(+(p.zoom || 1.2)).toFixed(2)}× între ${fmtTC(p.start)} și ${fmtTC(p.end)}</small>` : ''}
        ${p.kind === 'emphasis' && p.words ? `<small class="pidea">Cuvinte: ${esc(p.words.join(', '))}</small>` : ''}
        ${p.kind === 'sfx' && p.sfx ? `<small class="pidea">Sunet: ${esc(p.sfx)}</small>` : ''}
        ${p.result ? `<small class="pres">${p.applied ? '✓' : '✗'} ${esc(p.result)}</small>` : ''}</div></div>`;
  body.innerHTML = `<div class="pbox">
    ${st.summary ? `<div class="psum">${esc(st.summary)}</div>` : ''}
    <div class="ptools"><span>${st.list.length} propuneri · ${n} bifate</span><span class="sp"></span>
      <button class="btn sm" id="pAll">Toate</button><button class="btn sm" id="pNone">Nimic</button><button class="btn sm" id="pAgain" title="Cere o analiză nouă">↻ Din nou</button></div>
    <div class="plist" id="pList">${st.list.map(row).join('')}</div>
    <div class="pfoot"><button class="cta" id="pApply" ${n ? '' : 'disabled'}>Aplică selectate (${n})</button>
      <span class="hint" style="margin:0">${st.applied ? 'Ctrl+Z anulează tot ce am aplicat.' : 'Click pe timp = arată momentul pe video.'}</span></div></div>`;
  const list = $('#pList');
  list.onchange = e => { const c = e.target.closest('[data-c]'); if (c) { st.list[+c.dataset.c].checked = c.checked; renderProposals(); } };
  list.onclick = e => {
    const cp = e.target.closest('[data-copy]'), op = e.target.closest('[data-open]');
    if (cp) { const p = st.list[+cp.dataset.copy]; navigator.clipboard.writeText(p.prompt).then(() => toast('Prompt copiat. Lipește-l în DaVinci.'), () => toast('Nu am putut copia.')); return; }
    if (op) {
      const p = st.list[+op.dataset.open], i = T.ovs.findIndex(o => o.id === p.slotId);
      if (i < 0) { toast('Locul nu mai e pe timeline (l-ai umplut sau l-ai șters).'); return; }
      T.sel = { kind: 'ov', i }; T.tab = 'props'; tlRender(); tlTabs(); tlSeek(T.ovs[i].start + 0.2); return;
    }
    if (e.target.closest('input') || e.target.closest('details')) return;
    const r = e.target.closest('.prow'); if (!r) return;
    const p = st.list[+r.dataset.i]; tlPause(); tlSeek(Math.min(p.end - 0.05, p.start + 0.3));
    list.querySelectorAll('.prow.cur').forEach(x => x.classList.remove('cur')); r.classList.add('cur');
  };
  $('#pAll').onclick = () => { st.list.forEach(p => { if (P_APPLY.has(p.kind) && !p.applied) p.checked = true; }); renderProposals(); };
  $('#pNone').onclick = () => { st.list.forEach(p => { p.checked = false; }); renderProposals(); };
  $('#pAgain').onclick = () => { if (!st.list.some(p => p.applied) || confirm('Cer o analiză nouă? Lista de acum dispare (ce ai aplicat rămâne pe timeline).')) pRun(); };
  $('#pApply').onclick = pApply;
}

async function pRun() {
  const st = pState(), jobId = T.id;
  st.state = 'loading'; st.error = null; renderProposals();
  const r = await fetch(`/api/propose/${jobId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: aiState() }) }).then(r => r.json()).catch(() => ({ error: 'Nu mă pot conecta la aplicație.' }));
  if (r.error) { st.state = 'error'; st.error = r.error; }
  else {
    st.state = 'ready'; st.summary = r.summary; st.applied = false;
    // implicit bifate: tot ce se poate aplica, mai putin taieturile (taie din video, le alegi tu)
    st.list = (r.proposals || []).map(p => ({ ...p, checked: P_APPLY.has(p.kind) && p.kind !== 'cut' }));
  }
  if (T.on && T.id === jobId && T.tab === 'prop') renderProposals();
  else if (!r.error) toast('Propunerile sunt gata în tabul 💡 Propuneri.');
}

function pFindSfx(name) {
  const items = (S.sfx && S.sfx.items) || [], q = pNorm(name);
  if (!q) return null;
  return items.find(it => pNorm(it.cat + ' / ' + it.name) === q) || items.find(it => pNorm(it.name) === q)
    || items.find(it => pNorm(it.cat + it.name).includes(q)) || null;
}

// evidentiaza cuvintele date in subtitrarile dintre a si b (timp final); subtitrarile sunt pe timpul sursei
function tlEmphasize(a, b, words, color) {
  const cap = T.pr.captions; if (!cap || !cap.cues) return 0;
  const want = new Set((words || []).map(pNorm).filter(Boolean)); let n = 0;
  cap.cues.forEach(c => {
    const { a: s, b: e } = tlCueOut(c);
    if (e < a - 0.3 || s > b + 0.3) return;
    c.words.forEach(w => { if (want.has(pNorm(w.t))) { w.color = color; w.b = true; n++; } });
  });
  return n;
}

async function pApply() {
  const st = pState(), sel = st.list.filter(p => p.checked && !p.applied);
  if (!sel.length) return;
  $('#pApply').disabled = true;
  // sunetele: le caut in biblioteca si le copiez in proiect inainte
  if (sel.some(p => p.kind === 'sfx')) {
    await sfxLoad();
    for (const p of sel.filter(p => p.kind === 'sfx')) {
      const it = pFindSfx(p.sfx);
      if (!it) { p.info = null; continue; }
      const info = await sfxPost(`/api/sfx/use/${T.id}`, { lib: it.lib, rel: it.rel });
      p.info = info.error ? null : info;
      if (p.info && !T.assets.some(a => a.asset === p.info.asset)) T.assets.push(p.info);
    }
  }
  const done = (p, ok, msg) => { p.applied = ok; p.fail = !ok; p.result = msg; p.checked = false; };
  tlChange(() => {
    sel.filter(p => p.kind !== 'cut').forEach(p => {
      if (p.kind === 'graphic') {
        const r = aiApply('add_graphic', { template: p.template, start: p.start, end: p.end, props: p.props, x: p.x, y: p.y, w: p.w });
        done(p, r.ok, r.ok ? 'Grafică pusă pe timeline' : r.show);
      } else if (p.kind === 'emphasis') {
        const k = tlEmphasize(p.start, p.end, p.words, aiHex(p.color) || '#E8A83B');
        done(p, k > 0, k ? `${k} ${k === 1 ? 'cuvânt evidențiat' : 'cuvinte evidențiate'}` : 'Nu am găsit cuvintele în subtitrare');
      } else if (p.kind === 'zoom') {
        const r = aiApply('add_zoom', { start: p.start, end: p.end, scale: p.zoom, style: 'smooth' });
        done(p, r.ok, r.ok ? `Zoom pus pe timeline` : r.show);
      } else if (p.kind === 'broll') {
        const it = tlAddSlot({ start: p.start, end: p.end, idea: p.broll || p.title, prompt: p.prompt || '' }, false);
        p.slotId = it.id;
        done(p, true, 'Loc rezervat pe timeline — copiază prompt-ul și generează în DaVinci');
      } else if (p.kind === 'sfx') {
        if (!p.info) { done(p, false, 'Nu am găsit sunetul în biblioteca ta'); return; }
        const b = Math.min(tlTotal(), p.start + (p.info.duration || 1));
        T.auds.push({ id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: 'audio', asset: p.info.asset,
          start: p.start, end: +b.toFixed(3), source_start: 0, volume: aiNum(p.volume, 0.05, 1.5) ?? 0.7, fade_in: 0, fade_out: 0.05,
          lane: tlFreeAuLane(p.start, b) });
        done(p, true, `„${p.info.asset}” pus pe pista audio`);
      }
    });
    // taieturile la final, de la ultima spre prima: timpii celorlalte raman corecti, iar ce e dupa se muta singur
    sel.filter(p => p.kind === 'cut').sort((x, y) => y.start - x.start).forEach(p => {
      const a = p.start, b = p.end, len = aiRemoveRange(a, b);
      done(p, !!len, len ? `Am tăiat ${fmtS(len)}` : 'N-am putut tăia');
      // orele din lista se muta si ele, ca un click sa te duca unde e acum propunerea
      if (len) st.list.forEach(q => { if (q !== p && q.start >= b - 0.01) { q.start = +(q.start - len).toFixed(2); q.end = +(q.end - len).toFixed(2); } });
    });
  });
  st.applied = true;
  const ok = sel.filter(p => p.applied).length;
  toast(`Am aplicat ${ok} din ${sel.length} propuneri. Ctrl+Z le anulează pe toate.`);
  renderProposals();
}
