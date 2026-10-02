# -*- coding: utf-8 -*-
"""
BioVitality Editor - asistentul (Claude, prin API-ul Anthropic).

Serverul trimite lui Claude contextul proiectului (transcrierea cu timpi, ce e pe timeline, sabloanele de grafica)
plus o lista de unelte. Claude raspunde cu text + apeluri de unelte; uneltele le aplica INTERFATA pe timeline,
ca orice modificare sa se poata anula cu Ctrl+Z. Cheia API ramane doar pe calculatorul tau, pe server.
"""

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

import core

CONFIG = core.APP_DIR / "asistent.json"
API_URL = os.environ.get("BV_API_URL", "https://api.anthropic.com/v1/messages")
MODELS = [
    ["claude-sonnet-5", "Claude Sonnet 5 · recomandat"],
    ["claude-opus-5-5", "Claude Opus 5.5 · cel mai capabil, mai scump"],
    ["claude-haiku-4-5-20251001", "Claude Haiku 4.5 · cel mai rapid și ieftin"],
]
DEFAULT_MODEL = MODELS[0][0]


class AssistantError(Exception):
    pass


# Stilul vizual BioVitality pentru clipurile generate (DaVinci / Veo / Kling / Sora...)
BROLL_STYLE = """Reguli pentru prompt-urile de B-roll (le lipește în DaVinci, un generator video AI):
- În ENGLEZĂ, un singur paragraf de 90–160 de cuvinte, în ordinea asta:
  1. SUBIECT: exact structura/procesul din frazele ei, corect anatomic și la scara reală (ex: „the human liver inside the upper right
     abdomen, wrapped in Glisson's capsule, a thin fibrous membrane rich in pain-sensing nerve endings”). Numește structurile corect.
  2. ACȚIUNE: ce se vede întâmplându-se de la început la sfârșitul clipului, pas cu pas, ilustrând EXACT afirmația ei din acele fraze
     (ex: „the liver slowly swells, pressing outward against the stretched capsule; the nerve endings in the capsule begin to glow”).
     Nu adăuga procese sau afirmații pe care nu le spune ea.
  3. CAMERĂ: încadrarea de la început, mișcarea (slow push-in, orbit, dolly), încadrarea de la final.
  4. LUMINĂ ȘI CULORI: fundal albastru-închis spre bleumarin, strălucire difuză albastru-cyan, accente calde aurii pe elementul important,
     profunzime de câmp redusă. Pentru natură / plante / ingrediente: fotografie realistă caldă, lumină naturală moale, macro.
  5. STIL: photorealistic 3D medical visualization, high detail, cinematic, clean, scientifically accurate.
  6. TEHNIC: vertical 9:16, 6–8 seconds, one continuous shot, smooth slow motion, no cuts.
  7. EVITĂ (scrie explicit „Avoid:”): text, labels, letters, arrows, UI, logos, watermarks, human faces, gore, cartoon style,
     anatomical inaccuracies.
- Exactitate științifică înainte de spectaculos: dacă un detaliu nu e sigur, alege varianta corectă și sobră."""


# ------------------------------------------------------------ configurare
def _load():
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except Exception:
        return {}

def api_key():
    return (_load().get("key") or os.environ.get("ANTHROPIC_API_KEY") or "").strip()

def model():
    m = _load().get("model")
    return m if m in {x[0] for x in MODELS} else DEFAULT_MODEL

def status():
    k = api_key()
    return {"has_key": bool(k), "key_hint": (k[:7] + "…" + k[-4:]) if len(k) > 14 else "", "model": model(), "models": MODELS}

def save_config(key=None, mdl=None):
    cfg = _load()
    if key is not None:
        key = key.strip()
        if key and not key.startswith("sk-ant-"):
            raise AssistantError("Cheia nu arată ca o cheie API Anthropic (începe cu „sk-ant-”).")
        cfg["key"] = key
    if mdl is not None and mdl in {x[0] for x in MODELS}:
        cfg["model"] = mdl
    CONFIG.write_text(json.dumps(cfg, indent=1), encoding="utf-8")
    return status()


