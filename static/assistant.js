/* BioVitality Editor - asistentul din timeline (etapa 3).
   Claude primeste starea timeline-ului si raspunde cu text + unelte. Uneltele le aplic aici, pe timeline,
   intr-un singur pas de istoric -> Ctrl+Z anuleaza tot ce a facut la o cerere. */

S.chats = {};
S.assistant = S.assistant || null;
const AI_SUGG = [
  'Pune cifrele importante ca grafică animată',
  'Adaugă un titlu mare pe primele secunde',
  'Pune câte un punct numerotat pentru fiecare idee din listă',
  'Adaugă la final un card „Urmărește-ne”',
  'Pune numele meu și BioVitality în primele secunde',
];

function aiChat() { return S.chats[T.id] || (S.chats[T.id] = { messages: [], log: [], busy: false }); }
function aiState() {
  return { segments: T.segs, overlays: T.ovs, audio: T.auds, caption_style: T.pr.captions ? T.pr.captions.style : null, t: T.t };
}

function renderAssistant() {
  const body = $('#tInspBody'); if (!body || T.tab !== 'ai') return;
  const st = S.assistant || { has_key: false, models: [] };
  if (!st.has_key || T.aiSetup) { aiSetupForm(body, st); return; }
  const chat = aiChat();
  const entry = e => e.who === 'wait'
    ? `<div class="msg wait"><span class="spin"></span>Claude lucrează…</div>`
    : `<div class="msg ${e.who}">${esc(e.text)}</div>`;
  body.innerHTML = `<div class="aibox">
    <div class="aihead"><select id="aiModel" title="Modelul Claude">${st.models.map(([id, l]) => `<option value="${id}" ${id === st.model ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <span class="sp"></span><button class="btn sm" id="aiNew" title="Începe o conversație nouă">Conversație nouă</button>
      <button class="btn sm" id="aiKey" title="Schimbă cheia API">Cheie API</button></div>
    <div class="ailog" id="aiLog">${chat.log.length ? chat.log.map(entry).join('') + (chat.busy ? entry({ who: 'wait' }) : '') :
      `<div class="sub2" style="margin:0">Spune-mi ce vrei pe timeline: grafică pe anumite fraze, un titlu, un final, schimbări la subtitrări. Văd transcrierea cu timpii și tot ce e deja pus. Orice fac se anulează cu Ctrl+Z.</div>
       <div class="sugg">${AI_SUGG.map(t => `<button data-s="${esc(t)}">${esc(t)}</button>`).join('')}</div>`}</div>
    <div class="aiin"><textarea id="aiText" placeholder="Ex: pune cifra 39 de trilioane ca grafică când o spun" ${chat.busy ? 'disabled' : ''}></textarea>
      <button class="cta" id="aiSend" ${chat.busy ? 'disabled' : ''}>Trimite</button></div></div>`;
  const log = $('#aiLog'); log.scrollTop = log.scrollHeight;
  const send = () => { const t = $('#aiText').value.trim(); if (t) aiSend(t); };
  $('#aiSend').onclick = send;
  $('#aiText').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  body.querySelectorAll('[data-s]').forEach(b => b.onclick = () => aiSend(b.dataset.s));
  $('#aiNew').onclick = () => { S.chats[T.id] = { messages: [], log: [], busy: false }; renderAssistant(); };
  $('#aiKey').onclick = () => { T.aiSetup = true; renderAssistant(); };
  $('#aiModel').onchange = e => aiConfig({ model: e.target.value });
  if (!chat.busy) $('#aiText').focus();
}

function aiSetupForm(body, st) {
  body.innerHTML = `<div class="aikey">
    <h4 style="margin:0">✦ Asistentul Claude</h4>
    <p>Ca să editez aici cu Claude, am nevoie de o <b>cheie API Anthropic</b>. O creezi din <b>console.anthropic.com → API Keys</b>.
      Se plătește separat de abonamentul Claude, după consum; o cerere de editare costă de obicei câțiva cenți.</p>
    <p>Cheia rămâne doar pe calculatorul tău (fișierul <code>asistent.json</code> din folderul aplicației).</p>
    <input type="password" id="aiKeyIn" placeholder="${st.has_key ? 'Cheie salvată: ' + esc(st.key_hint) : 'sk-ant-…'}" autocomplete="off">
    <div class="row" style="margin:0"><button class="cta" id="aiSave">Salvează cheia</button>
      ${st.has_key ? '<button class="btn" id="aiCancel">Renunță</button>' : ''}</div></div>`;
  $('#aiSave').onclick = async () => {
    const k = $('#aiKeyIn').value.trim(); if (!k) { toast('Lipește întâi cheia.'); return; }
    if (await aiConfig({ key: k })) { T.aiSetup = false; renderAssistant(); toast('Cheia e salvată. Poți vorbi cu asistentul.'); }
  };
  const c = $('#aiCancel'); if (c) c.onclick = () => { T.aiSetup = false; renderAssistant(); };
}
async function aiConfig(body) {
  const r = await fetch('/api/assistant/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => r.json()).catch(() => ({ error: 'Nu mă pot conecta la aplicație.' }));
  if (r.error) { toast(r.error); return false; }
  S.assistant = r; return true;
}

async function aiSend(text) {
  const chat = aiChat(); if (chat.busy) return;
  chat.log.push({ who: 'me', text });
  const last = chat.messages[chat.messages.length - 1];
  let appended = false;
  if (last && last.role === 'user' && Array.isArray(last.content)) { last.content.push({ type: 'text', text }); appended = true; }
  else chat.messages.push({ role: 'user', content: text });
  chat.busy = true; renderAssistant();
  const jobId = T.id;
  const r = await fetch(`/api/assistant/${jobId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: chat.messages, state: aiState() }) }).then(r => r.json()).catch(() => ({ error: 'Nu mă pot conecta la aplicație.' }));
  chat.busy = false;
  if (!T.on || T.id !== jobId) return;           // ai iesit din timeline intre timp
  if (r.error) {
    if (appended) last.content.pop(); else chat.messages.pop();
    chat.log.push({ who: 'err', text: r.error }); renderAssistant(); return;
  }
  const content = r.content || [];
  chat.messages.push({ role: 'assistant', content });
  content.filter(b => b.type === 'text' && b.text.trim()).forEach(b => chat.log.push({ who: 'ai', text: b.text.trim() }));
  const calls = content.filter(b => b.type === 'tool_use');
  if (calls.length) {
    const results = [], acts = [];
    let firstNew = null;
    tlChange(() => {
      calls.forEach(c => {
        let res;
        try { res = aiApply(c.name, c.input || {}); } catch (e) { res = { ok: false, msg: 'eroare: ' + e.message }; }
        results.push({ type: 'tool_result', tool_use_id: c.id, content: res.msg, is_error: !res.ok });
        if (res.show) acts.push((res.ok ? '✓ ' : '✗ ') + res.show);
        if (res.at != null && firstNew == null) firstNew = res.at;
      });
    });
    chat.messages.push({ role: 'user', content: results });
    acts.forEach(a => chat.log.push({ who: 'act', text: a }));
    if (firstNew != null) tlSeek(firstNew);
  }
  renderAssistant();
}

