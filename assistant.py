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
    ["claude-sonnet-5-5", "Claude Sonnet 5.5 · cel mai nou Sonnet, același preț"],
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
PROPOSAL_KINDS = ["graphic", "emphasis", "sfx", "cut", "broll", "zoom", "libmedia"]

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
                                        "cut = taie o porțiune (bâlbă, pauză lungă); broll = idee de imagini peste vorbitor (de generat în DaVinci); "
                                        "zoom = zoom pe vorbitor; libmedia = o poză / un clip din biblioteca ei."},
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
                "zoom": {"type": "number", "description": "Doar pentru zoom: cât de mult (1.1–1.4)."},
                "media": {"type": "string", "description": "Doar pentru libmedia: numele EXACT din biblioteca de poze și clipuri (categorie / nume)."},
                "mode": {"type": "string", "enum": ["small", "full", "bg"],
                         "description": "Doar pentru libmedia: small = mic peste video (logo, produs), full = pe tot ecranul (B-roll), "
                                        "bg = fundal, iar ea apare într-o fereastră peste el (explică ce se vede în poză)."}},
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
- „libmedia”: dacă în biblioteca ei de poze și clipuri (lista de mai jos) e ceva potrivit unui moment (produsul despre care vorbește,
  un ingredient, ambalajul), propune-l cu numele EXACT din listă, cu from_line / to_line și „mode”. Materialele ei sunt mai autentice:
  pentru un moment, preferă o poză / un clip din bibliotecă în locul unui „broll” de generat. Nu inventa nume care nu sunt în listă.
- „zoom”: 1–3 momente-cheie (o cifră, o afirmație tare), fiecare cu from_line / to_line și „zoom” (1.05–1.6; 1.15–1.25 arată bine).
- Nu pune elemente peste cele care există deja pe timeline și nu suprapune două grafice în același loc în același timp.
- Măsură: pentru un video de ~45 s, de obicei 4–8 grafice, 4–8 evidențieri, 2–5 efecte sonore.
  Pentru video-uri lungi (câteva minute), proporțional cu durata, dar cel mult ~40 de propuneri, pe momentele cele mai importante.