# ------------------------------------------------------------ campurile graficelor, explicit
def props_schema():
    keys = {}
    for t in core.TEMPLATES:
        for f in t["fields"]:
            keys.setdefault(f["k"], {"t": f["t"], "uses": []})["uses"].append(f"{t['id']}: {f['l']}")
    props = {k: {"type": "boolean" if v["t"] == "bool" else "string",
                 "description": "; ".join(v["uses"]) + (" (#RRGGBB)" if v["t"] == "color" else "")} for k, v in keys.items()}
    return {"type": "object", "properties": props,
            "description": "Textele graficei, cu cheile EXACTE ale șablonului ales (vezi catalogul). Completează toate câmpurile de text "
                           "cu textul potrivit momentului, în română. Culorile doar dacă ai un motiv."}

LINE_FIELDS = {
    "from_line": {"type": "integer", "description": "Numărul frazei (#) din transcriere la care începe. Momentul se calculează exact din el."},
    "to_line": {"type": "integer", "description": "Numărul frazei (#) la care se termină (poate fi aceeași). Implicit = from_line."},
}

def _out_cues(project, state):
    segs = core.clean_segments(state.get("segments") or project["segments"], float(project.get("source_duration") or 1e6)) \
        or project["segments"]
    cap = project.get("captions") or {}
    style = dict(cap.get("style") or {})
    if not cap.get("cues"):
        return [], segs, style
    cues = core.captions_to_out({"style": style, "cues": cap["cues"]}, segs)["cues"]
    return cues, segs, style

def _parse_props(v):
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            return {}
    return v if isinstance(v, dict) else {}

def anchor(inp, cues, total, kind="graphic"):
    """from_line / to_line -> start / end exacte din transcriere; props ca obiect."""
    if "props" in inp:
        inp["props"] = _parse_props(inp["props"])
    try:
        a = int(inp.get("from_line")) if inp.get("from_line") is not None else None
    except (TypeError, ValueError):
        a = None
    if a is not None and cues:
        a = max(1, min(len(cues), a))
        try:
            b = int(inp.get("to_line")) if inp.get("to_line") is not None else a
        except (TypeError, ValueError):
            b = a
        b = max(a, min(len(cues), b))
        start, end = cues[a - 1]["start"], cues[b - 1]["end"]
        if kind == "sfx":
            start, end = max(0.0, start - 0.05), start + 1.0
        elif kind != "cut" and end - start < 2.0:          # graficele / B-roll: macar 2 s, cat sa poata fi citite
            end = min(total, start + 2.0)
        inp["start"], inp["end"] = round(start, 2), round(min(end, total), 2)
    return inp