/* ---------------------------------------------------------------- uneltele */
function aiFind(id) {
  let i = T.ovs.findIndex(o => o.id === id); if (i >= 0) return { list: T.ovs, i, it: T.ovs[i] };
  i = T.auds.findIndex(a => a.id === id); if (i >= 0) return { list: T.auds, i, it: T.auds[i] };
  return null;
}
const aiNum = (v, lo, hi) => (typeof v === 'number' && isFinite(v)) ? clamp(v, lo, hi) : null;
const aiHex = v => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) ? v.toUpperCase() : null;

function aiApply(name, a) {
  const total = tlTotal();
  if (name === 'add_graphic') {
    const t = tplOf(a.template); if (!t) return { ok: false, msg: `eroare: șablon necunoscut „${a.template}”`, show: `Șablon necunoscut: ${a.template}` };
    const s0 = aiNum(a.start, 0, Math.max(0, total - 0.3)) ?? T.t;
    const e0 = aiNum(a.end, s0 + 0.3, total) ?? Math.min(total, s0 + t.dur);
    const props = tplDefaults(t);
    if (typeof a.props === 'string') { try { a.props = JSON.parse(a.props); } catch { a.props = {}; } }
    if (a.props && typeof a.props === 'object') t.fields.forEach(f => {
      if (!(f.k in a.props)) return;
      const v = a.props[f.k];
      props[f.k] = f.t === 'bool' ? !!v : f.t === 'color' ? (aiHex(v) || f.d) : String(v).slice(0, 240);
    });
    const extra = {};
    ['x', 'y'].forEach(k => { const v = aiNum(a[k], 0, 1); if (v != null) extra[k] = v; });
    const w = aiNum(a.w, 0.2, 1.4); if (w != null) extra.w = w;
    const o = tlNewGraphic(t.id, s0, e0, { ...extra, props });
    T.ovs.push(o);
    return { ok: true, msg: `ok: am adăugat id=${o.id} (${t.id}) la ${s0.toFixed(1)}–${e0.toFixed(1)} s`,
      show: `Am adăugat „${t.label}” la ${fmtTC(s0)}–${fmtTC(e0)}`, at: s0 + Math.min(1, (e0 - s0) / 2) };
  }
  if (name === 'add_zoom') {
    const s0 = aiNum(a.start, 0, Math.max(0, total - 0.3)) ?? T.t, e0 = aiNum(a.end, s0 + 0.2, total) ?? Math.min(total, s0 + 1.5);
    const z = { id: 'z' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), start: +s0.toFixed(3), end: +e0.toFixed(3),
      scale: aiNum(a.scale, 1.02, 2) ?? 1.2, x: aiNum(a.x, 0, 1) ?? 0.5, y: aiNum(a.y, 0, 1) ?? 0.42,
      style: ['punch', 'smooth', 'creep'].includes(a.style) ? a.style : 'smooth' };
    T.zooms.push(z); T.zooms.sort((p, q) => p.start - q.start);
    return { ok: true, msg: `ok: zoom ${z.scale.toFixed(2)}× la ${s0.toFixed(1)}–${e0.toFixed(1)} s`, show: `Am pus un zoom ${z.scale.toFixed(2)}× (${fmtTC(s0)}–${fmtTC(e0)})`, at: s0 + 0.2 };
  }
  if (name === 'add_broll_slot') {
    const s0 = aiNum(a.start, 0, Math.max(0, total - 0.3)) ?? T.t, e0 = aiNum(a.end, s0 + 0.3, total) ?? Math.min(total, s0 + 4);
    const it = tlAddSlot({ start: s0, end: e0, idea: a.idea, prompt: a.prompt }, false);
    return { ok: true, msg: `ok: loc de B-roll id=${it.id} la ${s0.toFixed(1)}–${e0.toFixed(1)} s`, show: `Am rezervat un loc de B-roll: ${it.idea || ''} (${fmtTC(s0)}–${fmtTC(e0)})`, at: s0 + 0.2 };
  }
  if (name === 'update_item') {
    const f = aiFind(a.id); if (!f) return { ok: false, msg: `eroare: nu există elementul ${a.id}`, show: `Nu am găsit elementul ${a.id}` };
    const it = f.it;
    const s0 = aiNum(a.start, 0, total), e0 = aiNum(a.end, 0, total);
    if (s0 != null) it.start = +s0.toFixed(3);
    if (e0 != null) it.end = +Math.max(it.start + 0.2, e0).toFixed(3);
    [['x', 0, 1], ['y', 0, 1], ['w', 0.05, 3], ['rotation', -180, 180], ['opacity', 0.05, 1], ['volume', 0, 2], ['fade_in', 0, 10], ['fade_out', 0, 10]]
      .forEach(([k, lo, hi]) => { const v = aiNum(a[k], lo, hi); if (v != null && (k in it || ['rotation', 'opacity'].includes(k))) it[k] = +v.toFixed(4); });
    if (it.type === 'graphic' && a.props && typeof a.props === 'object') {
      const t = tplOf(it.template);
      (t ? t.fields : []).forEach(fd => {
        if (!(fd.k in a.props)) return;
        const v = a.props[fd.k];
        it.props[fd.k] = fd.t === 'bool' ? !!v : fd.t === 'color' ? (aiHex(v) || it.props[fd.k]) : String(v).slice(0, 240);
      });
    }
    const label = it.type === 'graphic' ? `„${tplLabel(it.template)}”` : `„${it.asset}”`;
    return { ok: true, msg: `ok: am modificat ${a.id}`, show: `Am modificat ${label}`, at: it.start + 0.3 };
  }
  if (name === 'delete_item') {
    const f = aiFind(a.id); if (!f) return { ok: false, msg: `eroare: nu există elementul ${a.id}`, show: `Nu am găsit elementul ${a.id}` };
    f.list.splice(f.i, 1); T.sel = null;
    return { ok: true, msg: `ok: am șters ${a.id}`, show: 'Am șters un element' };
  }
  if (name === 'remove_range') {
    const s0 = aiNum(a.start, 0, total), e0 = aiNum(a.end, 0, total);
    if (s0 == null || e0 == null || e0 - s0 < 0.05) return { ok: false, msg: 'eroare: interval invalid', show: 'Interval invalid' };
    const len = aiRemoveRange(s0, e0);
    if (!len) return { ok: false, msg: 'eroare: n-am putut tăia (ar rămâne video-ul gol)', show: 'Nu am putut tăia intervalul' };
    return { ok: true, msg: `ok: am tăiat ${len.toFixed(2)} s; elementele de după s-au mutat mai devreme`, show: `Am tăiat ${fmtTC(s0)}–${fmtTC(e0)}`, at: Math.max(0, s0 - 0.5) };
  }
  if (name === 'set_caption_style') {
    const cs = T.pr.captions && T.pr.captions.style; if (!cs) return { ok: false, msg: 'eroare: video-ul nu are subtitrări', show: 'Video-ul nu are subtitrări' };
    const fonts = (S.fonts || []).map(f => f.id);
    if (fonts.includes(a.font)) cs.font = a.font;
    const sz = aiNum(a.size, 1.5, 12); if (sz != null) cs.size = +sz.toFixed(2);
    const col = aiHex(a.color); if (col) cs.color = col;
    ['uppercase', 'bold'].forEach(k => { if (typeof a[k] === 'boolean') cs[k] = a[k]; });
    const py = aiNum(a.pos_y, 0.05, 0.95); if (py != null) cs.pos_y = +py.toFixed(4);
    if (['outline', 'box', 'none'].includes(a.mode)) cs.mode = a.mode;
    if (['none', 'highlight', 'pop', 'reveal', 'pill', 'single'].includes(a.anim)) cs.anim = a.anim;
    const acol = aiHex(a.anim_color); if (acol) cs.anim_color = acol;
    return { ok: true, msg: 'ok: am schimbat stilul subtitrărilor', show: 'Am schimbat stilul subtitrărilor' };
  }
  return { ok: false, msg: `eroare: unealtă necunoscută ${name}`, show: `Unealtă necunoscută: ${name}` };
}

// taie [a, b] (timp final) din bucati; elementele de dupa se muta mai devreme, ca sa ramana pe aceleasi vorbe
function aiRemoveRange(a, b) {
  const out = [], starts = tlStarts();
  T.segs.forEach((s, i) => {
    const c = starts[i], d = s[1] - s[0], x = Math.max(a, c), y = Math.min(b, c + d);
    if (y <= x) { out.push(s); return; }
    if (x - c > 0.04) out.push([s[0], +(s[0] + (x - c)).toFixed(3)]);
    if (c + d - y > 0.04) out.push([+(s[0] + (y - c)).toFixed(3), s[1]]);
  });
  if (!out.length) return 0;
  const len = tlTotal() - out.reduce((n, s) => n + s[1] - s[0], 0);
  T.segs = out;
  const shift = it => {
    if (it.start >= b) { it.start -= len; it.end -= len; }
    else if (it.end > a) { it.end = Math.max(it.start + 0.2, it.end - Math.min(len, it.end - a)); }
    it.start = +Math.max(0, it.start).toFixed(3); it.end = +it.end.toFixed(3);
  };
  T.ovs.forEach(shift); T.auds.forEach(shift);
  return len;
}
