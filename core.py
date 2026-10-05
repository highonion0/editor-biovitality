#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BioVitality Editor - motorul de procesare.

Pasi: 1) taie tacerile  2) transcrie vorba  3) arde subtitrarile pe video.
Fiecare pas raporteaza progresul prin report(event), ca interfata sa-l afiseze live.
Transcrierea incearca placa video NVIDIA si trece singura pe procesor daca nu merge.
"""

import os
import re
import sys
import json
import shutil
import sysconfig
import subprocess
import threading
from pathlib import Path
from urllib.parse import quote as urllib_quote

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

IS_WIN = os.name == "nt"
NO_WINDOW = 0x08000000 if IS_WIN else 0   # nu deschide ferestre negre pentru subprocese

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"}

# calitate transcriere -> (model Whisper, marime descarcare)
MODELS = {
    "rapid":      ("small",    "~0,5 GB"),
    "echilibrat": ("medium",   "~1,5 GB"),
    "precis":     ("large-v3", "~3 GB"),
}
# sensibilitate la pauze -> prag de volum sub care sunetul e considerat liniste
CUT_PRESETS = {
    "blanda":   "2%",
    "normala":  "3%",
    "agresiva": "5%",
}
MARGIN_MAX = 3.0
LANG_NAMES = {"ro": "RO", "it": "IT", "en": "EN"}
QUALITY_NAMES = {"rapid": "Rapid", "echilibrat": "Echilibrat", "precis": "Precis"}
CUT_NAMES = {"blanda": "sensibilitate mică", "normala": "sensibilitate normală", "agresiva": "sensibilitate mare"}

DEFAULTS = {
    "language": "ro",
    "quality": "rapid",
    "cut": "normala",
    "margin": 0.2,          # secunde pastrate inainte de fiecare fraza
    "margin_after": None,   # secunde dupa fraza; None = la fel ca inainte
    "words_per_caption": 5,
    "burn_captions": True,
    "vocabulary": "BioVitality",
    "auto_start": False,       # False = dupa incarcare astept scriptul si butonul „Porneste”
    "script": "",
    "script_captions": True,   # subtitrarile iau textul exact din script
    "script_retakes": True,    # scot reluarile, pastrez ultima dubla
    "script_offscript": True,  # scot ce nu e in script
}
STYLE = {
    "font": "Arial",
    "font_size": 15,
    "caption_v_pos": 0.72,
    "text_color": "&H00FFFFFF",
    "outline_color": "&H00201510",
}


# ------------------------------------------------------------ subtitrari editabile
APP_DIR = Path(__file__).resolve().parent
FONT_DIR = APP_DIR / "fonts"
STYLE_FILE = APP_DIR / "stil_subtitrari.json"
# ratio = (winAscent + winDescent) / unitsPerEm -> cum transforma motorul de subtitrari marimea fontului
FONTS = [
    {"id": "Montserrat", "label": "Montserrat · modern", "ratio": 1.562, "files": [
        ["Montserrat-Regular.ttf", 400, "normal"], ["Montserrat-Italic.ttf", 400, "italic"],
        ["Montserrat-Bold.ttf", 700, "normal"], ["Montserrat-BoldItalic.ttf", 700, "italic"]]},
    {"id": "Poppins", "label": "Poppins · rotunjit", "ratio": 1.762, "files": [
        ["Poppins-Regular.ttf", 400, "normal"], ["Poppins-Italic.ttf", 400, "italic"],
        ["Poppins-Bold.ttf", 700, "normal"], ["Poppins-BoldItalic.ttf", 700, "italic"]]},
    {"id": "Bebas Neue", "label": "Bebas Neue · înalt", "ratio": 1.300, "files": [
        ["BebasNeue-Regular.ttf", 400, "normal"]]},
    {"id": "Anton", "label": "Anton · impact", "ratio": 1.733, "files": [
        ["Anton-Regular.ttf", 400, "normal"]]},
    {"id": "DM Serif Display", "label": "DM Serif · elegant", "ratio": 1.371, "files": [
        ["DMSerifDisplay-Regular.ttf", 400, "normal"], ["DMSerifDisplay-Italic.ttf", 400, "italic"]]},
    {"id": "Arial", "label": "Arial · clasic", "ratio": 1.117, "files": []},
]
FONT_BY_ID = {f["id"]: f for f in FONTS}
FONT_FILES = {x[0] for f in FONTS for x in f["files"]}

DEFAULT_CAPTION_STYLE = {
    "font": "Montserrat", "size": 4.8, "color": "#FFFFFF",
    "bold": True, "italic": False, "uppercase": True,
    "mode": "outline", "outline": 0.3, "outline_color": "#14100C",
    "box_color": "#000000", "box_opacity": 65,
    "pos_x": 0.5, "pos_y": 0.66,     # sub ~0.72 intra sub interfata Reels / TikTok
    "anim": "none", "anim_color": "#E8A83B",   # animatia cuvant cu cuvant
}
CAPTION_ANIMS = ("none", "highlight", "pop", "reveal", "pill", "single")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

def _hex(v, d):
    return v.upper() if isinstance(v, str) and _HEX.match(v) else d

def _num(v, lo, hi, d):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return d

def clean_style(raw):
    d = dict(DEFAULT_CAPTION_STYLE)
    raw = raw if isinstance(raw, dict) else {}
    if raw.get("font") in FONT_BY_ID: d["font"] = raw["font"]
    d["size"] = round(_num(raw.get("size"), 1.5, 12, d["size"]), 2)
    d["color"] = _hex(raw.get("color"), d["color"])
    for k in ("bold", "italic", "uppercase"):
        if isinstance(raw.get(k), bool): d[k] = raw[k]
    if raw.get("mode") in ("outline", "box", "none"): d["mode"] = raw["mode"]
    d["outline"] = round(_num(raw.get("outline"), 0, 1.5, d["outline"]), 3)
    d["outline_color"] = _hex(raw.get("outline_color"), d["outline_color"])
    d["box_color"] = _hex(raw.get("box_color"), d["box_color"])
    d["box_opacity"] = round(_num(raw.get("box_opacity"), 0, 100, d["box_opacity"]))
    d["pos_x"] = round(_num(raw.get("pos_x"), 0.02, 0.98, d["pos_x"]), 4)
    d["pos_y"] = round(_num(raw.get("pos_y"), 0.02, 0.98, d["pos_y"]), 4)
    if raw.get("anim") in CAPTION_ANIMS: d["anim"] = raw["anim"]
    d["anim_color"] = _hex(raw.get("anim_color"), d["anim_color"])
    return d

def clean_captions(raw):
    raw = raw if isinstance(raw, dict) else {}
    cues = []
    for c in (raw.get("cues") or [])[:5000]:
        if not isinstance(c, dict):
            continue
        start = _num(c.get("start"), 0, 1e6, 0.0)
        end = _num(c.get("end"), 0, 1e6, start + 0.5)
        if end <= start:
            end = start + 0.3
        words = []
        for w in (c.get("words") or [])[:300]:
            if not isinstance(w, dict):
                continue
            t = str(w.get("t", "")).strip()[:80]
            if not t:
                continue
            nw = {"t": t}
            if isinstance(w.get("b"), bool): nw["b"] = w["b"]
            if isinstance(w.get("i"), bool): nw["i"] = w["i"]
            if w.get("u") is True: nw["u"] = True
            col = _hex(w.get("color"), None)
            if col: nw["color"] = col
            try:
                ws, we = float(w["s"]), float(w["e"])
                if start - 0.5 <= ws <= we <= end + 0.5:
                    nw["s"], nw["e"] = round(ws, 3), round(we, 3)
            except (KeyError, TypeError, ValueError):
                pass
            words.append(nw)
        if words:
            cue = {"start": round(start, 3), "end": round(end, 3), "words": words}
            if c.get("hidden") is True:
                cue["hidden"] = True          # ascunsa: ramane in lista, dar nu apare pe video
            cues.append(cue)
    cues.sort(key=lambda c: c["start"])
    return {"version": 1, "style": clean_style(raw.get("style")), "cues": cues}

def load_default_style():
    try:
        return clean_style(json.loads(STYLE_FILE.read_text(encoding="utf-8")))
    except Exception:
        return dict(DEFAULT_CAPTION_STYLE)

def save_default_style(style):
    st = clean_style(style)
    STYLE_FILE.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
    return st

def build_captions(chunks, style):
    cues = []
    for ch in chunks:
        a, b, text = ch[0], ch[1], ch[2]
        timed = ch[3] if len(ch) > 3 else None
        toks = text.split()
        if timed and len(timed) == len(toks):          # timpul fiecarui cuvant, din transcriere
            words = [{"t": t, "s": ws, "e": we} for t, (ws, we, _) in zip(toks, timed)]
        else:
            words = [{"t": t} for t in toks]
        cues.append({"start": a, "end": b, "words": words})
    return clean_captions({"style": style, "cues": cues})

def word_times(cue):
    """Timpul fiecarui cuvant dintr-o fraza. Unde lipseste (proiecte vechi, cuvinte rescrise), il estimez
    dupa lungimea cuvintelor, intre vecinii cu timp cunoscut. ACEEASI regula e in JS si in Remotion."""
    ws = cue["words"]; n = len(ws)
    s = [w.get("s") for w in ws]; e = [w.get("e") for w in ws]
    out = [None] * n
    i = 0
    while i < n:
        if s[i] is not None and e[i] is not None:
            out[i] = [max(cue["start"], s[i]), min(cue["end"], max(s[i], e[i]))]; i += 1; continue
        j = i
        while j < n and (s[j] is None or e[j] is None):
            j += 1
        a = out[i - 1][1] if i > 0 else cue["start"]
        b = s[j] if j < n else cue["end"]
        if b < a: b = a
        wts = [max(1, len(ws[k]["t"])) for k in range(i, j)]; tot = sum(wts); acc = a
        for k, wt in zip(range(i, j), wts):
            d = (b - a) * wt / tot
            out[k] = [acc, acc + d]; acc += d
        i = j
    return out

def captions_text(cap):
    out, line = [], []
    for c in cap["cues"]:
        for w in c["words"]:
            line.append(w["t"])
            if re.search(r"[.!?]$", w["t"]):
                out.append(" ".join(line)); line = []
    if line:
        out.append(" ".join(line))
    return "\n".join(out) + "\n"

def _ass_col(h, alpha=0):
    return f"&H{alpha:02X}{h[5:7]}{h[3:5]}{h[1:3]}".upper()

def _ass_tag_col(h):
    return f"&H{h[5:7]}{h[3:5]}{h[1:3]}&".upper()

def _ass_text(t):
    return t.replace("\\", "/").replace("{", "(").replace("}", ")")

def write_ass_captions(cap, dst, width, height):
    st = cap["style"]
    fs = max(8, round(st["size"] / 100 * height))
    ml = round(width * 0.08)
    x, y = round(st["pos_x"] * width), round(st["pos_y"] * height)
    bold, ital = -1 if st["bold"] else 0, -1 if st["italic"] else 0
    fields = lambda name, primary, oc, border, outline: (
        f"Style: {name},{st['font']},{fs},{primary},&H000000FF,{oc},&H00000000,{bold},{ital},0,0,"
        f"100,100,0,0,{border},{outline},0,5,{ml},{ml},0,1")
    styles = []
    box = st["mode"] == "box"
    if box:
        # fundalul se deseneaza separat, dintr-o bucata, ca sa nu apara dungi intre cuvintele stilizate
        pad = max(2, round(fs * 0.18))
        styles.append(fields("Box", "&HFF000000", _ass_col(st["box_color"], round(255 * (1 - st["box_opacity"] / 100))), 3, pad))
        styles.append(fields("Cap", _ass_col(st["color"]), "&H00000000", 1, 0))
    elif st["mode"] == "outline":
        styles.append(fields("Cap", _ass_col(st["color"]), _ass_col(st["outline_color"]), 1, round(st["outline"] / 100 * height, 1)))
    else:
        styles.append(fields("Cap", _ass_col(st["color"]), _ass_col(st["outline_color"]), 1, 0))

    anim = st.get("anim", "none")
    acol = _ass_tag_col(st.get("anim_color", "#E8A83B"))

    def render(words, full, active=None, upto=None):
        parts = []
        for k, w in enumerate(words):
            t = _ass_text(w["t"])
            if st["uppercase"]:
                t = t.upper()
            tags = ""
            on = active is not None and k == active
            if upto is not None and k > upto:
                tags += "\\alpha&HFF&"                                  # „aparitie”: cuvintele viitoare, invizibile (locul ramane)
            if full and on and anim in ("highlight", "pop", "pill"):
                tags += "\\c" + acol
            elif full and w.get("color"): tags += "\\c" + _ass_tag_col(w["color"])
            if on and anim == "pop":
                tags += "\\fscx112\\fscy112"
            if "b" in w: tags += "\\b" + ("1" if w["b"] else "0")      # latimea literelor trebuie sa fie aceeasi
            if full and "i" in w: tags += "\\i" + ("1" if w["i"] else "0")  # italicul nu schimba latimea, deci nu intra in fundal
            if full and w.get("u"): tags += "\\u1"
            parts.append("{" + tags + "}" + t + "{\\r}" if tags else t)
        return "{\\an5\\pos(%d,%d)}" % (x, y) + " ".join(parts)

    with open(dst, "w", encoding="utf-8") as f:
        f.write(f"[Script Info]\nScriptType: v4.00+\nPlayResX: {width}\nPlayResY: {height}\n"
                "WrapStyle: 0\nScaledBorderAndShadow: yes\n\n")
        f.write("[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,"
                "OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,"
                "Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n")
        f.write("\n".join(styles) + "\n\n")
        f.write("[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n")
        for c in cap["cues"]:
            if c.get("hidden"):
                continue
            if anim == "none":
                t0, t1 = fmt_ts(c["start"], ".")[1:-1], fmt_ts(c["end"], ".")[1:-1]
                if box:
                    f.write(f"Dialogue: 0,{t0},{t1},Box,,0,0,0,,{render(c['words'], False)}\n")
                f.write(f"Dialogue: 1,{t0},{t1},Cap,,0,0,0,,{render(c['words'], True)}\n")
                continue
            times = word_times(c)
            for k, (ws, _we) in enumerate(times):
                a = c["start"] if k == 0 else ws                                 # cuvantul ramane activ pana incepe urmatorul
                b = times[k + 1][0] if k + 1 < len(times) else c["end"]
                if b - a < 0.01:
                    continue
                t0, t1 = fmt_ts(a, ".")[1:-1], fmt_ts(b, ".")[1:-1]
                words = [c["words"][k]] if anim == "single" else c["words"]
                act = 0 if anim == "single" else k
                upto = k if anim == "reveal" else None
                if box:
                    f.write(f"Dialogue: 0,{t0},{t1},Box,,0,0,0,,{render(words, False, act, upto)}\n")
                f.write(f"Dialogue: 1,{t0},{t1},Cap,,0,0,0,,{render(words, True, act, upto)}\n")

def _next_final(job_dir):
    """video_final.mp4, apoi video_final_2.mp4, _3 ... (numarul creste mereu, ca sa stii care e cea mai noua)."""
    top = 0
    for f in Path(job_dir).glob("video_final*.mp4"):
        m = re.fullmatch(r"video_final(?:_(\d+))?\.mp4", f.name)
        if m:
            top = max(top, int(m.group(1) or 1))
    return "video_final.mp4" if top == 0 else f"video_final_{top + 1}.mp4"

def merge_settings(raw):
    cfg = dict(DEFAULTS)
    raw = raw if isinstance(raw, dict) else {}
    if raw.get("language") in LANG_NAMES: cfg["language"] = raw["language"]
    if raw.get("quality") in MODELS: cfg["quality"] = raw["quality"]
    if raw.get("cut") in CUT_PRESETS: cfg["cut"] = raw["cut"]
    cfg["margin"] = _sec(raw.get("margin"), DEFAULTS["margin"])
    cfg["margin_after"] = _sec(raw.get("margin_after"), None) if raw.get("margin_after") is not None else None
    try: cfg["words_per_caption"] = max(2, min(8, int(raw.get("words_per_caption", 5))))
    except (TypeError, ValueError): pass
    if "burn_captions" in raw: cfg["burn_captions"] = bool(raw["burn_captions"])
    if isinstance(raw.get("vocabulary"), str): cfg["vocabulary"] = raw["vocabulary"][:300]
    if isinstance(raw.get("script"), str): cfg["script"] = raw["script"].strip()[:30000]
    for k in ("auto_start", "script_captions", "script_retakes", "script_offscript"):
        if isinstance(raw.get(k), bool): cfg[k] = raw[k]
    return cfg

def _sec(v, default):
    try:
        return round(max(0.0, min(MARGIN_MAX, float(v))), 2)
    except (TypeError, ValueError):
        return default

def _fmt_sec(v):
    return f"{v:g}".replace(".", ",") + " s"

def margin_label(cfg):
    a, b = cfg["margin"], cfg["margin_after"]
    if b is None or b == a:
        return f"respiro {_fmt_sec(a)}"
    return f"respiro {_fmt_sec(a)} / {_fmt_sec(b)}"

def settings_summary(cfg):
    parts = [LANG_NAMES[cfg["language"]], QUALITY_NAMES[cfg["quality"]], margin_label(cfg)]
    if not cfg["burn_captions"]: parts.append("fără text ars")
    if cfg.get("script"): parts.append("după script")
    return " · ".join(parts)


# ------------------------------------------------------------ NVIDIA pe Windows
def _setup_nvidia_dlls():
    """Face vizibile DLL-urile NVIDIA instalate prin pip (cuBLAS, cuDNN)."""
    if not IS_WIN:
        return
    roots = set()
    try:
        import site
        roots.update(site.getsitepackages())
        roots.add(site.getusersitepackages())
    except Exception:
        pass
    roots.add(sysconfig.get_paths().get("purelib", ""))
    for root in roots:
        base = Path(root) / "nvidia" if root else None
        if not base or not base.is_dir():
            continue
        for bin_dir in base.glob("*/bin"):
            try:
                os.add_dll_directory(str(bin_dir))
            except Exception:
                pass
            os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")

_setup_nvidia_dlls()

def _find_dll(name):
    for d in os.environ.get("PATH", "").split(os.pathsep):
        try:
            if d and (Path(d) / name).is_file():
                return True
        except OSError:
            pass
    return False

_gpu_name_cache = {"done": False, "name": None}
def gpu_name():
    if not _gpu_name_cache["done"]:
        name = None
        try:
            r = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                               capture_output=True, encoding="utf-8", errors="replace",
                               timeout=6, creationflags=NO_WINDOW)
            if r.returncode == 0 and r.stdout.strip():
                name = r.stdout.strip().splitlines()[0].strip()
        except Exception:
            pass
        _gpu_name_cache.update(done=True, name=name)
    return _gpu_name_cache["name"]

def _short_gpu(name):
    return (name or "").replace("NVIDIA ", "").replace("GeForce ", "").strip()

_cuda = {"state": None, "error": None}   # None = neincercat, True = merge, False = a picat

def device_status():
    name = gpu_name()
    cuda_count = 0
    try:
        import ctranslate2
        cuda_count = ctranslate2.get_cuda_device_count()
    except Exception:
        pass
    libs = (_find_dll("cublas64_12.dll") and _find_dll("cudnn64_9.dll")) if IS_WIN else True
    if _cuda["state"] is False:
        return {"mode": "gpu_failed", "label": "Procesor",
                "hint": f"Placa video n-a pornit ({_cuda['error']}). Merge pe procesor."}
    if name and cuda_count > 0 and libs:
        label = f"GPU · {_short_gpu(name)}"
        return {"mode": "gpu", "label": label, "confirmed": _cuda["state"] is True}
    if name:
        return {"mode": "gpu_libs", "label": "Procesor · GPU neactivat",
                "hint": "Ai placă NVIDIA, dar lipsesc librăriile ei. Rulează „instaleaza_gpu.bat”, "
                        "apoi repornește aplicația."}
    return {"mode": "cpu", "label": "Procesor"}


# ------------------------------------------------------------ utilitare
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")

def find_tool(name):
    p = shutil.which(name)
    if p:
        return p
    cands = [sysconfig.get_path("scripts")]
    try:
        import site
        cands.append(str(Path(site.getuserbase()) / ("Python%d%d" % sys.version_info[:2]) / "Scripts"))
        cands.append(str(Path(site.getuserbase()) / "bin"))
    except Exception:
        pass
    for d in cands:
        for ext in ("", ".exe"):
            f = Path(d or "") / (name + ext)
            if f.is_file():
                return str(f)
    raise RuntimeError(f"„{name}” nu e instalat. Rulează din nou setup_windows.bat.")

def probe_duration(path):
    try:
        r = subprocess.run([find_tool("ffprobe"), "-v", "error", "-show_entries", "format=duration",
                            "-of", "csv=p=0", str(path)], capture_output=True,
                           encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
        return float(r.stdout.strip())
    except Exception:
        return 0.0

def probe_size(path):
    try:
        r = subprocess.run([find_tool("ffprobe"), "-v", "error", "-select_streams", "v:0",
                            "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(path)],
                           capture_output=True, encoding="utf-8", errors="replace",
                           creationflags=NO_WINDOW)
        w, h = r.stdout.strip().splitlines()[0].split("x")[:2]
        return int(w), int(h)
    except Exception:
        return 720, 1280

def probe_rotation(path):
    """Unghiul din eticheta de rotatie (video-uri de telefon). 0 daca nu are."""
    try:
        import json
        r = subprocess.run([find_tool("ffprobe"), "-v", "error", "-select_streams", "v:0",
                            "-show_entries", "stream_tags=rotate:stream_side_data=rotation",
                            "-of", "json", str(path)], capture_output=True,
                           encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
        st = (json.loads(r.stdout or "{}").get("streams") or [{}])[0]
        for sd in st.get("side_data_list", []) or []:
            if "rotation" in sd:
                return int(round(float(sd["rotation"]))) % 360
        if "rotate" in (st.get("tags") or {}):
            return int(st["tags"]["rotate"]) % 360
    except Exception:
        pass
    return 0

def fmt_ts(t, sep=","):
    ms_total = int(round(max(0.0, t) * 1000))
    h, rem = divmod(ms_total, 3600000)
    m, rem = divmod(rem, 60000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"

def _short_err(e):
    msg = str(e).strip().splitlines()
    return (msg[-1] if msg else e.__class__.__name__)[:180]


# ------------------------------------------------------------ 1. taiere
# ------------------------------------------------------------ 2. transcriere
_models = {}
_model_lock = threading.Lock()

def _ensure_model(size, size_label, report):
    from faster_whisper.utils import download_model
    try:
        return download_model(size, local_files_only=True)
    except Exception:
        report({"type": "log", "msg": f"Descarc modelul „{size}” ({size_label}) — doar prima dată."})
        report({"type": "stage_detail", "n": 2, "detail": f"Descarc modelul ({size_label})…"})
        report({"type": "progress", "value": None})
        return download_model(size)

def load_model(quality, report):
    size, size_label = MODELS[quality]
    with _model_lock:
        if size in _models:
            return _models[size]
        _models.clear()  # tinem un singur model in memorie
        path = _ensure_model(size, size_label, report)
        from faster_whisper import WhisperModel
        import numpy as np
        attempts = []
        if device_status()["mode"] == "gpu" and _cuda["state"] is not False:
            attempts.append(("cuda", "float16"))
        attempts.append(("cpu", "int8"))
        last_err = None
        for dev, ctype in attempts:
            try:
                where = "placa video" if dev == "cuda" else "procesor"
                report({"type": "log", "msg": f"Pornesc modelul „{size}” pe {where}..."})
                report({"type": "stage_detail", "n": 2, "detail": f"Pornesc modelul pe {where}…"})
                kw = {} if dev == "cuda" else {"cpu_threads": max(4, (os.cpu_count() or 4) - 2)}
                model = WhisperModel(path, device=dev, compute_type=ctype, **kw)
                # proba scurta: aici ar pica daca lipsesc librariile NVIDIA
                segs, _ = model.transcribe(np.zeros(16000, dtype=np.float32), beam_size=1)
                list(segs)
                if dev == "cuda":
                    _cuda["state"] = True
                _models[size] = (model, dev)
                return model, dev
            except Exception as e:
                last_err = e
                if dev == "cuda":
                    _cuda.update(state=False, error=_short_err(e))
                    report({"type": "log", "msg": f"Placa video n-a pornit ({_short_err(e)}). Trec pe procesor."})
        raise RuntimeError(f"Nu am putut porni transcrierea: {_short_err(last_err)}")

def _prompt(cfg):
    terms = [t.strip() for t in re.split(r"[,;\n]", cfg.get("vocabulary", "")) if t.strip()]
    base = {"ro": "Bună, astăzi vorbim despre sănătate, natură și echilibru.",
            "it": "Ciao, oggi parliamo di salute, natura ed equilibrio.",
            "en": "Hi, today we talk about health, nature and balance."}[cfg["language"]]
    return (base + " " + ", ".join(terms) + ".") if terms else base

def transcribe(src, cfg, report, on_segment):
    report({"type": "stage", "n": 2})
    report({"type": "progress", "value": None})
    model, dev = load_model(cfg["quality"], report)
    st = device_status()
    report({"type": "device", "device": dev,
            "label": st["label"] if dev == "cuda" else "Procesor"})
    duration = probe_duration(src) or 1.0
    report({"type": "stage_detail", "n": 2, "detail": "Ascult și scriu…"})
    report({"type": "progress", "value": 0})
    segments, _info = model.transcribe(str(src), language=cfg["language"], word_timestamps=True,
                                       beam_size=5, initial_prompt=_prompt(cfg))
    words = []
    for seg in segments:
        text = seg.text.strip()
        if text:
            on_segment(seg.start, seg.end, text)
        for w in (seg.words or []):
            t = w.word.strip()
            if t:
                words.append((w.start, w.end, t))
        report({"type": "progress", "value": round(min(99.0, seg.end / duration * 100), 1)})
    report({"type": "stage_detail", "n": 2,
            "detail": f"{len(words)} cuvinte · {'GPU' if dev == 'cuda' else 'procesor'}"})
    report({"type": "log", "msg": f"{len(words)} cuvinte transcrise."})
    return words


# ------------------------------------------------------------ subtitrari
def chunk_words(words, n):
    chunks, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        gap = (nxt[0] - w[1]) if nxt else 0
        if len(cur) >= n or re.search(r"[.!?]$", w[2]) or gap > 0.8:
            chunks.append(cur); cur = []
    if cur:
        chunks.append(cur)
    out = [[c[0][0], c[-1][1], " ".join(x[2] for x in c), [tuple(x) for x in c]] for c in chunks]
    for i in range(len(out) - 1):            # lipim textul pana la urmatorul, daca pauza e mica
        if 0 < out[i + 1][0] - out[i][1] < 0.35:
            out[i][1] = out[i + 1][0]
    return [tuple(c) for c in out]

def write_srt(chunks, dst):
    with open(dst, "w", encoding="utf-8") as f:
        for i, (start, end, text) in enumerate(chunks, 1):
            f.write(f"{i}\n{fmt_ts(start)} --> {fmt_ts(end)}\n{text}\n\n")

def write_ass(chunks, dst, width, height):
    ref = min(width, height) * 16 / 9 if width < height else height
    scale = ref / 720.0
    fs = round(STYLE["font_size"] * scale * 2.4)
    outline = max(1, round(2.4 * scale)); shadow = max(0, round(1.2 * scale))
    margin_v = round((1 - STYLE["caption_v_pos"]) * height)
    style = (f"Style: Cap,{STYLE['font']},{fs},{STYLE['text_color']},&H000000FF,"
             f"{STYLE['outline_color']},&H80000000,-1,0,0,0,100,100,0,0,1,"
             f"{outline},{shadow},2,{round(width*0.08)},{round(width*0.08)},{margin_v},1")
    with open(dst, "w", encoding="utf-8") as f:
        f.write(f"[Script Info]\nScriptType: v4.00+\nPlayResX: {width}\nPlayResY: {height}\n"
                "WrapStyle: 0\n\n")
        f.write("[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,"
                "OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,"
                "Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n")
        f.write(style + "\n\n")
        f.write("[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n")
        for start, end, text in chunks:
            text = text.replace("\n", " ").replace("{", "(").replace("}", ")").upper()
            f.write(f"Dialogue: 0,{fmt_ts(start,'.')[1:-1]},{fmt_ts(end,'.')[1:-1]},Cap,,0,0,0,,{text}\n")


# ------------------------------------------------------------ codare (ffmpeg)
def _ffmpeg_run(src, vf, dst, cwd, venc, duration, report):
    cmd = [find_tool("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error", "-i", str(src)]
    if vf:
        cmd += ["-vf", vf]
    cmd += [*venc, "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart",
            "-progress", "pipe:1", "-nostats", str(dst)]
    p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
    last = -1.0
    for line in p.stdout:
        if line.startswith(("out_time_us=", "out_time_ms=")):
            try:
                t = int(line.split("=", 1)[1]) / 1e6
            except ValueError:
                continue
            pct = min(99.0, t / duration * 100)
            if pct - last >= 1:
                last = pct
                report({"type": "progress", "value": round(pct, 1)})
    err = p.stderr.read()
    return p.wait(), err

def encode(src, dst, vf, cwd, report, n, what):
    """Recodeaza video-ul (optional cu filtru). Incearca NVENC pe placa video, apoi procesorul."""
    duration = probe_duration(src) or 1.0
    encoders = []
    if gpu_name():
        encoders.append(("placa video (NVENC)", ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "19", "-b:v", "0", "-g", "30"]))
    encoders.append(("procesor", ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", "30"]))
    last_err = ""
    for where, venc in encoders:
        report({"type": "log", "msg": f"{what}, codez pe {where}..."})
        report({"type": "stage_detail", "n": n, "detail": f"{what} · {where.split(' (')[0]}"})
        report({"type": "progress", "value": 0})
        rc, err = _ffmpeg_run(Path(src).resolve(), vf, Path(dst).resolve(), cwd, venc, duration, report)
        if rc == 0 and Path(dst).exists():
            return
        last_err = (err or "").strip()[-400:]
        report({"type": "log", "msg": f"Codarea pe {where} n-a mers, încerc altfel."})
    raise RuntimeError(f"{what} a eșuat. {last_err}")

def burn(src, ass, dst, report):
    report({"type": "stage", "n": 3})
    try:
        fonts = os.path.relpath(FONT_DIR, ass.parent).replace("\\", "/")
        encode(src, dst, f"subtitles={ass.name}:fontsdir={fonts}", str(ass.parent), report, 3, "Ard subtitrările")
    except RuntimeError as e:
        raise RuntimeError(f"Arderea subtitrărilor a eșuat. {e}")
    report({"type": "stage_detail", "n": 3, "detail": "Subtitrări arse pe video"})


# ------------------------------------------------------------ proiectul (etapa 1)
# Sursa adevarului pentru fiecare video e project.json:
#   segments  = bucatile pastrate, in timpul video-ului SURSA (secunde), in ordinea de pe timeline
#               (de obicei ca in sursa, dar pot fi mutate)
#   captions  = subtitrarile, tot in timpul SURSA -> raman corecte daca schimbi taieturile
#   overlays  = poze / video-uri suprapuse (timeline-ul din etapa 2)
REMOTION_DIR = APP_DIR / "remotion"
PROJECT_FILE = "project.json"

def probe_fps(path):
    try:
        r = subprocess.run([find_tool("ffprobe"), "-v", "error", "-select_streams", "v:0",
                            "-show_entries", "stream=avg_frame_rate,r_frame_rate", "-of", "json", str(path)],
                           capture_output=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
        st = json.loads(r.stdout)["streams"][0]
        for key in ("avg_frame_rate", "r_frame_rate"):
            n, d = st.get(key, "0/0").split("/")
            if float(d):
                return int(round(max(15.0, min(60.0, float(n) / float(d)))))
    except Exception:
        pass
    return 30

def probe_has_audio(path):
    try:
        r = subprocess.run([find_tool("ffprobe"), "-v", "error", "-select_streams", "a",
                            "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
                           capture_output=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
        return bool(r.stdout.strip())
    except Exception:
        return True

def seg_total(segs):
    return sum(b - a for a, b in segs)

def src_to_out(t, segs):
    """Timp in sursa -> timp pe timeline-ul final. Bucatile pot fi in orice ordine (mutate de utilizator).
    Un timp dintr-o pauza taiata ajunge la inceputul bucatii care urmeaza in sursa."""
    acc, nxt, last = 0.0, None, None
    for a, b in segs:
        if a <= t <= b:
            return acc + (t - a)
        if a > t and (nxt is None or a < nxt[0]):
            nxt = (a, acc)
        if last is None or b > last[0]:
            last = (b, acc + (b - a))
        acc += b - a
    if nxt:
        return nxt[1]
    return last[1] if last else 0.0

def out_to_src(t, segs, end=False):
    """Timp pe timeline-ul final -> timp in sursa."""
    acc = 0.0
    for a, b in segs:
        d = b - a
        if (t < acc + d) or (end and t <= acc + d):
            return a + max(0.0, t - acc)
        acc += d
    return segs[-1][1] if segs else t

def _cue_runs(start, end, segs):
    """Portiunile unei fraze pe timeline-ul final: [out_a, out_b, [(src_a, src_b, out_a), ...]].
    Bucatile vecine pe timeline care merg inainte in sursa raman o singura portiune;
    o fraza taiata in doua de o bucata mutata devine doua portiuni."""
    runs, acc, prev = [], 0.0, None
    for i, (a, b) in enumerate(segs):
        x, y = max(a, start), min(b, end)
        if y - x > 1e-4:
            o = acc + (x - a)
            if runs and prev == i - 1 and x >= runs[-1][2][-1][1] - 1e-3:
                runs[-1][1] = o + (y - x)
                runs[-1][2].append((x, y, o))
            else:
                runs.append([o, o + (y - x), [(x, y, o)]])
            prev = i
        acc += b - a
    return runs

def _run_map(t, run):
    pieces = run[2]
    for x, y, o in pieces:
        if t < x:
            return o                       # in pauza dinaintea bucatii -> lipit de inceputul ei
        if t <= y:
            return o + (t - x)
    return run[1]

def captions_to_out(cap, segs):
    out = []
    for c in cap["cues"]:
        runs = _cue_runs(c["start"], c["end"], segs)
        if len(runs) > 1:                  # fraza rupta de o bucata mutata: cuvintele merg cu bucata lor
            runs.sort(key=lambda r: r[2][0][0])
        for k, run in enumerate(runs):
            lo = run[2][0][0]
            hi = runs[k + 1][2][0][0] if k + 1 < len(runs) else float("inf")
            words = []
            for w in c["words"]:
                if "s" in w and "e" in w:
                    mid = (w["s"] + w["e"]) / 2
                    if len(runs) > 1 and not (lo - 1e-3 <= mid < hi or (k == 0 and mid < lo)):
                        continue
                    w = dict(w)
                    w["s"], w["e"] = round(_run_map(w["s"], run), 3), round(_run_map(w["e"], run), 3)
                elif len(runs) > 1 and k:
                    continue
                words.append(w)
            s, e = run[0], run[1]
            if words and e - s >= 0.05:
                out.append({**c, "start": round(s, 3), "end": round(e, 3), "words": words})
    out.sort(key=lambda c: c["start"])
    return {"version": 1, "style": cap["style"], "cues": out}

def out_range_to_src(oa, ob, segs):
    """Un interval de pe timeline-ul final -> bucatile din sursa care il formeaza (in ordinea de pe timeline)."""
    out, acc = [], 0.0
    for a, b in segs:
        d = b - a
        x, y = max(oa, acc), min(ob, acc + d)
        if y - x > 0.02:
            out.append([round(a + x - acc, 3), round(a + y - acc, 3)])
        acc += d
    return out

def captions_from_out(cap_out, segs):
    cap = clean_captions(cap_out)
    for c in cap["cues"]:
        c["start"] = round(out_to_src(c["start"], segs), 3)
        c["end"] = round(out_to_src(c["end"], segs, end=True), 3)
        for w in c["words"]:
            if "s" in w and "e" in w:
                w["s"], w["e"] = round(out_to_src(w["s"], segs), 3), round(out_to_src(w["e"], segs, end=True), 3)
    return cap

def load_project(job_dir):
    return json.loads((Path(job_dir) / PROJECT_FILE).read_text(encoding="utf-8"))

def save_project(job_dir, project):
    (Path(job_dir) / PROJECT_FILE).write_text(json.dumps(project, ensure_ascii=False, indent=1), encoding="utf-8")

def project_source(job_dir, project):
    p = Path(project["source"])
    return p if p.is_absolute() else Path(job_dir) / p

def project_captions_out(job_dir):
    pr = load_project(job_dir)
    return captions_to_out(pr["captions"], pr["segments"])

def save_project_captions(job_dir, cap_out):
    pr = load_project(job_dir)
    pr["captions"] = captions_from_out(cap_out, pr["segments"])
    save_project(job_dir, pr)
    save_caption_files(job_dir, captions_to_out(pr["captions"], pr["segments"]))
    return pr

def save_caption_files(job_dir, cap):
    """Fisierele pentru tine (timp pe video-ul final): subtitrari.srt + transcript.txt."""
    job_dir = Path(job_dir)
    with open(job_dir / "subtitrari.srt", "w", encoding="utf-8") as f:
        for i, c in enumerate([c for c in cap["cues"] if not c.get("hidden")], 1):
            f.write(f"{i}\n{fmt_ts(c['start'])} --> {fmt_ts(c['end'])}\n{' '.join(w['t'] for w in c['words'])}\n\n")
    (job_dir / "transcript.txt").write_text(captions_text(cap), encoding="utf-8")


# ---- timeline (etapa 2)
ASSETS = "assets"
TEMPLATES = json.loads((APP_DIR / "remotion" / "src" / "templates.json").read_text(encoding="utf-8"))
TEMPLATE_BY_ID = {t["id"]: t for t in TEMPLATES}

def clean_graphic_props(tid, raw):
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    for f in TEMPLATE_BY_ID[tid]["fields"]:
        v = raw.get(f["k"], f["d"])
        if f["t"] == "bool":
            out[f["k"]] = bool(v)
        elif f["t"] == "color":
            out[f["k"]] = _hex(v, f["d"])
        else:
            out[f["k"]] = str(v)[:240]
    return out
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"}
ASSET_EXT = IMAGE_EXT | VIDEO_EXT | AUDIO_EXT

def clean_segments(raw, duration):
    """Bucatile pastrate, in ordinea de pe timeline (pot fi mutate), in interiorul sursei.
    Doua bucati nu pot folosi aceeasi portiune din sursa; daca se suprapun, revin la ordinea din sursa."""
    segs = []
    for x in (raw or [])[:2000]:
        try:
            a, b = float(x[0]), float(x[1])
        except (TypeError, ValueError, IndexError, KeyError):
            continue
        a, b = max(0.0, a), min(duration, b)
        if b - a >= 0.04:
            segs.append([a, b])
    srt = sorted(segs)
    if any(srt[i + 1][0] < srt[i][1] - 1e-3 for i in range(len(srt) - 1)):
        segs = srt
    out = []
    for a, b in segs:
        if out and out[-1][0] <= a <= out[-1][1] + 1e-3:      # lipite in sursa -> o singura bucata
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [[round(a, 3), round(b, 3)] for a, b in out]

def asset_info(path):
    path = Path(path)
    ext = path.suffix.lower()
    if ext in AUDIO_EXT:
        return {"asset": path.name, "type": "audio", "duration": round(probe_duration(path), 3)}
    kind = "image" if ext in IMAGE_EXT else "video"
    w, h = probe_size(path)
    info = {"asset": path.name, "type": kind, "width": w, "height": h}
    if kind == "video":
        info["duration"] = round(probe_duration(path), 3)
        info["has_audio"] = probe_has_audio(path)
    return info

def clean_overlays(raw, total, assets_dir):
    out, ar_cache = [], {}
    for o in (raw or [])[:200]:
        if not isinstance(o, dict):
            continue
        if o.get("type") == "slot":
            start = _num(o.get("start"), 0, total, 0)
            end = _num(o.get("end"), 0, total, min(total, start + 4))
            if end - start < 0.2:
                continue
            out.append({"id": str(o.get("id") or f"s{len(out)}")[:24], "type": "slot",
                        "start": round(start, 3), "end": round(end, 3), "lane": int(_num(o.get("lane"), 0, 20, 0)),
                        "idea": str(o.get("idea", ""))[:300], "prompt": str(o.get("prompt", ""))[:3000]})
            continue
        if o.get("type") == "graphic":
            tid = o.get("template")
            if tid not in TEMPLATE_BY_ID:
                continue
            t = TEMPLATE_BY_ID[tid]
            start = _num(o.get("start"), 0, total, 0)
            end = _num(o.get("end"), 0, total, min(total, start + t["dur"]))
            if end - start < 0.2:
                continue
            out.append({
                "id": str(o.get("id") or f"g{len(out)}")[:24], "type": "graphic", "template": tid,
                "props": clean_graphic_props(tid, o.get("props")),
                "start": round(start, 3), "end": round(end, 3),
                "x": round(_num(o.get("x"), -0.5, 1.5, t["x"]), 4), "y": round(_num(o.get("y"), -0.5, 1.5, t["y"]), 4),
                "w": round(_num(o.get("w"), 0.05, 3, t["w"]), 4), "opacity": round(_num(o.get("opacity"), 0, 1, 1), 3),
                "rotation": round(_num(o.get("rotation"), -360, 360, 0), 2),
                "lane": int(_num(o.get("lane"), 0, 20, 0)), "ar": t["ar"], **_motion(o, total),
            })
            continue
        name = Path(str(o.get("asset", ""))).name
        f = Path(assets_dir) / name
        if not name or not f.is_file() or f.suffix.lower() not in (IMAGE_EXT | VIDEO_EXT):
            continue
        if name not in ar_cache:
            w_, h_ = probe_size(f)
            ar_cache[name] = round(h_ / w_, 5) if w_ else 1.0
        kind = "image" if f.suffix.lower() in IMAGE_EXT else "video"
        start = _num(o.get("start"), 0, total, 0)
        end = _num(o.get("end"), 0, total, min(total, start + 3))
        if end - start < 0.1:
            continue
        out.append({
            "id": str(o.get("id") or f"o{len(out)}")[:24], "type": kind, "asset": name,
            "start": round(start, 3), "end": round(end, 3),
            "x": round(_num(o.get("x"), -0.5, 1.5, 0.5), 4), "y": round(_num(o.get("y"), -0.5, 1.5, 0.35), 4),
            "w": round(_num(o.get("w"), 0.02, 3, 0.6), 4), "opacity": round(_num(o.get("opacity"), 0, 1, 1), 3),
            "muted": bool(o.get("muted", True)), "source_start": round(_num(o.get("source_start"), 0, 1e6, 0), 3),
            "lane": int(_num(o.get("lane"), 0, 20, 0)),
            "rotation": round(_num(o.get("rotation"), -360, 360, 0), 2),
            "radius": round(_num(o.get("radius"), 0, 50, 0), 2),     # % din latura mai mica
            "ar": ar_cache[name],                                     # inaltime / latime
            # cover = umple tot cadrul (decupat); bg = fundal: umple cadrul IN SPATELE tau, iar tu apari intr-o fereastra (pip)
            "fit": o.get("fit") if o.get("fit") in ("cover", "bg") else "free",
            **({"pip": clean_pip(o.get("pip")), "bgimg": clean_bgimg(o.get("bgimg"))} if o.get("fit") == "bg" else {}),
            "prompt": str(o.get("prompt", ""))[:3000], "idea": str(o.get("idea", ""))[:300], **_motion(o, total),
        })
    return out

PIP_SHAPES = ("rect", "circle", "tall")
PIP_DEFAULT = {"shape": "rect", "w": 0.62, "x": 0.5, "y": 0.74}

def clean_pip(raw):
    """Fereastra in care apari tu cand o poza / un clip e fundal: forma, latimea (din latimea cadrului) si centrul."""
    raw = raw if isinstance(raw, dict) else {}
    return {"shape": raw.get("shape") if raw.get("shape") in PIP_SHAPES else PIP_DEFAULT["shape"],
            "w": round(_num(raw.get("w"), 0.2, 1.0, PIP_DEFAULT["w"]), 4),
            "x": round(_num(raw.get("x"), 0.0, 1.0, PIP_DEFAULT["x"]), 4),
            "y": round(_num(raw.get("y"), 0.0, 1.0, PIP_DEFAULT["y"]), 4)}

def clean_bgimg(raw):
    """Cum sta poza / clipul-fundal: intreaga (contain) sau umple ecranul (cover), marimea, pozitia pe verticala,
    plus culoarea din spate (unde poza nu ajunge)."""
    raw = raw if isinstance(raw, dict) else {}
    return {"fit": "cover" if raw.get("fit") == "cover" else "contain",
            "scale": round(_num(raw.get("scale"), 0.3, 2.0, 1.0), 3),
            "y": round(_num(raw.get("y"), 0.0, 1.0, 0.5), 4),
            "color": _hex(raw.get("color"), "#000000")}

def bg_rect(bgimg, ar, W, H):
    """Poza-fundal in pixeli: (x, y, latime, inaltime). ar = inaltime / latime. Aceleasi formule ca in timeline.js si Main.tsx."""
    ar = ar or 1.0
    w = (max if bgimg["fit"] == "cover" else min)(W, H / ar) * bgimg["scale"]
    h = w * ar
    return (W - w) / 2, bgimg["y"] * H - h / 2, w, h

def pip_rect(pip, W, H):
    """Fereastra in pixeli: (x, y, w, h, raza). Aceleasi formule ca in previzualizare (timeline.js) si Remotion (Main.tsx)."""
    ar = {"rect": 1.25, "circle": 1.0, "tall": H / W}[pip["shape"]]
    w = pip["w"] * W
    h = min(H, w * ar)
    w = h / ar
    x = min(max(0.0, pip["x"] * W - w / 2), W - w)
    y = min(max(0.0, pip["y"] * H - h / 2), H - h)
    r = min(w, h) / 2 if pip["shape"] == "circle" else min(w, h) * 0.06
    return x, y, w, h, r

def clean_audio(raw, total, assets_dir):
    """Pistele audio (muzica de fundal etc.), pe timpul final."""
    out = []
    for a in (raw or [])[:100]:
        if not isinstance(a, dict):
            continue
        name = Path(str(a.get("asset", ""))).name
        f = Path(assets_dir) / name
        if not name or not f.is_file() or f.suffix.lower() not in AUDIO_EXT:
            continue
        start = _num(a.get("start"), 0, total, 0)
        end = _num(a.get("end"), 0, total, total)
        if end - start < 0.1:
            continue
        out.append({
            "id": str(a.get("id") or f"a{len(out)}")[:24], "type": "audio", "asset": name,
            "start": round(start, 3), "end": round(end, 3),
            "source_start": round(_num(a.get("source_start"), 0, 1e6, 0), 3),
            "volume": round(_num(a.get("volume"), 0, 2, 0.3), 3),
            "fade_in": round(_num(a.get("fade_in"), 0, 10, 0.5), 2),
            "fade_out": round(_num(a.get("fade_out"), 0, 10, 1.5), 2),
            "lane": int(_num(a.get("lane"), 0, 10, 0)),
        })
    return out

def filmstrip(job_dir, project):
    """Miniaturi pentru pista principala: o singura imagine cu cadre la rand."""
    job_dir = Path(job_dir)
    src = project_source(job_dir, project)
    img, meta_f = job_dir / "_filmstrip.jpg", job_dir / "_filmstrip.json"
    if img.exists() and meta_f.exists() and img.stat().st_mtime >= src.stat().st_mtime:
        return json.loads(meta_f.read_text(encoding="utf-8"))
    dur = max(0.5, float(project.get("source_duration") or probe_duration(src)))
    rate = min(2.0, 240.0 / dur)
    th = 56
    tw = max(16, int(round(th * project["width"] / project["height"] / 2)) * 2)
    count = int(dur * rate) + 1
    r = subprocess.run([find_tool("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
                        "-vf", f"fps={rate:.5f},scale={tw}:{th},tile={count}x1", "-frames:v", "1", "-q:v", "6", str(img)],
                       capture_output=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
    if r.returncode != 0 or not img.exists():
        raise RuntimeError("Nu am putut face miniaturile. " + (r.stderr or "")[-300:])
    meta = {"rate": rate, "tile_w": tw, "tile_h": th, "count": count}
    meta_f.write_text(json.dumps(meta), encoding="utf-8")
    return meta

def waveform(job_dir, project):
    """Forma sunetului: varful volumului la fiecare 10 ms, 0-255."""
    job_dir = Path(job_dir)
    src = project_source(job_dir, project)
    f = job_dir / "_waveform.json"
    if f.exists() and f.stat().st_mtime >= src.stat().st_mtime:
        return json.loads(f.read_text(encoding="utf-8"))
    data = {"rate": 100, "peaks": []}
    if probe_has_audio(src):
        import numpy as np
        r = subprocess.run([find_tool("ffmpeg"), "-v", "error", "-i", str(src), "-ac", "1", "-ar", "8000",
                            "-f", "s16le", "-"], capture_output=True, creationflags=NO_WINDOW)
        pcm = np.frombuffer(r.stdout, dtype=np.int16)
        n = len(pcm) // 80
        if n:
            peaks = np.abs(pcm[: n * 80].astype(np.int32)).reshape(n, 80).max(axis=1)
            top = max(1, int(np.percentile(peaks, 99.5)))
            data["peaks"] = np.clip(peaks * 255 // top, 0, 255).astype(int).tolist()
    f.write_text(json.dumps(data), encoding="utf-8")
    return data

def apply_timeline(job_dir, payload, report):
    """Salveaza taieturile si suprapunerile editate, apoi reface copia taiata."""
    job_dir = Path(job_dir)
    pr = load_project(job_dir)
    src = project_source(job_dir, pr)
    dur = float(pr.get("source_duration") or probe_duration(src))
    segs = clean_segments(payload.get("segments"), dur)
    if not segs:
        raise RuntimeError("Timeline-ul nu mai are nicio bucată video.")
    pr["segments"] = segs
    pr["overlays"] = clean_overlays(payload.get("overlays"), seg_total(segs), job_dir / ASSETS)
    if pr.get("materials_pending"):                     # materialele puse intre timp nu mai sunt „de pus”
        pr["materials_pending"] = [a for a in pr["materials_pending"] if not any(o.get("asset") == a for o in pr["overlays"])]
    pr["audio"] = clean_audio(payload.get("audio"), seg_total(segs), job_dir / ASSETS)
    if isinstance(payload.get("zooms"), list):
        pr["zooms"] = clean_zooms(payload["zooms"], seg_total(segs))
    if isinstance(payload.get("transitions"), dict):
        pr["transitions"] = clean_trans(payload["transitions"])
    if isinstance(payload.get("look"), dict):
        pr["look"] = clean_look(payload["look"])
    if isinstance(payload.get("caption_style"), dict) and pr.get("captions"):
        pr["captions"]["style"] = clean_style(payload["caption_style"])
    if isinstance(payload.get("caption_cues"), list) and pr.get("captions"):
        pr["captions"]["cues"] = clean_captions({"style": pr["captions"]["style"], "cues": payload["caption_cues"]})["cues"]
    save_project(job_dir, pr)
    report({"type": "stage", "n": 1})
    snd = processed_audio(job_dir, pr)
    render_proxy(src, segs, job_dir / "video_taiat.mp4", report, audio_src=snd)
    try:
        preview_audio_sync(job_dir, pr)
    except Exception:
        pass
    report({"type": "cut_done", "from": round(dur, 1), "to": round(seg_total(segs), 1)})
    if pr.get("captions", {}).get("cues"):
        save_caption_files(job_dir, captions_to_out(pr["captions"], segs))
    return pr


# ---- pasul 1: gasesc pauzele (fara sa tai inca) + fac o copie taiata pentru previzualizare
def analyze_segments(src, job_dir, cfg, report):
    thr = CUT_PRESETS[cfg["cut"]]
    a, b = cfg["margin"], cfg["margin_after"]
    margin = f"{a}s" if b is None or b == a else f"{a}s,{b}s"
    tl = Path(job_dir) / "_taieturi.v3"
    cmd = [find_tool("auto-editor"), str(src), "--edit", f"audio:threshold={thr}",
           "--margin", margin, "--export", "v3", "--no-open", "-o", str(tl)]
    report({"type": "log", "msg": f"Caut pauzele (prag {thr}, {margin_label(cfg)} înainte/după frază)..."})
    report({"type": "stage_detail", "n": 1, "detail": "Caut pauzele…"})
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=NO_WINDOW)
    tail, last = "", -1.0
    while True:
        chunk = p.stdout.read1(4096) if hasattr(p.stdout, "read1") else p.stdout.read(4096)
        if not chunk:
            break
        text = ANSI.sub("", chunk.decode("utf-8", "replace"))
        tail = (tail + text)[-3000:]
        found = re.findall(r"(\d{1,3}(?:\.\d+)?)%", text)
        if found:
            v = min(100.0, float(found[-1])) * 0.3          # analiza = primele 30% din pasul 1
            if v - last >= 1:
                last = v
                report({"type": "progress", "value": round(v, 1)})
    rc = p.wait()
    if rc != 0 or not tl.exists():
        clean = " ".join(l.strip() for l in tail.splitlines() if l.strip())[-500:]
        raise RuntimeError(f"Tăierea a eșuat. {clean}")
    data = json.loads(tl.read_text(encoding="utf-8"))
    tl.unlink(missing_ok=True)
    num, den = (data.get("timebase", "30/1").split("/") + ["1"])[:2]
    tb = float(num) / float(den or 1)
    segs = []
    for clip in (data.get("v") or [[]])[0]:
        s0 = clip["offset"] / tb
        s1 = (clip["offset"] + clip["dur"] * clip.get("speed", 1)) / tb
        if segs and s0 - segs[-1][1] < 1e-3:
            segs[-1][1] = s1
        else:
            segs.append([s0, s1])
    segs = [[round(a, 3), round(b, 3)] for a, b in segs if b - a > 0.01]
    if not segs:
        raise RuntimeError("Tăierea a eșuat. Nu am găsit nicio porțiune cu vorbă.")
    return segs

def _ffmpeg_complex(src, fc, maps, dst, venc, duration, report, scale, extra_inputs=(), cwd=None):
    base = [find_tool("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error"] + (["-i", str(src)] if src is not None else [])
    for args in extra_inputs:
        base += list(args)
    tail = [*maps, *venc, "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            "-progress", "pipe:1", "-nostats", str(dst)]
    script = None
    if len(fc) > 20000:                        # linia de comanda pe Windows e limitata
        script = Path(dst).with_suffix(".filtre.txt")
        script.write_text(fc, encoding="utf-8")
        attempts = [base + ["-/filter_complex", str(script)] + tail,
                    base + ["-filter_complex_script", str(script)] + tail]
    else:
        attempts = [base + ["-filter_complex", fc] + tail]
    err = ""
    try:
        for cmd in attempts:
            p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
            last = -1.0
            for line in p.stdout:
                if line.startswith(("out_time_us=", "out_time_ms=")):
                    try:
                        t = int(line.split("=", 1)[1]) / 1e6
                    except ValueError:
                        continue
                    v = scale[0] + (scale[1] - scale[0]) * min(0.99, t / duration)
                    if v - last >= 1:
                        last = v
                        report({"type": "progress", "value": round(v, 1)})
            err = p.stderr.read()
            if p.wait() == 0 and Path(dst).exists():
                return 0, ""
        return 1, err
    finally:
        if script:
            script.unlink(missing_ok=True)

def _source_runs(segs):
    """Bucatile, grupate in „runde” care merg inainte in sursa (o runda noua unde o bucata mutata sare inapoi)."""
    runs = []
    for a, b in segs:
        if runs and a >= runs[-1][-1][1] - 1e-3:
            runs[-1].append((a, b))
        else:
            runs.append([(a, b)])
    return runs

def render_proxy(src, segs, dst, report, n=1, scale=(30, 100), audio_src=None):
    """Copia taiata, pentru previzualizare si pentru motorul clasic. audio_src = sunetul curatat (acelasi timp ca sursa).
    Imaginea se citeste o singura data, pe curgere (select pe numarul cadrului), ca memoria sa nu creasca odata cu
    lungimea video-ului (cu trim pe fiecare bucata, un video de 10 minute umplea peste 13 GB). Bucatile mutate
    (alta ordine decat in sursa) se impart in runde; fiecare runda are intrarea ei, cu salt direct la inceputul ei.
    Sunetul se taie exact pe aceleasi granite de cadre, deci imaginea si vocea raman sincron."""
    audio = bool(audio_src) or probe_has_audio(src)
    fps = probe_fps(src)
    runs = _source_runs(segs)
    inputs, parts, labels, k = [], [], "", 0
    for r, run in enumerate(runs):
        r0 = max(0.0, run[0][0] - 1.0)
        seek = ["-ss", f"{r0:.3f}", "-t", f"{run[-1][1] + 1.0 - r0:.3f}"]
        inputs.append(seek + ["-i", str(src)])
        vi = ai = k
        k += 1
        if audio_src:
            inputs.append(seek + ["-i", str(audio_src)])
            ai = k
            k += 1
        fr = [(int(round((a - r0) * fps)), int(round((b - r0) * fps))) for a, b in run]
        fr = [(x, y) for x, y in fr if y > x] or [(fr[0][0], fr[0][0] + 1)]
        sel = "+".join(f"between(n\\,{x}\\,{y - 1})" for x, y in fr)
        parts.append(f"[{vi}:v]fps={fps},select={sel},setpts=N/FRAME_RATE/TB[v{r}]")
        labels += f"[v{r}]"
        if audio:
            al = ""
            for i, (x, y) in enumerate(fr):
                parts.append(f"[{ai}:a]atrim=start={x / fps:.5f}:end={y / fps:.5f},asetpts=PTS-STARTPTS[a{r}_{i}]")
                al += f"[a{r}_{i}]"
            parts.append(f"{al}concat=n={len(fr)}:v=0:a=1[a{r}]" if len(fr) > 1 else f"{al}anull[a{r}]")
            labels += f"[a{r}]"
    parts.append(f"{labels}concat=n={len(runs)}:v=1:a={1 if audio else 0}[v]" + ("[a]" if audio else ""))
    maps = ["-map", "[v]"] + (["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] if audio else [])
    duration = seg_total(segs) or 1.0
    encoders = []
    if gpu_name():
        encoders.append(("placa video (NVENC)", ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "20", "-b:v", "0", "-g", "30"]))
    encoders.append(("procesor", ["-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-g", "30"]))
    err = ""
    for where, venc in encoders:
        report({"type": "stage_detail", "n": n, "detail": f"Lipesc bucățile · {where.split(' (')[0]}"})
        rc, err = _ffmpeg_complex(None, ";".join(parts), maps, dst, venc, duration, report, scale, extra_inputs=inputs)
        if rc == 0:
            return
        report({"type": "log", "msg": f"Lipirea pe {where} n-a mers, încerc altfel."})
    raise RuntimeError(f"Tăierea a eșuat la lipirea bucăților. {(err or '').strip()[-400:]}")


# ---- miscare: zoom pe video, keyframes pe elemente, tranzitii la taieturi
ZOOM_STYLES = ("punch", "smooth", "creep")
TRANSITIONS = ("none", "dissolve", "fade", "flash", "zoom", "blur")
ANIM_IN = ("none", "fade", "slide_up", "slide_down", "slide_left", "slide_right", "pop")

def clean_zooms(raw, total):
    out = []
    for z in (raw if isinstance(raw, list) else [])[:200]:
        if not isinstance(z, dict):
            continue
        a = _num(z.get("start"), 0, total, 0)
        b = _num(z.get("end"), 0, total, min(total, a + 1.5))
        if b - a < 0.15:
            continue
        out.append({"id": str(z.get("id") or f"z{len(out)}")[:24],
                    "start": round(a, 3), "end": round(b, 3),
                    "scale": round(_num(z.get("scale"), 1.0, 2.0, 1.2), 3),
                    "x": round(_num(z.get("x"), 0, 1, 0.5), 4), "y": round(_num(z.get("y"), 0, 1, 0.42), 4),
                    "style": z.get("style") if z.get("style") in ZOOM_STYLES else "smooth"})
    out.sort(key=lambda z: z["start"])
    return out

def clean_keys(raw, dur):
    """Keyframes pe un element: [{t, x, y, w, opacity, rotation}], t = secunde de la inceputul lui."""
    out = []
    for k in (raw if isinstance(raw, list) else [])[:60]:
        if not isinstance(k, dict):
            continue
        kf = {"t": round(_num(k.get("t"), 0, max(0.01, dur), 0), 3)}
        for f, lo, hi in (("x", -0.5, 1.5), ("y", -0.5, 1.5), ("w", 0.02, 3), ("opacity", 0, 1), ("rotation", -360, 360)):
            if k.get(f) is not None:
                kf[f] = round(_num(k.get(f), lo, hi, 0), 4)
        if len(kf) > 1:
            out.append(kf)
    out.sort(key=lambda k: k["t"])
    return out

def clean_trans(raw):
    out = {}
    for key, v in (raw if isinstance(raw, dict) else {}).items():
        if not isinstance(v, dict):
            continue
        kind = v.get("kind") if v.get("kind") in TRANSITIONS else "none"
        if kind == "none":
            continue
        try:
            idx = int(key)
        except (TypeError, ValueError):
            continue
        out[str(idx)] = {"kind": kind, "dur": round(_num(v.get("dur"), 0.1, 2.0, 0.4), 3)}
    return out

def _motion(o, total):
    """keys + animatii de intrare/iesire, curatate, pentru un element."""
    dur = max(0.01, _num(o.get("end"), 0, total, 1) - _num(o.get("start"), 0, total, 0))
    keys = clean_keys(o.get("keys"), dur)
    out = {"keys": keys} if keys else {}
    for k in ("anim_in", "anim_out"):
        if o.get(k) in ANIM_IN and o.get(k) != "none":
            out[k] = o[k]
    if out:
        out["anim_dur"] = round(_num(o.get("anim_dur"), 0.1, 2.0, 0.35), 3)
    return out


# ---- look-ul: culoare + sunet, la fel pe toate video-urile
LOOK_FILE = APP_DIR / "look_implicit.json"
COLOR_PRESETS = {
    "original":  {"brightness": 0, "contrast": 1, "saturation": 1, "temperature": 0, "tint": 0},
    "natural":   {"brightness": 0.02, "contrast": 1.06, "saturation": 1.05, "temperature": 0.05, "tint": 0},
    "cald":      {"brightness": 0.02, "contrast": 1.05, "saturation": 1.08, "temperature": 0.35, "tint": 0.05},
    "luminos":   {"brightness": 0.07, "contrast": 0.97, "saturation": 1.04, "temperature": 0.08, "tint": 0},
    "cinematic": {"brightness": -0.03, "contrast": 1.14, "saturation": 0.88, "temperature": -0.12, "tint": 0.04},
    "albnegru":  {"brightness": 0.01, "contrast": 1.12, "saturation": 0, "temperature": 0, "tint": 0},
}
DEFAULT_LOOK = {"color": {"preset": "original", **COLOR_PRESETS["original"]},
                "audio": {"denoise": "off", "clear": False, "loudness": False}}

def clean_look(raw):
    raw = raw if isinstance(raw, dict) else {}
    c, a = raw.get("color") or {}, raw.get("audio") or {}
    color = {"preset": c.get("preset") if c.get("preset") in COLOR_PRESETS or c.get("preset") == "custom" else "original",
             "brightness": round(_num(c.get("brightness"), -0.4, 0.4, 0), 3), "contrast": round(_num(c.get("contrast"), 0.5, 1.6, 1), 3),
             "saturation": round(_num(c.get("saturation"), 0, 2, 1), 3), "temperature": round(_num(c.get("temperature"), -1, 1, 0), 3),
             "tint": round(_num(c.get("tint"), -1, 1, 0), 3)}
    audio = {"denoise": a.get("denoise") if a.get("denoise") in ("off", "usor", "mediu", "puternic") else "off",
             "clear": bool(a.get("clear")), "loudness": bool(a.get("loudness"))}
    return {"color": color, "audio": audio}

def load_default_look():
    try:
        return clean_look(json.loads(LOOK_FILE.read_text(encoding="utf-8")))
    except Exception:
        return json.loads(json.dumps(DEFAULT_LOOK))

def save_default_look(look):
    lk = clean_look(look)
    LOOK_FILE.write_text(json.dumps(lk, ensure_ascii=False, indent=1), encoding="utf-8")
    return lk

def color_neutral(c):
    return abs(c["brightness"]) < 1e-3 and abs(c["contrast"] - 1) < 1e-3 and abs(c["saturation"] - 1) < 1e-3 \
        and abs(c["temperature"]) < 1e-3 and abs(c["tint"]) < 1e-3

def color_matrix(c):
    """Matricea 4x5 (ca feColorMatrix): temperatura/nuanta -> saturatie -> contrast -> luminozitate.
    ACEEASI formula e in timeline.js (previzualizare), deci ce vezi e ce iese."""
    t, g = c["temperature"], c["tint"]
    gains = [1 + 0.10 * t + 0.03 * g, 1 + 0.02 * t - 0.07 * g, 1 - 0.12 * t + 0.03 * g]
    s_, lr, lg, lb = c["saturation"], 0.2126, 0.7152, 0.0722
    sat = [[lr + (1 - lr) * s_, lg - lg * s_, lb - lb * s_],
           [lr - lr * s_, lg + (1 - lg) * s_, lb - lb * s_],
           [lr - lr * s_, lg - lg * s_, lb + (1 - lb) * s_]]
    k, off = c["contrast"], 0.5 * (1 - c["contrast"]) + c["brightness"]
    m = [[k * sat[r][j] * gains[j] for j in range(3)] for r in range(3)]
    return [[round(m[r][0], 5), round(m[r][1], 5), round(m[r][2], 5), 0, round(off, 5)] for r in range(3)] + [[0, 0, 0, 1, 0]]

def ffmpeg_color(c):
    """Acelasi look pentru motorul clasic: amestec de canale + deplasare."""
    m = color_matrix(c)
    mix = "colorchannelmixer=" + ":".join(f"{ch}{src}={m[i][j]}" for i, ch in enumerate("rgb") for j, src in enumerate("rgb"))
    o = round(m[0][4] * 255, 2)
    return mix + (f",lutrgb=r='clip(val+{o},0,255)':g='clip(val+{o},0,255)':b='clip(val+{o},0,255)'" if abs(o) > 0.01 else "")

def audio_chain(a):
    """Reducere zgomot -> voce clara -> poarta discreta (coboara fasaitul din pauzele scurte) -> volum uniform.
    Reteta aleasa din masuratori: la „puternic”, raportul voce/zgomot urca de la ~17 la ~30 dB."""
    f = []
    d = a["denoise"]
    if d == "usor":
        f.append("afftdn=nr=12:nf=-50:tn=1")
    elif d == "mediu":
        f.append("afftdn=nr=18:nf=-48:tn=1")
    elif d == "puternic":
        f += ["afftdn=nr=20:nf=-48:tn=1", "afftdn=nr=12:nf=-50:tn=1"]
    if a["clear"]:
        f += ["highpass=f=80", "equalizer=f=250:t=q:w=1:g=-2", "equalizer=f=3500:t=q:w=1.2:g=3",
              "acompressor=threshold=0.1:ratio=3:attack=8:release=160:makeup=2"]
    if d != "off":
        f.append(f"agate=threshold=0.015:ratio=4:range={ {'usor': 0.25, 'mediu': 0.1, 'puternic': 0.06}[d] }:attack=5:release=250")
    if a["loudness"]:
        f.append("loudnorm=I=-14:TP=-1.5:LRA=11")
    return ",".join(f)

def processed_audio(job_dir, project):
    """Sunetul curatat al sursei (acelasi timp ca sursa). None daca nu e nimic de facut."""
    job_dir = Path(job_dir)
    look = clean_look(project.get("look"))
    chain = audio_chain(look["audio"])
    src = project_source(job_dir, project)
    if not chain or not probe_has_audio(src):
        return None
    import hashlib
    out = job_dir / f"_sunet_{hashlib.md5(chain.encode()).hexdigest()[:8]}.m4a"
    if out.exists() and out.stat().st_size > 1000 and out.stat().st_mtime >= src.stat().st_mtime:
        return out
    tmp = out.with_suffix(".tmp.m4a")
    r = subprocess.run([find_tool("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-vn", "-af", chain,
                        "-ar", "48000", "-c:a", "aac", "-b:a", "192k", str(tmp)],
                       capture_output=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
    if r.returncode != 0 or not tmp.exists():
        raise RuntimeError("Procesarea sunetului a eșuat. " + (r.stderr or "")[-300:])
    tmp.replace(out)
    for old in job_dir.glob("_sunet_*.m4a"):
        if old != out:
            old.unlink(missing_ok=True)
    return out

def preview_audio_sync(job_dir, project):
    """Pune in copia de previzualizare sunetul curent (curatat sau original), fara sa recodeze imaginea."""
    job_dir = Path(job_dir)
    pv = job_dir / PREVIEW_FILE
    if not pv.exists():
        return make_preview(job_dir, project)
    snd = processed_audio(job_dir, project)
    src = project_source(job_dir, project)
    tmp = pv.with_suffix(".tmp.mp4")
    audio_in = str(snd) if snd else str(src)
    if not snd and not probe_has_audio(src):
        return pv
    r = subprocess.run([find_tool("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error", "-i", str(pv), "-i", audio_in,
                        "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest",
                        "-movflags", "+faststart", str(tmp)],
                       capture_output=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
    if r.returncode == 0 and tmp.exists():
        tmp.replace(pv)
    return pv


# ---- copia usoara pentru previzualizarea din Timeline („proxy”, ca in editoarele profesioniste)
PREVIEW_FILE = "_previzualizare.mp4"

def make_preview(job_dir, project, report=None):
    """720p, cadru-cheie la fiecare ~0,5 s: salturi instant la taieturi si mult mai putin de decodat.
    Timpii raman identici cu sursa; video-ul final se randeaza tot din sursa la rezolutie completa."""
    job_dir = Path(job_dir)
    src = project_source(job_dir, project)
    out = job_dir / PREVIEW_FILE
    if out.exists() and out.stat().st_mtime >= src.stat().st_mtime and out.stat().st_size > 1000:
        return out
    try:
        snd = processed_audio(job_dir, project)
    except Exception:
        snd = None
    fps = probe_fps(src)
    g = str(max(2, round(fps / 2)))
    audio = bool(snd) or probe_has_audio(src)
    base = [find_tool("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error", "-i", str(src)] + \
           (["-i", str(snd), "-map", "0:v", "-map", "1:a"] if snd else []) + ["-vf", "scale='min(720,iw)':-2", "-pix_fmt", "yuv420p"]
    tail = (["-c:a", "aac", "-b:a", "128k"] if audio else ["-an"]) + ["-movflags", "+faststart", str(out.with_suffix(".tmp.mp4"))]
    encoders = []
    if gpu_name():
        encoders.append(["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "27", "-b:v", "0", "-g", g, "-bf", "0"])
    encoders.append(["-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-g", g, "-keyint_min", g, "-sc_threshold", "0"])
    if report:
        report({"type": "log", "msg": "Pregătesc o copie ușoară pentru previzualizarea din Timeline (o singură dată)..."})
    for venc in encoders:
        r = subprocess.run(base + venc + tail, capture_output=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
        tmp = out.with_suffix(".tmp.mp4")
        if r.returncode == 0 and tmp.exists():
            tmp.replace(out)
            return out
    return None


# ---- pasul 3: randarea finala
def remotion_status():
    if not shutil.which("node"):
        return {"ok": False, "label": "Motor clasic",
                "hint": "Pentru motorul Remotion rulează „instaleaza_remotion.bat”. Până atunci merge motorul clasic."}
    if not (REMOTION_DIR / "node_modules" / "@remotion" / "renderer").exists():
        return {"ok": False, "label": "Motor clasic",
                "hint": "Remotion nu e instalat încă. Rulează „instaleaza_remotion.bat”."}
    return {"ok": True, "label": "Motor Remotion"}

def remotion_props(job_dir, project, source_url, with_captions=True, asset_url=None, cap_out=None):
    """cap_out = subtitrarile deja pe timpul final (pentru variantele de carlig, unde o bucata apare de doua ori)."""
    segs = project["segments"]
    overlays = []
    for o in sorted(project.get("overlays", []), key=lambda o: o.get("lane", 0)):
        if o.get("type") == "slot":
            continue
        if o.get("type") == "graphic":
            overlays.append(o)
        elif asset_url and (Path(job_dir) / ASSETS / o["asset"]).is_file():
            overlays.append({**o, "src": f"{asset_url}/{urllib_quote(o['asset'])}"})
    return {
        "width": project["width"], "height": project["height"], "fps": project["fps"],
        "source": source_url,
        "segments": [{"from": a, "to": b} for a, b in segs],
        "captions": (cap_out or captions_to_out(project["captions"], segs)) if with_captions and project.get("captions") else None,
        "fonts": [{"id": f["id"], "ratio": f["ratio"], "files": f["files"]} for f in FONTS],
        "overlays": overlays,
        "grade": None if color_neutral(clean_look(project.get("look"))["color"]) else sum(color_matrix(clean_look(project.get("look"))["color"]), []),
        "zooms": clean_zooms(project.get("zooms"), seg_total(segs)),
        "transitions": clean_trans(project.get("transitions")),
        "main_audio": (f"{asset_url.rsplit('/asset/', 1)[0]}/media/{asset_url.rsplit('/', 1)[1]}/sound"
                       if asset_url and processed_audio(job_dir, project) else None),
        "audio": [{**a, "src": f"{asset_url}/{urllib_quote(a['asset'])}"} for a in project.get("audio", [])
                  if asset_url and (Path(job_dir) / ASSETS / a["asset"]).is_file()],
    }

def render_remotion(job_dir, project, dst, source_url, report, asset_url=None, captions=True, cap_out=None):
    job_dir = Path(job_dir)
    props = job_dir / "_props.json"
    props.write_text(json.dumps(remotion_props(job_dir, project, source_url, with_captions=captions, asset_url=asset_url,
                                               cap_out=cap_out),
                                ensure_ascii=False), encoding="utf-8")
    report({"type": "stage_detail", "n": 3, "detail": "Randez cu Remotion"})
    report({"type": "progress", "value": None})
    p = subprocess.Popen([shutil.which("node"), str(REMOTION_DIR / "render.mjs"), str(props.resolve()), str(Path(dst).resolve())],
                         cwd=str(REMOTION_DIR), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
    error, tail = None, []
    try:
        for line in p.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except ValueError:
                tail = (tail + [line])[-15:]
                continue
            if ev.get("type") == "progress":
                report({"type": "progress", "value": ev["value"]})
            elif ev.get("type") == "log":
                report({"type": "log", "msg": ev["msg"]})
            elif ev.get("type") == "error":
                error = ev.get("msg", "")
        rc = p.wait()
    finally:
        props.unlink(missing_ok=True)
    if rc != 0 or not Path(dst).exists():
        first = next((l.strip() for l in (error or "\n".join(tail)).splitlines() if l.strip()), "eroare necunoscută")
        raise RuntimeError(f"Remotion n-a mers ({first[:200]})")

def _round_mask(path, w, h, radius_pct):
    """Masca alb-negru cu colturi rotunjite (o singura imagine, facuta o data)."""
    r = max(1, int(min(w, h) * radius_pct / 100))
    expr = (f"255*lte(hypot(max(0,max({r}-X,X-({w}-1-{r}))),max(0,max({r}-Y,Y-({h}-1-{r})))),{r})")
    subprocess.run([find_tool("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
                    "-i", f"color=c=black:s={w}x{h}", "-vf", f"format=gray,geq=lum='{expr}'", "-frames:v", "1", str(path)],
                   capture_output=True, creationflags=NO_WINDOW, check=True)

def burn_classic(job_dir, project, dst, report, captions=True, cut=None, cap_out=None):
    """Motorul clasic: copia taiata + suprapuneri + piste audio (ffmpeg) + subtitrari (libass).
    cut / cap_out: alta copie taiata si subtitrarile ei (pentru variantele de carlig)."""
    job_dir = Path(job_dir)
    cut = Path(cut) if cut else job_dir / "video_taiat.mp4"
    W, H = probe_size(cut)
    total = probe_duration(cut) or seg_total(project["segments"]) or 1.0
    if not (project.get("captions") and captions):
        cap = {"cues": []}
    else:
        cap = cap_out or captions_to_out(project["captions"], project["segments"])
    ass = job_dir / "subs.ass"
    has_caps = bool(cap["cues"])
    if has_caps:
        write_ass_captions(cap, ass, W, H)
    cards, card_temps = [], []
    for k, c in enumerate(project.get("title_cards") or []):     # textul mare al unei variante de carlig
        f, tmp = _card_filter(c.get("title", ""), c.get("subtitle", ""), W, H, c.get("y", 0.3), job_dir, f"c{k}",
                              (c["start"], c["end"]))
        cards.append(f); card_temps += tmp
    n_gfx = sum(1 for o in project.get("overlays", []) if o.get("type") == "graphic" and not o.get("_card"))
    if n_gfx:
        report({"type": "log", "msg": f"Atenție: {n_gfx} grafice animate nu apar în video — ele au nevoie de motorul Remotion "
                                      "(rulează „instaleaza_remotion.bat”)."})
    # fundalurile („tu peste el”) primele: peste ele vin celelalte suprapuneri
    ovs = [o for o in sorted(project.get("overlays", []), key=lambda o: (o.get("fit") != "bg", o.get("lane", 0)))
           if o.get("type") in ("image", "video") and (job_dir / ASSETS / o["asset"]).is_file()]
    auds = [a for a in project.get("audio", []) if (job_dir / ASSETS / a["asset"]).is_file()]
    temps = list(card_temps)
    report({"type": "stage_detail", "n": 3, "detail": "Motor clasic"})
    try:
        col = clean_look(project.get("look"))["color"]
        grade = None if color_neutral(col) else ffmpeg_color(col)
        n_move = len(clean_zooms(project.get("zooms"), total)) + len(clean_trans(project.get("transitions"))) + \
            sum(1 for o in project.get("overlays", []) if o.get("keys") or o.get("anim_in") or o.get("anim_out"))
        if n_move:
            report({"type": "log", "msg": f"Atenție: zoom-ul, tranzițiile și animațiile ({n_move}) merg doar cu motorul Remotion — "
                                          "le-am sărit. Instalează-l cu instaleaza_remotion.bat."})
        if not ovs and not auds and not grade and not cards:
            if not has_caps:
                shutil.copyfile(cut, dst); return
            burn(cut, ass, dst, report); return
        inputs, parts, audio = [], [f"[0:v]{grade}[b0]" if grade else "[0:v]null[b0]"], []
        cut_audio = probe_has_audio(cut)
        k = 0
        for n, o in enumerate(ovs, 1):
            k += 1
            f = str((job_dir / ASSETS / o["asset"]).resolve())
            S, E = o["start"], o["end"]
            bg = o.get("fit") == "bg"
            cover = o.get("fit") in ("cover", "bg")
            wpx = W if cover else max(2, int(W * o["w"] / 2) * 2)
            hpx = H if cover else max(2, int(wpx * o.get("ar", 1) / 2) * 2)
            fitf = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}" if cover else f"scale={wpx}:{hpx}"
            if bg:                                      # fundalul: poza intreaga sau decupata, cu marimea si pozitia ei
                bx, by, bw, bh = bg_rect(clean_bgimg(o.get("bgimg")), o.get("ar", 1), W, H)
                bw, bh = max(2, int(bw / 2) * 2), max(2, int(bh / 2) * 2)
                fitf = f"scale={bw}:{bh}"
            if cover:
                o = {**o, "x": 0.5, "y": 0.5, "rotation": 0}
            if o["type"] == "image":
                inputs.append(["-loop", "1", "-t", f"{total:.3f}", "-i", f])
                chain = f"[{k}:v]{fitf},format=rgba"
            else:
                inputs.append(["-i", f])
                ss = o.get("source_start", 0)
                chain = (f"[{k}:v]trim=start={ss:.3f}:duration={E - S:.3f},setpts=PTS-STARTPTS+{S:.3f}/TB,"
                         f"{fitf},format=rgba")
                if not o.get("muted", True) and probe_has_audio(f):
                    d = int(S * 1000)
                    parts.append(f"[{k}:a]atrim=start={ss:.3f}:duration={E - S:.3f},asetpts=PTS-STARTPTS,"
                                 f"adelay={d}:all=1[a{k}]")
                    audio.append(f"[a{k}]")
            if o.get("radius", 0) > 0 and not cover:
                mask = job_dir / f"_masca{n}.png"
                _round_mask(mask, wpx, hpx, o["radius"])
                temps.append(mask)
                parts.append(chain + f"[r{k}]")
                k += 1
                inputs.append(["-loop", "1", "-t", f"{total:.3f}", "-i", str(mask.resolve())])
                parts.append(f"[{k}:v]format=gray[m{k}]")
                chain = f"[r{k - 1}][m{k}]alphamerge"
            if o.get("opacity", 1) < 1:
                chain += f",colorchannelmixer=aa={o['opacity']:.3f}"
            if o.get("rotation", 0):
                rad = o["rotation"] * 3.141592653589793 / 180
                chain += f",rotate={rad:.5f}:ow=rotw({rad:.5f}):oh=roth({rad:.5f}):c=none"
            parts.append(chain + f"[o{n}]")
            en = f"enable='between(t,{S:.3f},{E:.3f})'"
            if bg:
                # tu, intr-o fereastra (decupata din cadrul tau, cu centrul putin spre fata), peste fundal
                px, py, pw, ph, pr = pip_rect(clean_pip(o.get("pip")), W, H)
                ww, wh = max(2, int(pw / 2) * 2), max(2, int(ph / 2) * 2)
                ar = wh / ww
                cw, ch = (W, W * ar) if W * ar <= H else (H / ar, H)
                parts.append(f"[b{n - 1}]split[bk{n}][bw{n}]")
                parts.append(f"[bw{n}]crop={int(cw)}:{int(ch)}:(iw-ow)/2:(ih-oh)*0.3,scale={ww}:{wh},format=rgba[wr{n}]")
                mask = job_dir / f"_fereastra{n}.png"
                _round_mask(mask, ww, wh, 50 if pr >= min(ww, wh) / 2 - 1 else 6)
                temps.append(mask)
                k += 1
                inputs.append(["-loop", "1", "-t", f"{total:.3f}", "-i", str(mask.resolve())])
                parts.append(f"[{k}:v]format=gray[wm{n}m]")
                parts.append(f"[wr{n}][wm{n}m]alphamerge[wm{n}]")
                col = clean_bgimg(o.get("bgimg"))["color"].lstrip("#")
                parts.append(f"[bk{n}]drawbox=x=0:y=0:w=iw:h=ih:color=0x{col}@1:t=fill:{en}[bf{n}]")
                parts.append(f"[bf{n}][o{n}]overlay={int(bx)}:{int(by)}:{en}:eof_action=pass[bc{n}]")
                parts.append(f"[bc{n}][wm{n}]overlay={int(px)}:{int(py)}:{en}[b{n}]")
            else:
                parts.append(f"[b{n - 1}][o{n}]overlay=x=main_w*{o['x']}-overlay_w/2:y=main_h*{o['y']}-overlay_h/2:"
                             f"{en}:eof_action=pass[b{n}]")
        for a in auds:
            k += 1
            inputs.append(["-i", str((job_dir / ASSETS / a["asset"]).resolve())])
            dur = a["end"] - a["start"]
            fi, fo = min(a["fade_in"], dur / 2), min(a["fade_out"], dur / 2)
            chain = (f"[{k}:a]atrim=start={a['source_start']:.3f}:duration={dur:.3f},asetpts=PTS-STARTPTS,"
                     f"volume={a['volume']:.3f}")
            if fi > 0: chain += f",afade=t=in:st=0:d={fi:.2f}"
            if fo > 0: chain += f",afade=t=out:st={dur - fo:.3f}:d={fo:.2f}"
            parts.append(chain + f",adelay={int(a['start'] * 1000)}:all=1[a{k}]")
            audio.append(f"[a{k}]")
        last = f"[b{len(ovs)}]"
        extra = "".join("," + c for c in cards)
        if has_caps:
            fonts = os.path.relpath(FONT_DIR, job_dir).replace("\\", "/")
            parts.append(f"{last}subtitles={ass.name}:fontsdir={fonts}{extra}[vout]")
        else:
            parts.append(f"{last}null{extra}[vout]")
        maps = ["-map", "[vout]"]
        if audio:
            base = "[0:a]" if cut_audio else ""
            n_in = len(audio) + (1 if cut_audio else 0)
            mix = f"{base}{''.join(audio)}amix=inputs={n_in}:duration=longest:normalize=0" if n_in > 1 else f"{''.join(audio)}anull"
            parts.append(mix + "[aout]")
            maps += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]
        elif cut_audio:
            maps += ["-map", "0:a", "-c:a", "copy"]
        maps += ["-t", f"{total:.3f}"]
        encoders = []
        if gpu_name():
            encoders.append(("placa video (NVENC)", ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "19", "-b:v", "0"]))
        encoders.append(("procesor", ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]))
        err = ""
        for where, venc in encoders:
            report({"type": "log", "msg": f"Compun suprapunerile, sunetul și subtitrările, codez pe {where}..."})
            rc, err = _ffmpeg_complex(cut.resolve(), ";".join(parts), maps, Path(dst).resolve(), venc, total, report,
                                      (0, 100), extra_inputs=inputs, cwd=str(job_dir))
            if rc == 0:
                return
        raise RuntimeError(f"Randarea clasică a eșuat. {(err or '').strip()[-400:]}")
    finally:
        ass.unlink(missing_ok=True)
        for t in temps:
            t.unlink(missing_ok=True)

def render_final(job_dir, project, report, source_url, asset_url=None, captions=True):
    """Randeaza video-ul final. Remotion daca e instalat, altfel motorul clasic. Intoarce numele fisierului."""
    job_dir = Path(job_dir)
    report({"type": "stage", "n": 3})
    n_slots = sum(1 for o in project.get("overlays", []) if o.get("type") == "slot")
    if n_slots:
        report({"type": "log", "msg": f"Atenție: {n_slots} {'loc de B-roll e încă gol' if n_slots == 1 else 'locuri de B-roll sunt încă goale'} "
                                      "— le-am sărit. Umple-le din Timeline cu clipurile din DaVinci."})
    name = _next_final(job_dir)
    done = False
    if remotion_status()["ok"] and source_url:
        try:
            render_remotion(job_dir, project, job_dir / name, source_url, report, asset_url, captions)
            done = True
        except Exception as e:
            report({"type": "log", "msg": f"{str(e).splitlines()[0][:260]} — folosesc motorul clasic."})
            (job_dir / name).unlink(missing_ok=True)
    if not done:
        burn_classic(job_dir, project, job_dir / name, report, captions)
    for old in job_dir.glob("video_final*.mp4"):
        if old.name != name:
            try: old.unlink()
            except OSError: pass
    report({"type": "stage_detail", "n": 3, "detail": "Remotion · gata" if done else "Motor clasic · gata"})
    return name


# ------------------------------------------------------------ textul mare in stilul brandului (motorul clasic si coperta)
def _wrap(text, n):
    lines, cur = [], ""
    for w in str(text).split():
        if cur and len(cur) + 1 + len(w) > n:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines

def _card_filter(title, subtitle, W, H, yc, cwd, tag, enable=None):
    """Card verde inchis cu titlu crem (Anton) si subtitlu auriu (Montserrat), facut cu drawtext.
    Fisierele de text si fonturile sunt date relativ la cwd (fara „C:” in filtru). Intoarce (filtre, fisiere temporare)."""
    cwd = Path(cwd)
    rel = lambda p: os.path.relpath(p, cwd).replace("\\", "/")
    ts, ss = max(12, int(W * 0.085)), max(10, int(W * 0.045))
    tl = _wrap(str(title or "").upper(), 16)[:4]
    sl = _wrap(str(subtitle or ""), 30)[:3]
    if not tl and not sl:
        return "null", []
    lh_t, lh_s, pad = int(ts * 1.15), int(ss * 1.35), int(W * 0.045)
    gap = int(ss * 0.5) if tl and sl else 0
    h = len(tl) * lh_t + len(sl) * lh_s + gap + 2 * pad
    y0 = int(max(0, min(H - h, H * yc - h / 2)))
    en = f":enable='between(t,{enable[0]:.3f},{enable[1]:.3f})'" if enable else ""
    x0, bw = int(W * 0.06), int(W * 0.88)
    f = [f"drawbox=x={x0}:y={y0}:w={bw}:h={h}:color=0x13211A@0.88:t=fill{en}",
         f"drawbox=x={x0}:y={y0}:w={max(4, int(W * 0.012))}:h={h}:color=0xE8A83B@1:t=fill{en}"]
    temps, y = [], y0 + pad
    rows = [(l, "Anton-Regular.ttf", ts, "0xF3EDDD", lh_t) for l in tl] + \
           [(l, "Montserrat-Bold.ttf", ss, "0xE8A83B", lh_s) for l in sl]
    for i, (line, font, size, col, lh) in enumerate(rows):
        if tl and i == len(tl):
            y += gap
        tf = cwd / f"_text_{tag}_{i}.txt"
        tf.write_text(line, encoding="utf-8")
        temps.append(tf)
        f.append(f"drawtext=fontfile='{rel(FONT_DIR / font)}':textfile='{rel(tf)}':expansion=none:fontsize={size}:"
                 f"fontcolor={col}:x=(w-text_w)/2:y={y + (lh - size) // 2}{en}")
        y += lh
    return ",".join(f), temps


# ------------------------------------------------------------ variante de carlig (A/B): alt inceput pentru acelasi video
HOOK_LABELS = "ABCDE"
HOOK_MAX = 10.0          # secunde de fraza puse la inceput

def clean_hooks(raw, duration):
    out = []
    for h in (raw if isinstance(raw, list) else [])[:len(HOOK_LABELS)]:
        if not isinstance(h, dict):
            continue
        clip, tot = [], 0.0
        for x in (h.get("clip") or [])[:20]:
            try:
                a, b = max(0.0, float(x[0])), min(float(duration), float(x[1]))
            except (TypeError, ValueError, IndexError):
                continue
            if b - a >= 0.04 and tot < HOOK_MAX:
                b = min(b, a + HOOK_MAX - tot)
                clip.append([round(a, 3), round(b, 3)])
                tot += b - a
        text = " ".join(str(h.get("text") or "").split())[:120]
        if not clip and not text:
            continue
        out.append({"label": HOOK_LABELS[len(out)], "clip": clip, "text": text,
                    "accent": " ".join(str(h.get("accent") or "").split())[:40],
                    "reason": str(h.get("reason") or "")[:240], "spoken": str(h.get("spoken") or "")[:300]})
    return out

def _shift_cues(cues, d):
    out = []
    for c in cues:
        words = [dict(w, s=round(w["s"] + d, 3), e=round(w["e"] + d, 3)) if "s" in w and "e" in w else dict(w) for w in c["words"]]
        out.append({**c, "start": round(c["start"] + d, 3), "end": round(c["end"] + d, 3), "words": words})
    return out

def _hook_cues(cap, clip):
    """Subtitrarile frazei puse la inceput: doar cuvintele rostite chiar in bucata aleasa."""
    out, acc = [], 0.0
    pieces = []
    for a, b in clip:
        pieces.append((a, b, acc))
        acc += b - a
    def where(t):
        for a, b, o in pieces:
            if a - 1e-3 <= t <= b + 1e-3:
                return o + min(max(t, a), b) - a
        return None
    for c in cap.get("cues") or []:
        words = []
        for w in c["words"]:
            if "s" not in w or "e" not in w:
                continue
            m = where((w["s"] + w["e"]) / 2)
            if m is None:
                continue
            s, e = where(w["s"]), where(w["e"])
            s = m if s is None else s
            e = m if e is None else e
            words.append(dict(w, s=round(s, 3), e=round(max(e, s), 3)))
        if words and words[-1]["e"] - words[0]["s"] >= 0.05:
            out.append({**c, "start": words[0]["s"], "end": words[-1]["e"], "words": words})
    return out

def variant_project(project, v):
    """Proiectul unei variante: fraza-carlig (daca exista) pusa la inceput, apoi tot video-ul;
    totul de pe timeline se muta cu durata ei. Intoarce (proiect, subtitrari pe timpul final)."""
    segs = [list(x) for x in project["segments"]]
    clip = [list(x) for x in v.get("clip") or []]
    L = seg_total(clip)
    sh = lambda it: {**it, "start": round(it["start"] + L, 3), "end": round(it["end"] + L, 3)}
    vp = {**project, "segments": clip + segs}
    ovs = [sh(o) for o in project.get("overlays", [])]
    vp["audio"] = [sh(a) for a in project.get("audio", [])]
    vp["zooms"] = [sh(z) for z in project.get("zooms") or []]
    vp["transitions"] = {str(int(k) + (1 if clip else 0)): t for k, t in clean_trans(project.get("transitions")).items()}
    if v.get("text"):
        end = round(min(max(L, 2.5), 4.0), 3)
        # textul variantei inlocuieste titlul de la inceputul video-ului (ca sa nu apara doua titluri unul peste altul)
        ovs = [o for o in ovs if not (o.get("type") == "graphic" and o["start"] < L + 1.0 and o.get("y", 0.5) < 0.5)]
        t = TEMPLATE_BY_ID["hook"]
        ovs.append({"id": "carlig", "type": "graphic", "template": "hook", "start": 0.0, "end": end,
                    "x": t["x"], "y": t["y"], "w": t["w"], "lane": 50, "_card": True,
                    "props": clean_graphic_props("hook", {"text": v["text"], "accent": v.get("accent") or ""})})
        vp["title_cards"] = [{"title": v["text"], "subtitle": "", "start": 0.0, "end": end, "y": t["y"]}]
    vp["overlays"] = ovs
    cap = project.get("captions") or {}
    cap_out = None
    if cap.get("cues"):
        body = _shift_cues(captions_to_out(cap, segs)["cues"], L)
        cap_out = {"version": 1, "style": cap["style"], "cues": (_hook_cues(cap, clip) if clip else []) + body}
    return vp, cap_out

def render_variant(job_dir, project, v, report, source_url, asset_url=None, captions=True):
    """Randeaza o varianta de carlig in varianta_<litera>.mp4 (alt nume decat video_final, ca sa nu-l inlocuiasca)."""
    job_dir = Path(job_dir)
    vp, cap_out = variant_project(project, v)
    name = f"varianta_{v['label']}.mp4"
    dst = job_dir / name
    done = False
    if remotion_status()["ok"] and source_url:
        try:
            render_remotion(job_dir, vp, dst, source_url, report, asset_url, captions, cap_out=cap_out)
            done = True
        except Exception as e:
            report({"type": "log", "msg": f"{str(e).splitlines()[0][:260]} — folosesc motorul clasic."})
            dst.unlink(missing_ok=True)
    if not done:
        cut = job_dir / "_taiat_varianta.mp4"
        try:
            render_proxy(project_source(job_dir, vp), vp["segments"], cut, report, n=3, scale=(0, 40),
                         audio_src=processed_audio(job_dir, vp))
            burn_classic(job_dir, vp, dst, report, captions, cut=cut, cap_out=cap_out)
        finally:
            cut.unlink(missing_ok=True)
    return name


# ------------------------------------------------------------ coperta (pachetul de publicare)
COVER_FILE = "coperta.jpg"

def make_cover(job_dir, project, t_out, title, subtitle=""):
    """Un cadru din video (la momentul ales, cu look-ul proiectului) + textul copertei in stilul brandului."""
    job_dir = Path(job_dir)
    src = project_source(job_dir, project)
    t_src = out_to_src(max(0.0, float(t_out or 0)), project["segments"])
    W = 1080
    H = max(2, int(round(W * project["height"] / project["width"] / 2)) * 2)
    col = clean_look(project.get("look"))["color"]
    chain = [f"scale={W}:{H}:force_original_aspect_ratio=increase", f"crop={W}:{H}"]
    if not color_neutral(col):
        chain.append(ffmpeg_color(col))
    card, temps = _card_filter(title, subtitle, W, H, 0.40, job_dir, "cop")
    chain.append(card)
    tmp = job_dir / "_coperta.tmp.jpg"
    try:
        r = subprocess.run([find_tool("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{t_src:.3f}", "-i", str(src.resolve()),
                            "-frames:v", "1", "-vf", ",".join(chain), "-q:v", "2", tmp.name],
                           cwd=str(job_dir), capture_output=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
    finally:
        for f in temps:
            f.unlink(missing_ok=True)
    if r.returncode != 0 or not tmp.exists():
        raise RuntimeError("Nu am putut face coperta. " + (r.stderr or "")[-300:])
    tmp.replace(job_dir / COVER_FILE)
    return job_dir / COVER_FILE


# ------------------------------------------------------------ materialele tale (poze / clipuri urcate odata cu video-ul)
MATERIAL_MODES = ("small", "full", "bg")
_STOP = set("cand când zic zice spun spune vorbesc vorbeste vorbește despre de la in în si și pe cu ca că sa să o un una "
            "unde momentul partea fraza cuvantul cuvântul pune puneti pune-l pune-o arata arată apare atunci asta acesta aceasta".split())

def _norm(s):
    import unicodedata
    s = unicodedata.normalize("NFD", str(s).lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")

def _tokens(s):
    return [t for t in re.findall(r"[a-z0-9]+", _norm(s)) if t not in _STOP and len(t) > 1]

def _tok_match(a, b):
    if a == b:
        return True
    return len(a) >= 4 and len(b) >= 4 and (a[:5] == b[:5] or a.startswith(b) or b.startswith(a))

def material_overlay(info, start, end, mode, lane=0):
    """La fel ca tlMediaOverlay din timeline.js."""
    w, h = info.get("width") or 1, info.get("height") or 1
    o = {"id": "m" + re.sub(r"[^a-z0-9]", "", _norm(info["asset"]))[:10] + str(int(start * 1000)), "type": info["type"],
         "asset": info["asset"], "start": round(start, 3), "end": round(end, 3), "x": 0.5, "y": 0.35,
         "w": 0.45 if h >= w else 0.8, "opacity": 1, "muted": True, "source_start": 0, "lane": lane, "rotation": 0, "radius": 0}
    if mode == "full":
        o["fit"] = "cover"
    elif mode == "bg":
        o["fit"], o["pip"] = "bg", dict(PIP_DEFAULT)
        o["bgimg"] = {"fit": "contain", "scale": 1.0, "color": "#000000", "y": 0.4 if h / w < 16 / 9 else 0.5}
    else:
        o.update(radius=4, anim_in="pop", anim_out="fade")
    return o

def find_spot(where, cues, total):
    """Unde spune ea sa apara: „la început”, „la final”, „0:12”, sau cuvintele dintr-o fraza. Intoarce (start, end) sau None."""
    w = _norm(where or "").strip()
    if not w:
        return None
    m = re.search(r"(\d+):(\d{1,2})|(\d+(?:[.,]\d+)?)\s*(?:s|sec)", w)
    if m:
        t = int(m.group(1)) * 60 + int(m.group(2)) if m.group(1) else float(m.group(3).replace(",", "."))
        return (min(t, max(0.0, total - 1)), None)
    if re.search(r"\b(inceput|start|intro)", w):
        return (0.0, None)
    if re.search(r"\b(final|sfarsit|outro)", w):
        return (-1.0, None)
    want = _tokens(where)
    if not want:
        return None
    best, score = None, 0
    for i, c in enumerate(cues):
        for span in (1, 2):                               # fraza singura sau impreuna cu urmatoarea
            if i + span > len(cues):
                continue
            words = [t for cc in cues[i:i + span] for wd in cc["words"] for t in _tokens(wd["t"])]
            sc = sum(1 for t in want if any(_tok_match(t, x) for x in words)) - (0.1 if span == 2 else 0)
            if sc > score:
                best, score = (cues[i]["start"], cues[i + span - 1]["end"]), sc
    return best if score >= max(1, len(want) / 2) else None

def place_materials(project, items, claude_spots=None):
    """items: [{asset, mode, where, info}] -> le pune pe timeline. Intoarce lista celor fara loc (raman „de pus”)."""
    segs = project["segments"]
    total = seg_total(segs)
    cues = captions_to_out(project["captions"], segs)["cues"] if (project.get("captions") or {}).get("cues") else []
    cues = [c for c in cues if not c.get("hidden")]
    claude_spots = claude_spots or {}
    new, pending = [], []
    for it in items:
        info, mode = it["info"], it.get("mode") if it.get("mode") in MATERIAL_MODES else "small"
        spot = find_spot(it.get("where"), cues, total) or claude_spots.get(it["asset"])
        if not spot:
            pending.append(it["asset"])
            continue
        a, b = spot
        want = min(6.0, max(2.5, (b - a) if b is not None else 3.5))
        if info["type"] == "video" and info.get("duration"):
            want = min(want, info["duration"]) if info["duration"] >= 1.0 else info["duration"]
        if a < 0:                                         # „la final”
            a = max(0.0, total - want)
        a = max(0.0, min(a, total - 0.5))
        if mode in ("full", "bg"):                        # doua materiale pe tot ecranul: al doilea vine dupa primul
            for o in sorted(new, key=lambda o: o["start"]):
                if o.get("fit") in ("cover", "bg") and o["start"] < a + want and a < o["end"]:
                    a = o["end"]
            if a > total - 0.5:
                pending.append(it["asset"])
                continue
        b = min(total, a + want)
        lane = 0
        while any(o.get("lane", 0) == lane and o["start"] < b and a < o["end"] for o in project.get("overlays", []) + new):
            lane += 1
        new.append(material_overlay(info, a, b, mode, lane))
    project["overlays"] = list(project.get("overlays", [])) + new
    project["materials_pending"] = pending
    return pending

# ------------------------------------------------------------ dupa script
def apply_script(script, words, segs, cfg, report):
    """Potriveste transcrierea cu scriptul: scoate reluarile / ce nu e in script,
    iar subtitrarile iau textul din script. Intoarce (bucati noi, cuvinte pentru subtitrari)."""
    import script_align as sa
    report({"type": "stage_detail", "n": 2, "detail": "Potrivesc cu scriptul…"})
    al = sa.align(script, words)
    n_units, n_found = len(al["units"]), len(al["chosen"])
    base = segs
    trusted = n_units and n_found / n_units >= 0.5
    if not n_found:
        report({"type": "log", "msg": "Scriptul nu seamănă cu ce ai spus în video — am tăiat doar pauzele și am păstrat transcrierea."})
        return segs, words, "Scriptul nu s-a potrivit · doar pauze"
    if not trusted:
        report({"type": "log", "msg": f"Am regăsit doar {n_found} din {n_units} fraze din script — nu tai ce e în afara lui, ca să nu pierzi material."})
    a, b = cfg["margin"], cfg["margin_after"] if cfg["margin_after"] is not None else cfg["margin"]
    if cfg.get("script_offscript") and trusted:
        keep = [(x - a, y + b) for x, y in sa.take_intervals(al, words)]
        segs = sa.intersect(base, keep)
    elif cfg.get("script_retakes"):
        segs = sa.subtract(base, sa.span_intervals(al["retake"], words))
    if not segs:
        segs = base
    removed = seg_total(base) - seg_total(segs)
    n_retakes = sum(1 for k, t in enumerate(al["all_takes"]) for c in t if al["chosen"].get(k) is not c)
    report({"type": "log", "msg": f"Script: am regăsit {n_found} din {n_units} fraze · {n_retakes} reluări · "
                                  f"am scos încă {removed:.1f} s față de tăierea pauzelor."})
    summary = f"Script: {n_found}/{n_units} fraze · {n_retakes} reluări · −{removed:.1f} s"
    report({"type": "stage_detail", "n": 2, "detail": summary})
    if cfg.get("script_captions"):
        extra = [w_ for i, w_ in enumerate(words) if i not in al["used"] and i not in al["retake"]]
        words = sorted(sa.script_words(al, words) + extra)
    return segs, words, summary


# ------------------------------------------------------------ totul
def process(video, job_dir, cfg, report, on_segment, source_url=None, asset_url=None, before_final=None):
    """before_final(project) -> project: pasul aplicatiei inainte de randare (materialele tale puse pe timeline)."""
    video, job_dir = Path(video), Path(job_dir)
    job_dir.mkdir(parents=True, exist_ok=True)
    files = {}

    # 1) sursa dreapta + pauzele + copia taiata
    report({"type": "stage", "n": 1})
    src = video
    if probe_rotation(video):
        report({"type": "log", "msg": f"Video-ul are etichetă de rotație ({probe_rotation(video)}°) — îl îndrept întâi, ca să nu iasă culcat."})
        src = job_dir / "sursa.mp4"
        encode(video, src, None, str(job_dir), report, 1, "Îndrept video-ul")
    segs = analyze_segments(src, job_dir, cfg, report)
    cut = job_dir / "video_taiat.mp4"
    look0 = load_default_look()
    try:
        snd = processed_audio(job_dir, {"source": src.name if src.parent == job_dir else str(src.resolve()), "look": look0})
        if snd:
            report({"type": "log", "msg": "Am curățat sunetul după look-ul tău implicit."})
    except Exception as e:
        snd = None
        report({"type": "log", "msg": f"Curățarea sunetului n-a mers ({_short_err(e)}); folosesc sunetul original."})
    script = (cfg.get("script") or "").strip()
    if script:
        report({"type": "stage_detail", "n": 1, "detail": "Pauze găsite · urmează potrivirea cu scriptul"})
    else:
        render_proxy(src, segs, cut, report, audio_src=snd)
        report({"type": "cut_done", "from": round(probe_duration(src), 1), "to": round(seg_total(segs), 1)})
    files["cut"] = cut.name

    w, h = probe_size(src)
    project = {
        "version": 2, "source": src.name if src.parent == job_dir else str(src.resolve()),
        "source_duration": round(probe_duration(src), 3), "width": w, "height": h, "fps": probe_fps(src),
        "segments": segs, "captions": {"version": 1, "style": load_default_style(), "cues": []},
        "overlays": [], "audio": [], "settings": cfg, "look": look0, "zooms": [], "transitions": {},
    }
    save_project(job_dir, project)
    files["project"] = PROJECT_FILE

    # 2) transcriu SURSA (timpii raman valabili daca schimbi taieturile)
    words = transcribe(src, cfg, report, on_segment)
    if script:
        segs, words, summary = apply_script(script, words, segs, cfg, report)
        project["segments"] = segs
        save_project(job_dir, project)
        render_proxy(src, segs, cut, report, n=2, scale=(0, 100), audio_src=snd)
        report({"type": "stage_detail", "n": 2, "detail": summary})
        report({"type": "cut_done", "from": round(probe_duration(src), 1), "to": round(seg_total(segs), 1)})
    inside = lambda t: any(a <= t <= b for a, b in segs)
    words = [w_ for w_ in words if inside((w_[0] + w_[1]) / 2)]
    if not words:
        if before_final:
            save_project(job_dir, before_final(project) or project)
        report({"type": "log", "msg": "Nu am detectat vorbă — am făcut doar tăierea."})
        report({"type": "skipped", "n": 3, "detail": "Fără vorbă detectată"})
        report({"type": "done", "files": files})
        return files

    project["captions"] = build_captions(chunk_words(words, cfg["words_per_caption"]), load_default_style())
    save_project(job_dir, project)
    save_caption_files(job_dir, captions_to_out(project["captions"], segs))
    files.update(srt="subtitrari.srt", txt="transcript.txt", captions=PROJECT_FILE)

    try:
        make_preview(job_dir, project, report)
    except Exception as e:
        report({"type": "log", "msg": f"Copia de previzualizare n-a mers ({_short_err(e)}); Timeline-ul folosește originalul."})

    if before_final:
        project = before_final(project) or project
        save_project(job_dir, project)

    # 3) video-ul final
    if cfg["burn_captions"]:
        files["final"] = render_final(job_dir, project, report, source_url, asset_url)
    else:
        report({"type": "skipped", "n": 3, "detail": "Oprit din setări"})
    report({"type": "done", "files": files})
    return files