# ------------------------------------------------------------ uneltele pe care le poate folosi Claude
def tools():
    tids = [t["id"] for t in core.TEMPLATES]
    num = {"type": "number"}
    return [
        {"name": "add_graphic",
         "description": "Adaugă o grafică animată (un șablon) pe timeline. Timpii sunt în secunde pe video-ul FINAL (după tăieturi).",
         "input_schema": {"type": "object", "properties": {
             "template": {"type": "string", "enum": tids},
             **LINE_FIELDS,
             "start": {"type": "number", "description": "Doar dacă nu folosești from_line."},
             "end": {"type": "number", "description": "Doar dacă nu folosești to_line."},
             "props": props_schema(),
             "x": {"type": "number", "description": "Centrul pe orizontală, 0 = stânga, 1 = dreapta."},
             "y": {"type": "number", "description": "Centrul pe verticală, 0 = sus, 1 = jos."},
             "w": {"type": "number", "description": "Lățimea ca fracție din lățimea video-ului (0.3–1)."}},
             "required": ["template", "props"]}},
        {"name": "update_item",
         "description": "Modifică un element existent de pe timeline (grafică, poză, video suprapus sau melodie), după id.",
         "input_schema": {"type": "object", "properties": {
             "id": {"type": "string"}, **LINE_FIELDS, "start": num, "end": num, "x": num, "y": num, "w": num, "rotation": num,
             "opacity": num, "props": props_schema(),
             "volume": {"type": "number", "description": "Doar pentru melodii: 0–2 (1 = volumul original)."},
             "fade_in": num, "fade_out": num},
             "required": ["id"]}},
        {"name": "add_zoom",
         "description": "Pune un zoom (punch-in) pe video-ul principal, de obicei pe un cuvânt sau o frază importantă. "
                        "Centrul implicit (0.5, 0.42) e fața vorbitoarei.",
         "input_schema": {"type": "object", "properties": {
             **LINE_FIELDS, "start": num, "end": num,
             "scale": {"type": "number", "description": "Cât de mult, 1.05–1.6 (1.15–1.25 e discret și arată bine)."},
             "style": {"type": "string", "enum": list(core.ZOOM_STYLES),
                       "description": "punch = instant, smooth = intră și iese lin, creep = se apropie încet."},
             "x": num, "y": num}, "required": []}},
        {"name": "add_broll_slot",
         "description": "Rezervă un loc pentru un clip B-roll pe tot ecranul, cu prompt-ul pe care utilizatoarea îl va genera în DaVinci. "
                        "Timpii în secunde pe video-ul FINAL; de obicei 3–6 s, exact pe fraza la care se referă.",
         "input_schema": {"type": "object", "properties": {
             **LINE_FIELDS, "start": num, "end": num,
             "idea": {"type": "string", "description": "În română, scurt: ce se vede (ex: „Neuroni care transmit semnale”)."},
             "prompt": {"type": "string", "description": "Prompt-ul în engleză pentru generatorul video, după regulile de stil."}},
             "required": ["idea", "prompt"]}},
        {"name": "delete_item",
         "description": "Șterge un element de pe timeline, după id.",
         "input_schema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
        {"name": "remove_range",
         "description": "Taie din video intervalul dat (secunde pe video-ul FINAL). Folosește doar când utilizatorul cere explicit să scoți ceva.",
         "input_schema": {"type": "object", "properties": {"start": num, "end": num}, "required": ["start", "end"]}},
        {"name": "set_caption_style",
         "description": "Schimbă stilul subtitrărilor (pentru tot video-ul).",
         "input_schema": {"type": "object", "properties": {
             "font": {"type": "string", "enum": [f["id"] for f in core.FONTS]},
             "size": {"type": "number", "description": "Mărimea, % din înălțimea video-ului (3–8 e obișnuit)."},
             "color": {"type": "string", "description": "Culoare #RRGGBB."},
             "uppercase": {"type": "boolean"}, "bold": {"type": "boolean"},
             "pos_y": {"type": "number", "description": "Poziția verticală a subtitrărilor, 0 = sus, 1 = jos."},
             "mode": {"type": "string", "enum": ["outline", "box", "none"]},
             "anim": {"type": "string", "enum": list(core.CAPTION_ANIMS),
                      "description": "Animația cuvânt cu cuvânt: none=fără, highlight=cuvântul rostit colorat, pop=colorat și mărit ușor, "
                                     "reveal=cuvintele apar pe rând, pill=fundal colorat pe cuvântul rostit, single=doar cuvântul rostit."},
             "anim_color": {"type": "string", "description": "Culoarea animației, #RRGGBB."}}}},
    ]


# ------------------------------------------------------------ contextul proiectului
def _t(x):
    m = int(x // 60)
    return f"{m}:{x - m * 60:04.1f}"

def build_system(project, state):
    cues, segs, style = _out_cues(project, state)
    total = core.seg_total(segs)
    if isinstance(state.get("caption_style"), dict):
        style.update(state["caption_style"])
    lines = [f"#{n} [{_t(c['start'])}–{_t(c['end'])}] " + " ".join(w["t"] for w in c["words"]) for n, c in enumerate(cues, 1)]
    items = []
    for o in state.get("overlays") or []:
        if o.get("type") == "graphic":
            pr = ", ".join(f"{k}={json.dumps(v, ensure_ascii=False)}" for k, v in (o.get("props") or {}).items())
            items.append(f"- id={o.get('id')} · grafică „{o.get('template')}” · {_t(o['start'])}–{_t(o['end'])} · "
                         f"x={o.get('x')}, y={o.get('y')}, w={o.get('w')} · {pr}")
        else:
            items.append(f"- id={o.get('id')} · {'poză' if o.get('type') == 'image' else 'video suprapus'} „{o.get('asset')}” · "
                         f"{_t(o['start'])}–{_t(o['end'])} · x={o.get('x')}, y={o.get('y')}, w={o.get('w')}")
    for a in state.get("audio") or []:
        items.append(f"- id={a.get('id')} · melodie „{a.get('asset')}” · {_t(a['start'])}–{_t(a['end'])} · volum {a.get('volume')}")
    catalog = []
    for t in core.TEMPLATES:
        fields = "; ".join(f"{f['k']} ({f['l']}, implicit: {json.dumps(f['d'], ensure_ascii=False)})" for f in t["fields"])
        catalog.append(f"- {t['id']} — {t['label']}: {t['desc']} Poziție implicită x={t['x']}, y={t['y']}, w={t['w']}; "
                       f"durată tipică {t['dur']} s. Câmpuri: {fields}")
    script = (project.get("settings") or {}).get("script", "").strip()
    cap_y = style.get("pos_y", 0.72)
    return f"""Ești asistentul de editare video din aplicația BioVitality Editor. Lucrezi cu Andreea, co-fondatoarea BioVitality
(brand românesc de suplimente inspirate din Ayurveda; ton cald, educativ, de încredere). Video-urile sunt scurte, verticale, pentru social media.

Cum lucrezi:
- Răspunde în limba în care ți se scrie (de obicei română), scurt: 1–3 propoziții. Scrie întâi ce faci, apoi folosește uneltele.
- Toți timpii sunt în secunde pe video-ul FINAL (după tăieturi). Fiecare frază din transcriere are un număr (#).
  Ca să pui ceva exact pe o frază, folosește from_line / to_line cu numerele frazelor — NU calcula tu secundele.
  Grafica apare odată cu fraza la care se referă și ține cât ea (de obicei 1–3 fraze, 2,5–5 s).
- Textul din grafică trebuie să vină din ce spune ea în acele fraze (sau din script), scurt și exact — nu inventa alte cifre sau idei.
- Subtitrările stau în jurul lui y={cap_y}. Pune grafica departe de ele (de obicei y între 0,15 și 0,45) și evită ca două grafice să apară în același loc în același timp.
- Texte scurte și clare, în română cu diacritice. Cifrele scrise exact cum le spune ea.
- Culorile brandului: auriu #E8A83B (accent), crem #F3EDDD, salvie #94C1A0, verde închis #13211A. Nu schimba culorile fără motiv.
- Nu adăuga elemente pe care nu le-a cerut. Dacă cererea e neclară, pune o singură întrebare scurtă în loc să ghicești.
- Nu tăia nimic din video decât dacă ți se cere explicit.
- B-roll: nu poți genera video, dar poți rezerva un loc pe timeline cu add_broll_slot și prompt-ul pentru DaVinci.
- Zoom (punch-in) pe momentele importante: add_zoom, de obicei 1–2 s, scale 1.15–1.25. Nu pune zoom peste zoom.

""" + BROLL_STYLE + f"""

Video-ul: {project['width']}×{project['height']}, durată finală {total:.1f} s, cursorul e la {float(state.get('t') or 0):.1f} s.
Subtitrări: font {style.get('font')}, mărime {style.get('size')}, poziție y={cap_y}, mod {style.get('mode')}.

Transcrierea, frază cu frază (#număr [început–sfârșit pe video-ul final] text):
{chr(10).join(lines) if lines else '(fără transcriere)'}

Ce e acum pe timeline:
{chr(10).join(items) if items else '(nimic suprapus încă)'}

Șabloanele de grafică disponibile:
{chr(10).join(catalog)}
""" + (f"\nScriptul video-ului:\n{script[:5000]}\n" if script else "")


def _check_context(system):
    """Paza: daca sablonul instructiunilor s-a stricat, nu trimit o cerere „oarba” (si platita) lui Claude."""
    import re
    if re.search(r"\{(chr\(|total|project|style|cap_y|lines|items|catalog|script|float\()", system) or "#1 [" not in system and "(fără transcriere)" not in system:
        raise AssistantError("Eroare internă: contextul pentru Claude e incomplet, așa că n-am trimis cererea. Spune-i lui Claude (în chat) ce s-a întâmplat.")
    return system


def _clean_messages(msgs):
    """Istoricul trimis de interfata: pastrez ultimele mesaje, incepand cu un mesaj text al utilizatorului."""
    out = [m for m in (msgs or []) if isinstance(m, dict) and m.get("role") in ("user", "assistant")][-40:]
    def plain_user(m):
        c = m.get("content")
        return m["role"] == "user" and (isinstance(c, str) or all(isinstance(b, dict) and b.get("type") == "text" for b in c or []))
    while out and not plain_user(out[0]):
        out.pop(0)
    if not out:
        raise AssistantError("Scrie-mi ce vrei să fac.")
    return out


def ask(project, state, messages):
    key = api_key()
    if not key:
        raise AssistantError("Nu ai setat încă cheia API. O adaugi din tabul Asistent.")
    body = {"model": model(), "max_tokens": 2000, "system": _check_context(build_system(project, state)),
            "tools": tools(), "messages": _clean_messages(messages)}
    data = _post(body, key)
    cues, segs, _ = _out_cues(project, state)
    total = core.seg_total(segs)
    for b in data.get("content", []):
        if b.get("type") == "tool_use" and isinstance(b.get("input"), dict):
            anchor(b["input"], cues, total)
    return {"content": data.get("content", []), "stop_reason": data.get("stop_reason"), "usage": data.get("usage", {})}


# ------------------------------------------------------------ propuneri de editare (punctul 5)
PROPOSAL_KINDS = ["graphic", "emphasis", "sfx", "cut", "broll", "zoom"]

def propose_tool():
    num = {"type": "number"}
    return {
        "name": "propose_edits",
        "description": "Trimite lista de propuneri de editare pentru acest video. Utilizatoarea le vede pe rând și le bifează pe cele pe care le vrea.",
        "input_schema": {"type": "object", "properties": {
            "summary": {"type": "string", "description": "1–2 propoziții: ideea generală a editării tale."},
            "proposals": {"type": "array", "items": {"type": "object", "properties": {
                "kind": {"type": "string", "enum": PROPOSAL_KINDS,
                         "description": "graphic = grafică animată; emphasis = cuvinte evidențiate în subtitrări; sfx = efect sonor din bibliotecă; "
                                        "cut = taie o porțiune (bâlbă, pauză lungă); broll = idee de imagini peste vorbitor; zoom = zoom pe vorbitor."},
                **LINE_FIELDS,
                "start": {"type": "number", "description": "Doar pentru cut, sau dacă nu folosești from_line."},
                "end": {"type": "number", "description": "Doar pentru cut, sau dacă nu folosești to_line."},
                "title": {"type": "string", "description": "Scurt: ce apare sau ce se face (max 60 de caractere)."},
                "reason": {"type": "string", "description": "De ce ajută (o propoziție)."},
                "template": {"type": "string", "enum": [t["id"] for t in core.TEMPLATES], "description": "Doar pentru graphic."},
                "props": props_schema(),
                "x": num, "y": num, "w": num,
                "words": {"type": "array", "items": {"type": "string"}, "description": "Doar pentru emphasis: cuvintele exacte din subtitrare."},
                "color": {"type": "string", "description": "Doar pentru emphasis: #RRGGBB (implicit auriul brandului)."},
                "sfx": {"type": "string", "description": "Doar pentru sfx: numele EXACT al unui sunet din biblioteca dată."},
                "volume": num,
                "broll": {"type": "string", "description": "Doar pentru broll: ce se vede, în română, scurt."},
                "prompt": {"type": "string", "description": "Doar pentru broll: prompt-ul în engleză pentru DaVinci, după regulile de stil."},
                "zoom": {"type": "number", "description": "Doar pentru zoom: cât de mult (1.1–1.4)."}},
                "required": ["kind", "title", "reason"]}}},
            "required": ["summary", "proposals"]}}


PROPOSE_GUIDE = """
Sarcina ta acum: analizează video-ul ca un editor profesionist de video-uri scurte și propune editarea completă.
Ce contează:
- Cârligul din primele 2–3 secunde: de obicei un Titlu mare sau o Cifră mare care să oprească scroll-ul.
- Grafică pe cifre, pe idei-cheie și pe structura de tip listă (Punct numerotat pentru fiecare idee, Pași pentru procese). Fiecare grafică apare exact pe fraza ei.
- În subtitrări evidențiază doar cuvintele cu adevărat importante (1–2 pe frază, nu în fiecare frază). Cuvintele exact cum apar în transcriere.
- Efecte sonore discrete, doar din biblioteca de mai jos, cu numele exact: de obicei un whoosh/pop când intră o grafică, un riser înaintea unei revelații. Fără exagerări.
- „cut” doar pentru bâlbe, repetări sau pauze clar inutile care au rămas.
- „broll”: 2–4 momente unde imaginile explică mai bine decât vorbitorul (procese din corp, molecule, organe, ingrediente),
  fiecare cu from_line / to_line, „broll” (ce se vede, în română) și „prompt” (în engleză, pentru DaVinci, după regulile de mai sus).
  Prompt-ul ilustrează EXACT afirmația din acele fraze, cu structurile numite corect — nu o imagine generică despre subiect.
- „zoom”: 1–3 momente-cheie (o cifră, o afirmație tare), fiecare cu from_line / to_line și „zoom” (1.05–1.6; 1.15–1.25 arată bine).
- Nu pune elemente peste cele care există deja pe timeline și nu suprapune două grafice în același loc în același timp.
- Măsură: pentru un video de ~45 s, de obicei 4–8 grafice, 4–8 evidențieri, 2–5 efecte sonore.
- Momentele: pentru tot ce ține de o frază folosește from_line / to_line (numerele # din transcriere), nu secunde.
  Doar „cut” poate avea start / end în secunde.
- Pentru „graphic” completează OBLIGATORIU „props” cu cheile exacte ale șablonului și textul potrivit acelui moment
  (luat din ce spune ea sau din script). Fără texte generice sau din alte video-uri.
- Totul în română, cu diacritice. Trimite propunerile folosind unealta propose_edits.
"""


def propose(project, state, sfx_names):
    key = api_key()
    if not key:
        raise AssistantError("Nu ai setat încă cheia API. O adaugi din tabul Asistent.")
    lib = "\n".join(f"- {n}" for n in sfx_names[:300]) if sfx_names else "(biblioteca de sunete e goală — nu propune efecte sonore)"
    system = build_system(project, state) + PROPOSE_GUIDE + "\nBiblioteca de efecte sonore (categorie / nume):\n" + lib
    body = {"model": model(), "max_tokens": 4000, "system": _check_context(system), "tools": [propose_tool()],
            "tool_choice": {"type": "tool", "name": "propose_edits"},
            "messages": [{"role": "user", "content": "Analizează video-ul și propune-mi cum l-ai edita."}]}
    data = _post(body, key)
    call = next((b for b in data.get("content", []) if b.get("type") == "tool_use" and b.get("name") == "propose_edits"), None)
    if not call:
        raise AssistantError("Claude n-a trimis propuneri. Mai încearcă o dată.")
    inp = call.get("input") or {}
    cues, segs, _ = _out_cues(project, state)
    total = core.seg_total(segs)
    out = []
    raw = inp.get("proposals") or []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = []
    for i, p in enumerate(raw):
        if not isinstance(p, dict) or p.get("kind") not in PROPOSAL_KINDS:
            continue
        anchor(p, cues, total, p.get("kind"))
        try:
            a, b = max(0.0, float(p.get("start", 0))), min(total, float(p.get("end", 0)))
        except (TypeError, ValueError):
            continue
        if b <= a:
            b = min(total, a + 1.0)
        q = {k: v for k, v in p.items() if k in ("kind", "title", "reason", "template", "props", "x", "y", "w",
                                                 "words", "color", "sfx", "volume", "broll", "prompt", "zoom")}
        q.update(id=f"p{i}", start=round(a, 2), end=round(b, 2),
                 title=str(p.get("title", ""))[:90], reason=str(p.get("reason", ""))[:240])
        if q["kind"] == "graphic":
            t = core.TEMPLATE_BY_ID.get(q.get("template"))
            pr = q.get("props") if isinstance(q.get("props"), dict) else {}
            texts = [f["k"] for f in (t["fields"] if t else []) if f["t"] == "text" and str(pr.get(f["k"], "")).strip()]
            if not t:
                q["warn"] = "Șablon necunoscut"
            elif not texts:
                q["warn"] = "Claude n-a completat textul graficei — ar apărea textul exemplu. Mai bine „Din nou” sau scrie-l tu după aplicare."
        out.append(q)
    out.sort(key=lambda q: q["start"])
    return {"summary": str(inp.get("summary", ""))[:400], "proposals": out, "usage": data.get("usage", {})}


def _post(body, key):
    req = urllib.request.Request(API_URL, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), method="POST",
                                 headers={"content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        _raise_http(e)
    except urllib.error.URLError:
        raise AssistantError("Nu mă pot conecta la Claude. Verifică internetul.")


def _raise_http(e):
    try:
        msg = json.loads(e.read().decode("utf-8")).get("error", {}).get("message", "")
    except Exception:
        msg = ""
    low = msg.lower()
    if e.code == 401:
        raise AssistantError("Cheia API nu e validă. Verific-o în console.anthropic.com → API Keys.")
    if e.code == 404 or ("model" in low and "not" in low):
        raise AssistantError(f"Modelul „{model()}” nu e disponibil pentru cheia ta. Alege alt model din tabul Asistent.")
    if "credit" in low or "billing" in low:
        raise AssistantError("Contul API nu mai are credit. Îl reîncarci din console.anthropic.com → Billing.")
    if e.code == 429:
        raise AssistantError("Prea multe cereri într-un timp scurt. Mai încearcă peste un minut.")
    if e.code in (500, 502, 503, 529):
        raise AssistantError("Serverele Claude sunt aglomerate acum. Mai încearcă puțin mai târziu.")
    raise AssistantError(f"Claude a răspuns cu o eroare ({e.code}). {msg[:200]}")


def broll_prompt(project, state, idea, start, end):
    """Scrie (sau rescrie) prompt-ul pentru un loc de B-roll, pe baza a ce spune exact in acel moment."""
    key = api_key()
    if not key:
        raise AssistantError("Nu ai setat încă cheia API. O adaugi din tabul Asistent.")
    cues, _, _ = _out_cues(project, state)
    start, end = float(start or 0), float(end or 0)
    inside = [n for n, c in enumerate(cues) if c["end"] > start + 0.05 and c["start"] < end - 0.05]
    say = lambda n: " ".join(w["t"] for w in cues[n]["words"])
    spoken = " ".join(say(n) for n in inside) or "(nu vorbește în acest interval)"
    before = say(inside[0] - 1) if inside and inside[0] > 0 else ""
    after = say(inside[-1] + 1) if inside and inside[-1] + 1 < len(cues) else ""
    system = build_system(project, state) + "\nSarcina ta acum: scrie prompt-ul pentru un clip B-roll.\n" + BROLL_STYLE + \
        "\nRăspunde DOAR cu prompt-ul în engleză, fără ghilimele, fără titluri, fără explicații."
    ask_txt = (f"Clip B-roll între {start:.1f} și {end:.1f} s (pe tot ecranul, peste vorbitoare).\n"
               f"Ce spune EXACT în acest moment: „{spoken}”\n"
               + (f"Fraza de dinainte: „{before}”\n" if before else "")
               + (f"Fraza de după: „{after}”\n" if after else "")
               + (f"Ideea ei pentru imagine: {idea}\n" if idea else "")
               + "Clipul trebuie să arate exact ce spune ea în acest moment.")
    body = {"model": model(), "max_tokens": 700, "system": _check_context(system), "messages": [{"role": "user", "content": ask_txt}]}
    data = _post(body, key)
    text = " ".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip().strip('"')
    if not text:
        raise AssistantError("Claude n-a trimis prompt-ul. Mai încearcă o dată.")
    return {"prompt": text[:3000], "spoken": spoken}