- Momentele: pentru tot ce ține de o frază folosește from_line / to_line (numerele # din transcriere), nu secunde.
  Doar „cut” poate avea start / end în secunde.
- Pentru „graphic” completează OBLIGATORIU „props” cu cheile exacte ale șablonului și textul potrivit acelui moment
  (luat din ce spune ea sau din script). Fără texte generice sau din alte video-uri.
- Totul în română, cu diacritice. Trimite propunerile folosind unealta propose_edits.
"""


def propose(project, state, sfx_names, media_names=()):
    key = api_key()
    if not key:
        raise AssistantError("Nu ai setat încă cheia API. O adaugi din tabul Asistent.")
    lib = "\n".join(f"- {n}" for n in sfx_names[:300]) if sfx_names else "(biblioteca de sunete e goală — nu propune efecte sonore)"
    media = "\n".join(f"- {n}" for n in media_names[:400]) if media_names else "(biblioteca de poze și clipuri e goală — nu propune „libmedia”)"
    system = build_system(project, state) + PROPOSE_GUIDE + "\nBiblioteca de efecte sonore (categorie / nume):\n" + lib + \
        "\n\nBiblioteca ei de poze și clipuri (categorie / nume):\n" + media
    data, inp = _tool_call(system, "Analizează video-ul și propune-mi cum l-ai edita.", propose_tool(), 16000)
    if inp is None:
        raise AssistantError("Claude n-a trimis propuneri. Mai încearcă o dată.")
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
                                                 "words", "color", "sfx", "volume", "broll", "prompt", "zoom", "media", "mode")}
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


# modelele noi (Opus 5.5, Sonnet 5.5) nu mai accepta unealta impusa („tool_choice: tool”) -> o cer prin instructiune
NO_FORCED_TOOL = ("claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1")

def _tool_call(system, user_text, tool, max_tokens):
    """O cerere in care Claude raspunde folosind o singura unealta. Intoarce (raspunsul, inputul uneltei sau None)."""
    key = api_key()
    if not key:
        raise AssistantError("Nu ai setat încă cheia API. O adaugi din tabul Asistent.")
    body = {"model": model(), "max_tokens": max_tokens, "system": _check_context(system), "tools": [tool],
            "messages": [{"role": "user", "content": user_text}]}
    if model() in NO_FORCED_TOOL:
        body["tool_choice"] = {"type": "auto"}
        body["messages"][0]["content"] = user_text + f"\n\nTrimite răspunsul folosind unealta {tool['name']}."
    else:
        body["tool_choice"] = {"type": "tool", "name": tool["name"]}
    data = _post(body, key)
    if data.get("stop_reason") == "refusal":
        raise AssistantError("Claude a refuzat cererea. Încearcă din nou sau reformulează indicațiile.")
    call = next((b for b in data.get("content", []) if b.get("type") == "tool_use" and b.get("name") == tool["name"]), None)
    if call is None and data.get("stop_reason") == "max_tokens":
        raise AssistantError("Răspunsul lui Claude a fost prea lung și s-a întrerupt. Mai încearcă o dată.")
    return data, (call.get("input") or {}) if call else None


def _post(body, key):
    req = urllib.request.Request(API_URL, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), method="POST",
                                 headers={"content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"})
    try:
        with urllib.request.urlopen(req, timeout=400) as r:      # video-urile lungi (10+ min) au transcrieri mari
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


# ------------------------------------------------------------ pachetul de publicare (punctul 4)
PLATFORMS = {"tiktok": "TikTok", "instagram": "Instagram Reels", "youtube": "YouTube Shorts", "facebook": "Facebook Reels"}
HASHTAG_MAX = {"tiktok": 5, "instagram": 12, "youtube": 5, "facebook": 3}
LANG_FULL = {"ro": "română", "it": "italiană", "en": "engleză"}
PACK_FILE = "publicare.json"
CAPTION_FILE = "caption.txt"     # captionul scris de ea, ca fisier text (se deschide in Notepad)

def save_caption(job_dir, text):
    text = str(text or "").replace("\r\n", "\n").strip()[:5000]
    f = Path(job_dir) / CAPTION_FILE
    if text:
        f.write_text(text.replace("\n", "\r\n") + "\r\n", encoding="utf-8-sig")   # BOM + CRLF: diacriticele si randurile arata bine in Notepad
    else:
        f.unlink(missing_ok=True)
    return text

def load_caption(job_dir):
    try:
        return (Path(job_dir) / CAPTION_FILE).read_text(encoding="utf-8-sig").replace("\r\n", "\n").strip()
    except OSError:
        return ""

def pack_tool(platforms):
    return {
        "name": "publish_pack",
        "description": "Trimite pachetul de publicare: textul copertei și, pentru fiecare platformă, descrierea, hashtag-urile, "
                       "textul de pe copertă și primul comentariu.",
        "input_schema": {"type": "object", "properties": {
            "cover": {"type": "object", "description": "Textul pentru imaginea de copertă (comun tuturor platformelor).", "properties": {
                "title": {"type": "string", "description": "Titlul mare: 2–6 cuvinte, oprește scroll-ul."},
                "subtitle": {"type": "string", "description": "Opțional: 3–8 cuvinte care completează titlul."}},
                "required": ["title"]},
            "platforms": {"type": "array", "items": {"type": "object", "properties": {
                "platform": {"type": "string", "enum": platforms},
                "title": {"type": "string", "description": "Doar pentru youtube: titlul Short-ului, max 90 de caractere."},
                "description": {"type": "string", "description": "Textul postării, gata de lipit."},
                "hashtags": {"type": "array", "items": {"type": "string"}, "description": "Fără #, fără spații în interior."},
                "cover_text": {"type": "string", "description": "Textul scurt de pe coperta acestei platforme (2–6 cuvinte)."},
                "first_comment": {"type": "string", "description": "Primul comentariu, pe care îl postează ea imediat după publicare."}},
                "required": ["platform", "description", "hashtags", "cover_text", "first_comment"]}}},
            "required": ["cover", "platforms"]}}

PACK_GUIDE = """
Sarcina ta acum: pregătește pachetul de publicare pentru acest video, pentru fiecare platformă cerută.
Reguli generale:
- Totul în limba {lang}, cu diacritice, pe tonul brandului: cald, educativ, de încredere. Fără clickbait înșelător.
- Conținutul vine DOAR din ce spune ea în video (și din script). Nu adăuga afirmații de sănătate, cifre, studii sau beneficii noi.
  Fără promisiuni de vindecare sau tratament: BioVitality vinde suplimente alimentare.
- Fără linkuri și fără prețuri. Emoji cu măsură (0–3 pe text).
- Hashtag-uri relevante pentru subiect și pentru publicul din România (dacă limba e română), amestec de generale și de nișă,
  fără hashtag-uri interzise sau spam. Scrise fără #.
Pe platforme:
- tiktok: descriere scurtă (1–2 propoziții, max ~150 de caractere) care completează video-ul, eventual o întrebare. 3–5 hashtag-uri.
- instagram: 3–6 rânduri scurte: prima frază e cârligul (se vede înainte de „mai mult”), apoi ideea principală, apoi o invitație
  (salvează / trimite cuiva / comentează). 6–12 hashtag-uri.
- youtube: „title” obligatoriu (max 90 de caractere, clar și căutabil) + descriere de 1–3 propoziții. 3–5 hashtag-uri, printre ele „shorts”.
- facebook: ton de conversație, 2–4 propoziții, o întrebare la final. 1–3 hashtag-uri.
- cover_text: 2–6 cuvinte, potrivite platformei (pe TikTok și Reels coperta se vede în grilă — să fie clar despre ce e video-ul).
- first_comment: un comentariu util al ei care pornește discuția (o întrebare, un detaliu în plus din video sau o invitație la
  următorul video), 1–2 propoziții, diferit de descriere.
Trimite totul cu unealta publish_pack.
"""

def _clean_tags(tags, n):
    out, seen = [], set()
    for t in tags if isinstance(tags, list) else str(tags or "").split():
        t = "".join(str(t).replace("#", " ").split())[:60]
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out[:n]

def publish_pack(project, state, platforms, note="", caption=""):
    platforms = [p for p in PLATFORMS if p in (platforms or [])] or list(PLATFORMS)
    lang = LANG_FULL.get((project.get("settings") or {}).get("language"), "română")
    system = build_system(project, state) + PACK_GUIDE.replace("{lang}", lang)
    ask_txt = "Pregătește pachetul de publicare pentru: " + ", ".join(PLATFORMS[p] for p in platforms) + "."
    if note.strip():
        ask_txt += f"\nIndicațiile mele pentru acest video: {note.strip()[:1000]}"
    if caption.strip():
        ask_txt += ("\nCaptionul scris de mine pentru acest video (folosește-l ca bază: păstrează-i ideea, tonul și formulările mele, "
                    f"doar adaptează-l pe fiecare platformă):\n{caption.strip()[:3000]}")
    data, inp = _tool_call(system, ask_txt, pack_tool(platforms), 8000)
    if inp is None:
        raise AssistantError("Claude n-a trimis pachetul. Mai încearcă o dată.")
    raw = inp.get("platforms") or []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = []
    by = {}
    for p in raw if isinstance(raw, list) else []:
        if isinstance(p, dict) and p.get("platform") in platforms and p["platform"] not in by:
            by[p["platform"]] = {
                "platform": p["platform"], "name": PLATFORMS[p["platform"]],
                "title": str(p.get("title") or "")[:100] if p["platform"] == "youtube" else "",
                "description": str(p.get("description") or "").strip()[:2200],
                "hashtags": _clean_tags(p.get("hashtags"), HASHTAG_MAX[p["platform"]]),
                "cover_text": " ".join(str(p.get("cover_text") or "").split())[:80],
                "first_comment": str(p.get("first_comment") or "").strip()[:600]}
    if not by:
        raise AssistantError("Claude n-a completat nicio platformă. Mai încearcă o dată.")
    cover = inp.get("cover") if isinstance(inp.get("cover"), dict) else {}
    return {"cover": {"title": " ".join(str(cover.get("title") or "").split())[:80],
                      "subtitle": " ".join(str(cover.get("subtitle") or "").split())[:100]},
            "platforms": [by[p] for p in platforms if p in by], "note": note.strip()[:1000], "usage": data.get("usage", {})}

def clean_pack(raw):
    """Pachetul trimis inapoi de interfata (dupa ce l-a editat ea), curatat inainte de salvare."""
    raw = raw if isinstance(raw, dict) else {}
    cover = raw.get("cover") if isinstance(raw.get("cover"), dict) else {}
    out = {"cover": {"title": str(cover.get("title") or "")[:80], "subtitle": str(cover.get("subtitle") or "")[:100]},
           "platforms": [], "note": str(raw.get("note") or "")[:1000]}
    for p in raw.get("platforms") or []:
        if isinstance(p, dict) and p.get("platform") in PLATFORMS:
            out["platforms"].append({"platform": p["platform"], "name": PLATFORMS[p["platform"]],
                                     "title": str(p.get("title") or "")[:100], "description": str(p.get("description") or "")[:2200],
                                     "hashtags": _clean_tags(p.get("hashtags"), 30), "cover_text": str(p.get("cover_text") or "")[:80],
                                     "first_comment": str(p.get("first_comment") or "")[:600]})
    return out

def pack_text(pack, video_name, caption=""):
    """Varianta de citit (publicare.txt), ca s-o poti deschide si din folderul cu rezultate."""
    lines = [f"PACHET DE PUBLICARE · {video_name}", ""]
    if caption:
        lines += ["=== Captionul meu ===", caption, "", ""]
    c = pack.get("cover") or {}
    if c.get("title"):
        lines += [f"Coperta: {c['title']}" + (f" / {c['subtitle']}" if c.get("subtitle") else ""), ""]
    for p in pack.get("platforms") or []:
        lines += [f"=== {p['name']} ==="]
        if p.get("title"):
            lines += [f"Titlu: {p['title']}"]
        lines += [f"Text pe copertă: {p['cover_text']}", "", "Descriere:", p["description"]]
        if p.get("hashtags"):
            lines += ["", " ".join("#" + t for t in p["hashtags"])]
        lines += ["", "Primul comentariu:", p["first_comment"], "", ""]
    return "\n".join(lines)

def save_pack(job_dir, pack, video_name):
    job_dir = Path(job_dir)
    pack = clean_pack(pack)
    (job_dir / PACK_FILE).write_text(json.dumps(pack, ensure_ascii=False, indent=1), encoding="utf-8")
    (job_dir / "publicare.txt").write_text(pack_text(pack, video_name, load_caption(job_dir)), encoding="utf-8-sig")
    return pack

def load_pack(job_dir):
    try:
        return clean_pack(json.loads((Path(job_dir) / PACK_FILE).read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return None


# ------------------------------------------------------------ variante de carlig (punctul 6)
def hooks_tool():
    return {
        "name": "propose_hooks",
        "description": "Trimite 3 variante de început (cârlig) pentru același video, ca să fie testate una contra alteia.",
        "input_schema": {"type": "object", "properties": {
            "hooks": {"type": "array", "items": {"type": "object", "properties": {
                **LINE_FIELDS,
                "text": {"type": "string", "description": "Titlul mare de pe ecran în primele secunde: 3–7 cuvinte."},
                "accent": {"type": "string", "description": "Un singur cuvânt din text, scris colorat (cuvântul-cheie)."},
                "reason": {"type": "string", "description": "O propoziție: ce unghi testează varianta asta."}},
                "required": ["text", "reason"]}}},
            "required": ["hooks"]}}

HOOKS_GUIDE = """
Sarcina ta acum: propune 3 variante de cârlig (începutul video-ului) ca să le testeze una contra alteia (A/B).
Fiecare variantă are:
- o frază din video pusă la început, înaintea video-ului întreg (from_line / to_line, de obicei o singură frază, max ~6 secunde):
  cea mai surprinzătoare afirmație, o cifră, o întrebare sau o problemă pe care o simte publicul. Alege-o din mijlocul sau
  finalul video-ului — nu prima frază, care oricum e deja la început. Fraza trebuie să se înțeleagă singură, fără context.
  Poți lăsa o variantă fără frază (fără from_line), doar cu alt titlu peste începutul original.
- un titlu mare pe ecran (text, 3–7 cuvinte) + cuvântul colorat (accent, un cuvânt din text).
Cele 3 variante trebuie să testeze unghiuri diferite (de ex.: curiozitate, cifră/fapt surprinzător, problemă/durere, beneficiu),
cu fraze diferite. Doar ce spune ea în video — fără afirmații noi de sănătate. În limba video-ului, cu diacritice.
Trimite variantele cu unealta propose_hooks.
"""

def propose_hooks(project, state):
    system = build_system(project, state) + HOOKS_GUIDE
    data, inp = _tool_call(system, "Propune-mi 3 variante de cârlig pentru video-ul acesta.", hooks_tool(), 6000)
    if inp is None:
        raise AssistantError("Claude n-a trimis variantele. Mai încearcă o dată.")
    cues, segs, _ = _out_cues(project, state)
    raw = inp.get("hooks") or []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = []
    out = []
    for h in raw if isinstance(raw, list) else []:
        if not isinstance(h, dict):
            continue
        item = {"text": h.get("text"), "accent": h.get("accent"), "reason": h.get("reason"), "clip": []}
        if h.get("from_line") is not None and cues:
            anchor(h, cues, core.seg_total(segs), "cut")
        if "start" in h and "end" in h:
            item["clip"] = core.out_range_to_src(h["start"], h["end"], segs)
            item["spoken"] = " ".join(w["t"] for c in cues if c["end"] > h["start"] + 0.05 and c["start"] < h["end"] - 0.05
                                      for w in c["words"])
        out.append(item)
    hooks = core.clean_hooks(out, float(project.get("source_duration") or 1e6))
    if not hooks:
        raise AssistantError("Claude n-a trimis variante folosibile. Mai încearcă o dată.")
    return {"hooks": hooks, "usage": data.get("usage", {})}


# ------------------------------------------------------------ materialele ei, fara indicatie: Claude alege momentul
def place_tool():
    return {
        "name": "place_materials",
        "description": "Alege momentul din video pentru fiecare material al ei (poză sau clip). Toate materialele trebuie folosite.",
        "input_schema": {"type": "object", "properties": {
            "placements": {"type": "array", "items": {"type": "object", "properties": {
                "name": {"type": "string", "description": "Numele EXACT al fișierului, din lista dată."},
                **LINE_FIELDS,
                "reason": {"type": "string", "description": "De ce acolo (scurt)."}},
                "required": ["name", "from_line"]}}},
            "required": ["placements"]}}

def place_materials(project, items):
    """items: [{asset, type, where}] -> {asset: (start, end)} pe video-ul final."""
    if not api_key() or not items:
        return {}
    lst = "\n".join(f"- {it['asset']} ({'poză' if it['type'] == 'image' else 'clip'})"
                    + (f" — indicația ei: {it['where']}" if it.get("where") else "") for it in items)
    system = build_system(project, {}) + """
Sarcina ta acum: ea a urcat aceste materiale (poze / clipuri) ca să apară OBLIGATORIU în video. Pentru fiecare, alege fraza
la care se potrivește cel mai bine, după numele fișierului și după ce spune ea (from_line / to_line, de obicei 1–2 fraze).
Folosește-le pe toate, fiecare o singură dată, în momente diferite. Trimite răspunsul cu unealta place_materials.
"""
    data, inp = _tool_call(system, "Materialele mele:\n" + lst, place_tool(), 4000)
    if not inp:
        return {}
    cues, segs, _ = _out_cues(project, {})
    total = core.seg_total(segs)
    names = {it["asset"] for it in items}
    out = {}
    for p in inp.get("placements") or []:
        if not isinstance(p, dict) or p.get("name") not in names or p["name"] in out:
            continue
        anchor(p, cues, total, "cut")
        if "start" in p and "end" in p:
            out[p["name"]] = (float(p["start"]), float(p["end"]))
    return out
