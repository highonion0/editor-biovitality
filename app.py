#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BioVitality Editor - aplicatia.
Porneste un server local (doar pe calculatorul tau) si deschide interfata in browser.
"""

import json
import os
import re
import sys
import time
import uuid
import queue
import threading
import traceback
import mimetypes
import webbrowser
import urllib.parse
import urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

ROOT = Path(__file__).resolve().parent

# cu pythonw nu exista consola -> scriem jurnalul intr-un fisier
if sys.stdout is None or sys.stderr is None:
    _logf = open(ROOT / "jurnal.log", "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = _logf
else:
    for s in (sys.stdout, sys.stderr):
        try: s.reconfigure(encoding="utf-8", errors="replace")
        except Exception: pass

import core  # noqa: E402
import assistant  # noqa: E402

IN_DIR = ROOT / "input"
OUT_DIR = ROOT / "output"
UI_FILE = ROOT / "ui.html"
STATIC_FILES = {"timeline.js": "text/javascript; charset=utf-8", "timeline.css": "text/css; charset=utf-8",
                "graphics.js": "text/javascript; charset=utf-8", "assistant.js": "text/javascript; charset=utf-8",
                "sounds.js": "text/javascript; charset=utf-8", "look.js": "text/javascript; charset=utf-8", "safezones.js": "text/javascript; charset=utf-8", "motion.js": "text/javascript; charset=utf-8", "proposals.js": "text/javascript; charset=utf-8",
                "captions_tl.js": "text/javascript; charset=utf-8", "publish.js": "text/javascript; charset=utf-8",
                "library.js": "text/javascript; charset=utf-8", "materials.js": "text/javascript; charset=utf-8",
                "script_tab.js": "text/javascript; charset=utf-8"}
APP_ID = "biovitality-editor"
CHUNK = 16 * 1024 * 1024
BASE_PORT = 8765
STAGE_LABELS = ["Taie tăcerile", "Transcrie vorba", "Randează video-ul final"]
BASE = {"url": None}


# ------------------------------------------------------------ evenimente live
class Hub:
    def __init__(self):
        self.subs, self.lock = set(), threading.Lock()
    def subscribe(self):
        q = queue.Queue(maxsize=10000)
        with self.lock: self.subs.add(q)
        return q
    def unsubscribe(self, q):
        with self.lock: self.subs.discard(q)
    def publish(self, ev):
        with self.lock: subs = list(self.subs)
        for q in subs:
            try: q.put_nowait(ev)
            except queue.Full: pass

hub = Hub()
jobs, order = {}, []
work_q = queue.Queue()
state = {"device": {"mode": "checking", "label": "Verific placa video…"}}


def public(job, full=False):
    d = {k: v for k, v in job.items() if k not in ("path", "dir", "segments", "log", "settings")}
    d["segment_count"] = len(job["segments"])
    if full:
        d["segments"] = job["segments"]
        d["log"] = job["log"][-400:]
    return d

def emit(job):
    hub.publish({"type": "job", "job": public(job)})

def add_log(job, msg):
    entry = {"t": time.strftime("%H:%M:%S"), "msg": msg}
    job["log"].append(entry)
    hub.publish({"type": "log", "id": job["id"], "entry": entry})
    print(f"[{job['name']}] {msg}", flush=True)


# ------------------------------------------------------------ fisiere
BAD = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

def safe_name(name, fallback="video"):
    n = BAD.sub("_", name).strip().rstrip(". ")
    return n or fallback

def unique_path(p: Path, is_dir=False):
    if not p.exists():
        return p
    stem, suf = (p.name, "") if is_dir else (p.stem, p.suffix)
    i = 2
    while True:
        cand = p.with_name(f"{stem} ({i}){suf}")
        if not cand.exists():
            return cand
        i += 1


# ------------------------------------------------------------ joburi
def create_job(name, path, cfg, status="queued"):
    jid = uuid.uuid4().hex[:10]
    job = {
        "id": jid, "name": name, "status": status, "stage": 0, "draft": {"script": cfg.get("script", "")},
        "stages": [{"label": l, "status": "pending", "progress": 0, "detail": ""} for l in STAGE_LABELS],
        "cut_from": None, "cut_to": None, "device": None, "files": {}, "error": None,
        "media": "input", "folder": None, "created": time.time(), "finished": None,
        "settings_view": core.settings_summary(cfg),
        "path": str(path), "dir": None, "segments": [], "log": [], "settings": cfg,
    }
    jobs[jid] = job
    order.append(jid)
    return job

def make_report(job):
    st = job["stages"]
    throttle = {"t": 0.0}

    def report(ev):
        t = ev["type"]
        if t == "stage":
            n = ev["n"]
            for i in range(n - 1):
                if st[i]["status"] in ("pending", "active"):
                    st[i].update(status="done", progress=100)
            st[n - 1].update(status="active", progress=0)
            job["stage"] = n
            emit(job)
        elif t == "progress":
            n = job["stage"]
            if n:
                st[n - 1]["progress"] = ev["value"]
            now = time.time()
            if ev["value"] is None or now - throttle["t"] > 0.2:
                throttle["t"] = now
                emit(job)
        elif t == "stage_detail":
            st[ev["n"] - 1]["detail"] = ev["detail"]
            emit(job)
        elif t == "cut_done":
            a, b = ev["from"], ev["to"]
            job["cut_from"], job["cut_to"] = a, b
            pct = round((1 - b / a) * 100) if a else 0
            st[0].update(status="done", progress=100, detail=f"{a:.1f}s → {b:.1f}s  (−{pct}%)")
            job["media"] = "cut"
            add_log(job, f"Tăiere gata: {a:.1f}s → {b:.1f}s")
            emit(job)
        elif t == "device":
            job["device"] = ev["label"]
            state["device"] = core.device_status()
            hub.publish({"type": "device", "device": state["device"]})
            emit(job)
        elif t == "log":
            add_log(job, ev["msg"])
        elif t == "skipped":
            st[ev["n"] - 1].update(status="skipped", detail=ev.get("detail", ""))
            emit(job)
        elif t == "done":
            for s in st:
                if s["status"] in ("pending", "active"):
                    s.update(status="done", progress=100)
            job["files"] = ev["files"]
            job["media"] = "final" if "final" in ev["files"] else "cut"
    return report

# ------------------------------------------------------------ proiectele raman in lista si dupa repornire
JOB_META = "job.json"
DRAFT_FILE = "_ciorna_timeline.json"
META_KEYS = ("id", "name", "path", "settings", "settings_view", "files", "cut_from", "cut_to", "device", "created", "finished")

def save_job_meta(job):
    """Datele jobului langa proiect, ca aplicatia sa-l poata reincarca la urmatoarea pornire."""
    if not job.get("dir"):
        return
    try:
        (Path(job["dir"]) / JOB_META).write_text(json.dumps({k: job.get(k) for k in META_KEYS}, ensure_ascii=False, indent=1),
                                                 encoding="utf-8")
    except OSError:
        pass

def _files_in(d, pr):
    files = {"project": core.PROJECT_FILE}
    if (d / "video_taiat.mp4").exists():
        files["cut"] = "video_taiat.mp4"
    finals = sorted(d.glob("video_final*.mp4"), key=lambda f: f.stat().st_mtime)
    if finals:
        files["final"] = finals[-1].name
    for k, f in (("srt", "subtitrari.srt"), ("txt", "transcript.txt")):
        if (d / f).exists():
            files[k] = f
    if (pr.get("captions") or {}).get("cues"):
        files["captions"] = core.PROJECT_FILE
    for f in sorted(d.glob("varianta_*.mp4")):              # variantele de carlig (A/B)
        files["var_" + f.stem.split("_", 1)[1]] = f.name
    if (d / core.COVER_FILE).exists():
        files["cover"] = core.COVER_FILE
    if (d / "publicare.txt").exists():
        files["pack"] = "publicare.txt"
    if (d / assistant.CAPTION_FILE).exists():
        files["caption_txt"] = assistant.CAPTION_FILE
    return files

def load_existing_projects():
    """La pornire: pun inapoi in lista toate proiectele din output/, cu tot ce ai editat in ele."""
    if not OUT_DIR.is_dir():
        return 0
    n = 0
    for d in sorted((x for x in OUT_DIR.iterdir() if x.is_dir()), key=lambda x: x.stat().st_mtime):
        pf = d / core.PROJECT_FILE
        if not pf.exists():
            continue
        try:
            pr = json.loads(pf.read_text(encoding="utf-8"))
            meta = json.loads((d / JOB_META).read_text(encoding="utf-8")) if (d / JOB_META).exists() else {}
        except (OSError, ValueError):
            continue
        if meta.get("hidden"):
            continue
        cfg = core.merge_settings(meta.get("settings") or pr.get("settings") or {})
        src = pr.get("source", "")
        path = meta.get("path") or (src if Path(src).is_absolute() else str(d / src))
        # proiectele vechi: numele vine din folder (sursa din folder e doar copia indreptata)
        name = meta.get("name") or (Path(src).name if Path(src).is_absolute() else re.sub(r" \(\d+\)$", "", d.name) + ".mp4")
        job = create_job(name, Path(path), cfg, "done")
        if meta.get("id") and meta["id"] not in jobs:
            jobs.pop(job["id"]); order.remove(job["id"])
            job["id"] = meta["id"]; jobs[job["id"]] = job; order.append(job["id"])
        files = _files_in(d, pr)
        job.update(dir=str(d), folder=d.name, files=files, stage=3, media="final" if files.get("final") else "cut",
                   cut_from=meta.get("cut_from") or round(float(pr.get("source_duration") or 0), 1),
                   cut_to=meta.get("cut_to") or round(core.seg_total(pr.get("segments") or []), 1),
                   device=meta.get("device"), finished=meta.get("finished") or d.stat().st_mtime,
                   settings_view=meta.get("settings_view") or core.settings_summary(cfg))
        # transcrierea (pentru panoul „Transcript” si „Copiaza textul”), refacuta din subtitrarile proiectului
        cues = sorted((pr.get("captions") or {}).get("cues") or [], key=lambda c: c.get("start", 0))
        job["segments"] = [{"start": round(c["start"], 2), "end": round(c["end"], 2),
                            "text": " ".join(w.get("t", "") for w in c.get("words") or []).strip()}
                           for c in cues if isinstance(c, dict) and "start" in c and "end" in c]
        for s_, det in zip(job["stages"], ("Din proiectul salvat", "", "Randat" if files.get("final") else "—")):
            s_.update(status="done", progress=100, detail=det)
        job["log"].append({"t": time.strftime("%H:%M:%S"), "msg": f"Reîncărcat din {d.name} — editările tale sunt aici."})
        save_job_meta(job)
        n += 1
    return n


# ------------------------------------------------------------ materialele urcate odata cu video-ul
def material_dir(job):
    return IN_DIR / "_materiale" / job["id"]

def clean_materials(job, raw):
    out = []
    for m in raw[:30]:
        if not isinstance(m, dict):
            continue
        name = Path(str(m.get("asset", ""))).name
        if name and (material_dir(job) / name).is_file():
            out.append({"asset": name, "type": "image" if Path(name).suffix.lower() in core.IMAGE_EXT else "video",
                        "mode": m.get("mode") if m.get("mode") in core.MATERIAL_MODES else "small",
                        "where": str(m.get("where") or "").strip()[:200]})
    return out

def script_view(pr):
    """Pentru tabul „📜 Script”: frazele, dublele gasite (timp in sursa, textul spus) si care e aleasa."""
    info = pr.get("script_align")
    if not info:
        return {"units": []}
    words = info["words"]
    units = []
    for k, u in enumerate(info["units"]):
        units.append({"text": " ".join(u), "chosen": info["chosen"].get(str(k)),
                      "takes": [{"a": words[c["s"]][0], "b": words[c["e"]][1], "score": round(c["score"], 2),
                                 "quiet": bool(c.get("quiet")), "said": " ".join(w[2] for w in words[c["s"]:c["e"] + 1])}
                                for c in info["takes"][k]]})
    return {"units": units}

def put_materials(job, project):
    """Dupa transcriere, inainte de randare: copiaza materialele in proiect si le pune pe timeline."""
    mats = (job.get("draft") or {}).get("materials") or []
    if not mats:
        return project
    import shutil
    items = []
    for m in mats:
        f = material_dir(job) / m["asset"]
        if f.is_file():
            dst = copy_to_assets(job, f)
            items.append({**m, "asset": dst.name, "info": core.asset_info(dst)})
    no_spot = [it for it in items if not core.find_spot(it.get("where"), core.captions_to_out(project["captions"], project["segments"])["cues"]
                                                      if (project.get("captions") or {}).get("cues") else [], core.seg_total(project["segments"]))]
    spots = {}
    if no_spot and (project.get("captions") or {}).get("cues") and assistant.api_key():
        add_log(job, f"Claude alege unde să pună {len(no_spot)} {'material' if len(no_spot) == 1 else 'materiale'}...")
        try:
            spots = assistant.place_materials(project, no_spot)
        except Exception as e:
            add_log(job, f"Claude n-a putut alege locurile ({str(e)[:200]}).")
    pending = core.place_materials(project, items, spots)
    project["overlays"] = core.clean_overlays(project["overlays"], core.seg_total(project["segments"]), Path(job["dir"]) / core.ASSETS)
    n = len(items) - len(pending)
    if n:
        add_log(job, f"Am pus {n} {'material' if n == 1 else 'materiale'} de-ale tale pe timeline.")
    if pending:
        add_log(job, f"De pus de mână (în Timeline): {', '.join(pending)}.")
    shutil.rmtree(material_dir(job), ignore_errors=True)
    return project

def run_job(job):
    st = job["stages"]
    job["status"] = "running"
    job_dir = unique_path(OUT_DIR / safe_name(Path(job["path"]).stem), is_dir=True)
    job["dir"], job["folder"] = str(job_dir), job_dir.name
    emit(job)
    t0 = time.time()
    report = make_report(job)

    def on_segment(start, end, text):
        seg = {"start": round(start, 2), "end": round(end, 2), "text": text}
        job["segments"].append(seg)
        hub.publish({"type": "segment", "id": job["id"], "seg": seg})

    try:
        add_log(job, f"Încep: {job['name']}  ({job['settings_view']})")
        core.process(Path(job["path"]), job_dir, job["settings"], report, on_segment, source_url(job), asset_url(job),
                     before_final=lambda pr: put_materials(job, pr))
        job["status"] = "done"
        add_log(job, f"Gata în {time.time() - t0:.0f} secunde.")
        job["finished"] = time.time()
        save_job_meta(job)
    except Exception as e:
        job["status"] = "error"
        job["error"] = friendly(e)
        n = job["stage"]
        if n:
            st[n - 1]["status"] = "error"
        add_log(job, "EROARE: " + str(e)[-900:])
        traceback.print_exc()
    job["finished"] = time.time()
    emit(job)

def friendly(e):
    s = str(e)
    if "nu e instalat" in s:
        return s
    if "cublas" in s.lower() or "cudnn" in s.lower():
        return "Placa video n-a pornit. Rulează „instaleaza_gpu.bat” sau folosește procesorul."
    if "Tăierea" in s:
        return "Tăierea tăcerilor n-a mers pe acest fișier. Detalii în jurnalul tehnic."
    if "Arderea" in s:
        return "Nu am putut arde subtitrările. Fișierul .srt e totuși salvat."
    return s.splitlines()[0][:300] if s else e.__class__.__name__

def source_url(job):
    return f"{BASE['url']}/media/{job['id']}/source" if BASE["url"] else None

def asset_url(job):
    return f"{BASE['url']}/asset/{job['id']}" if BASE["url"] else None

def run_timeline(job, payload):
    st = job["stages"]
    report = make_report(job)
    t0 = time.time()
    try:
        add_log(job, "Aplic timeline-ul editat...")
        project = core.apply_timeline(job["dir"], payload, report)
        job["media"] = "cut"
        emit(job)
        # video-ul final se randeaza mereu (poze, muzica, grafica); setarea „arde subtitrarile” decide doar textul
        name = core.render_final(job["dir"], project, report, source_url(job), asset_url(job),
                                 captions=job["settings"].get("burn_captions", True))
        job["files"]["final"] = name
        job["media"] = "final"
        for s_ in st:
            if s_["status"] == "active":
                s_.update(status="done", progress=100)
        job["status"], job["error"] = "done", None
        add_log(job, f"Timeline randat ({time.time() - t0:.0f} secunde).")
        if job["files"].get("caption_txt"):
            add_log(job, f"Captionul tău e în {assistant.CAPTION_FILE}, în același folder cu video-ul.")
        save_job_meta(job)
    except Exception as e:
        job["status"] = "error"
        job["error"] = friendly(e)
        n = job["stage"]
        if n:
            st[n - 1]["status"] = "error"
        add_log(job, "EROARE: " + str(e)[-900:])
        traceback.print_exc()
    emit(job)

def run_reburn(job, cap):
    st = job["stages"]
    report = make_report(job)
    t0 = time.time()
    try:
        add_log(job, "Randez din nou cu subtitrările editate...")
        project = core.save_project_captions(job["dir"], cap)
        name = core.render_final(job["dir"], project, report, source_url(job), asset_url(job))
        job["files"].update(final=name, srt="subtitrari.srt", txt="transcript.txt", captions=core.PROJECT_FILE)
        st[2].update(status="done", progress=100)
        job["media"] = "final"
        job["status"] = "done"
        job["error"] = None
        add_log(job, f"Subtitrările noi sunt arse ({time.time() - t0:.0f} secunde).")
        save_job_meta(job)
    except Exception as e:
        job["status"] = "error"
        job["error"] = friendly(e)
        st[2]["status"] = "error"
        add_log(job, "EROARE: " + str(e)[-900:])
        traceback.print_exc()
    emit(job)

def run_variants(job, payload):
    """Randeaza pe rand variantele de carlig salvate in proiect: varianta_A.mp4, varianta_B.mp4..."""
    st = job["stages"]
    report = make_report(job)
    t0 = time.time()
    try:
        project = core.load_project(job["dir"])
        hooks = project.get("hooks") or []
        keep = {f"varianta_{h['label']}.mp4" for h in hooks}
        for old in Path(job["dir"]).glob("varianta_*.mp4"):         # variantele sterse dispar si din folder
            if old.name not in keep:
                core.remove_file(old)
        for k in [k for k in job["files"] if k.startswith("var_")]:
            job["files"].pop(k)
        for i, v in enumerate(hooks, 1):
            add_log(job, f"Randez varianta {v['label']} ({i} din {len(hooks)})...")
            st[2].update(status="active", progress=0, detail=f"Varianta {v['label']} · {i} din {len(hooks)}")
            emit(job)
            name = core.render_variant(job["dir"], project, v, report, source_url(job), asset_url(job),
                                       captions=job["settings"].get("burn_captions", True))
            job["files"][f"var_{v['label']}"] = name
            emit(job)
        st[2].update(status="done", progress=100, detail=f"{len(hooks)} variante gata")
        job["status"], job["error"] = "done", None
        add_log(job, f"Variantele de cârlig sunt gata ({time.time() - t0:.0f} secunde): "
                     + ", ".join(f"varianta_{h['label']}.mp4" for h in hooks))
        if job["files"].get("caption_txt"):
            add_log(job, f"Captionul tău e în {assistant.CAPTION_FILE}, în același folder cu variantele.")
        save_job_meta(job)
    except Exception as e:
        job["status"] = "error"
        job["error"] = friendly(e)
        st[2]["status"] = "error"
        add_log(job, "EROARE: " + str(e)[-900:])
        traceback.print_exc()
    emit(job)

def worker():
    while True:
        kind, jid, payload = work_q.get()
        job = jobs.get(jid)
        if not job:
            continue
        if kind == "process" and job["status"] == "queued":
            run_job(job)
        elif kind == "reburn":
            run_reburn(job, payload)
        elif kind == "timeline":
            run_timeline(job, payload)
        elif kind == "variants":
            run_variants(job, payload)

def init_device():
    try:
        state["device"] = core.device_status()
    except Exception as e:
        state["device"] = {"mode": "cpu", "label": "Procesor", "hint": str(e)[:200]}
    hub.publish({"type": "device", "device": state["device"]})


# ------------------------------------------------------------ bibliotecile: sunete + poze si clipuri (folderele tale)
LIB_FILE = ROOT / "biblioteci.json"
LIB_KINDS = {"sfx": core.AUDIO_EXT, "media": core.IMAGE_EXT | core.VIDEO_EXT}
LIB_URL = {"sfx": "sfx", "medialib": "media"}          # prefixul din adresa -> tipul bibliotecii

def libs_load():
    try:
        d = json.loads(LIB_FILE.read_text(encoding="utf-8"))
    except Exception:
        d = {}
    return {k: [p for p in d.get(k, []) if isinstance(p, str)] for k in LIB_KINDS}

def libs_save(d):
    LIB_FILE.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")

def lib_scan(kind):
    libs, items, ext = libs_load()[kind], [], LIB_KINDS[kind]
    for li, root in enumerate(libs):
        base = Path(root)
        if not base.is_dir():
            continue
        for dirpath, dirs, files in os.walk(base):
            dirs.sort(key=str.lower)
            for f in sorted(files, key=str.lower):
                full = Path(dirpath) / f
                if full.suffix.lower() not in ext:
                    continue
                rel = full.relative_to(base).as_posix()
                cat = Path(rel).parent.as_posix()
                it = {"lib": li, "rel": rel, "name": full.stem, "cat": base.name if cat == "." else cat.replace("/", " › ")}
                if kind == "media":
                    it["type"] = "image" if full.suffix.lower() in core.IMAGE_EXT else "video"
                items.append(it)
                if len(items) >= 5000:
                    break
    return {"libs": [{"path": p, "name": Path(p).name or p, "ok": Path(p).is_dir()} for p in libs], "items": items}

def lib_file(kind, lib, rel):
    """Fisierul dintr-o biblioteca, doar daca e cu adevarat in interiorul ei."""
    libs = libs_load()[kind]
    try:
        base = Path(libs[int(lib)]).resolve()
        f = (base / rel).resolve()
    except (ValueError, IndexError, OSError, TypeError):
        return None
    if base not in f.parents or not f.is_file() or f.suffix.lower() not in LIB_KINDS[kind]:
        return None
    return f

sfx_scan = lambda: lib_scan("sfx")

def lib_names(kind):
    """Lista pentru Claude: „categorie / nume” (+ tipul, la poze si clipuri)."""
    return [f"{it['cat']} / {it['name']}" + (f" ({'poză' if it['type'] == 'image' else 'clip'})" if kind == "media" else "")
            for it in lib_scan(kind)["items"]]

def copy_to_assets(job, f):
    """Copiaza un fisier din biblioteca in folderul proiectului (o singura data, chiar daca il folosesti de mai multe ori)."""
    import shutil
    adir = Path(job["dir"]) / core.ASSETS
    adir.mkdir(exist_ok=True)
    dst = adir / safe_name(f.name, "fisier" + f.suffix)
    if not (dst.exists() and dst.stat().st_size == f.stat().st_size):
        dst = unique_path(dst)
        shutil.copyfile(f, dst)
    return dst

def pick_folder(title):
    """Fereastra Windows de alegere a unui folder (intr-un proces separat)."""
    import tempfile
    out = Path(tempfile.gettempdir()) / "bv_folder_ales.txt"
    out.unlink(missing_ok=True)
    exe = Path(sys.executable)
    if exe.name.lower() == "pythonw.exe" and exe.with_name("python.exe").exists():
        exe = exe.with_name("python.exe")
    code = ("import sys,tkinter as tk;from tkinter import filedialog;r=tk.Tk();r.withdraw();r.attributes('-topmost',True);"
            "p=filedialog.askdirectory(title=sys.argv[2]);open(sys.argv[1],'w',encoding='utf-8').write(p or '')")
    try:
        import subprocess
        subprocess.run([str(exe), "-c", code, str(out), title], timeout=900, creationflags=core.NO_WINDOW)
        return out.read_text(encoding="utf-8").strip() if out.exists() else ""
    except Exception:
        return ""


# ------------------------------------------------------------ server
def open_folder(path):
    path = str(path)
    if os.name == "nt":
        os.startfile(path)  # noqa
    elif sys.platform == "darwin":
        os.system(f'open "{path}"')
    else:
        os.system(f'xdg-open "{path}" >/dev/null 2>&1 &')

class Handler(BaseHTTPRequestHandler):
    server_version = "BioVitalityEditor/1.0"

    def log_message(self, *args):
        pass

    # -------- raspunsuri
    def _json(self, obj, status=200):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def _send_file(self, path: Path, ctype=None, download_name=None):
        if not path or not path.is_file():
            return self._json({"error": "Fișierul nu există (încă)."}, 404)
        size = path.stat().st_size
        ctype = ctype or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        start, end, status = 0, size - 1, 200
        rng = self.headers.get("Range")
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1):
                    start = int(m.group(1))
                    # cereri deschise ("bytes=N-") -> raspund cu bucati de 16 MB, ca playerele sa nu tina
                    # conexiunea ocupata (browserul are doar 6 conexiuni spre aplicatie)
                    end = min(int(m.group(2)), size - 1) if m.group(2) else min(size - 1, start + CHUNK - 1)
                elif m.group(2):
                    start = max(0, size - int(m.group(2)))
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
                status = 206
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "no-store")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        if download_name:
            q = urllib.parse.quote(download_name)
            self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{q}")
        self.end_headers()
        # fisierul se deschide doar cat citesc o bucata, nu cat asteapta browserul: pe Windows un fisier deschis
        # nu poate fi inlocuit sau sters (previzualizarea cu sunetul nou, decuparile vechi, variantele)
        pos, left = start, end - start + 1
        try:
            while left > 0:
                with open(path, "rb") as f:
                    f.seek(pos)
                    chunk = f.read(min(256 * 1024, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                pos += len(chunk)
                left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except OSError:                     # fisierul tocmai a fost inlocuit / sters
            pass

    # -------- GET
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        parts = [urllib.parse.unquote(p) for p in path.strip("/").split("/")]
        if path in ("/", "/index.html"):
            b = UI_FILE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b)
        elif path == "/api/ping":
            self._json({"app": APP_ID})
        elif path == "/api/events":
            self._sse()
        elif len(parts) == 2 and parts[0] == "static" and parts[1] in STATIC_FILES:
            f = ROOT / "static" / parts[1]
            b = f.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", STATIC_FILES[parts[1]])
            self.send_header("Content-Length", str(len(b)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b)
        elif len(parts) == 2 and parts[0] == "api" and parts[1] in LIB_URL:
            self._json(lib_scan(LIB_URL[parts[1]]))
        elif len(parts) >= 3 and parts[0] in LIB_URL:
            f = lib_file(LIB_URL[parts[0]], parts[1], "/".join(parts[2:]))
            if not f:
                return self._json({"error": "nu există"}, 404)
            self._send_file(f)
        elif len(parts) == 3 and parts[:2] == ["api", "project"]:
            job = self._job_with_project(parts[2])
            if not job:
                return
            pr = core.load_project(job["dir"])
            adir = Path(job["dir"]) / core.ASSETS
            assets = [core.asset_info(f) for f in sorted(adir.iterdir()) if not f.name.startswith("_decupat_")] if adir.is_dir() else []
            pr["look"] = core.clean_look(pr.get("look"))
            draft = None
            df = Path(job["dir"]) / DRAFT_FILE
            if df.exists() and df.stat().st_mtime > (Path(job["dir"]) / core.PROJECT_FILE).stat().st_mtime:
                try:
                    draft = json.loads(df.read_text(encoding="utf-8"))
                except ValueError:
                    draft = None
            self._json({"draft": draft, "project": {k: pr.get(k) for k in ("width", "height", "fps", "source_duration",
                                                           "segments", "captions", "overlays", "audio", "look", "zooms", "transitions",
                                                           "materials_pending", "vision")},
                        "vision_default": assistant.vision_default(),
                        "look_presets": core.COLOR_PRESETS, "look_default": core.load_default_look(),
                        "source": f"/media/{job['id']}/source", "asset_base": f"/asset/{job['id']}",
                        "assets": assets, "busy": job["status"] in ("running", "queued")})
        elif len(parts) == 3 and parts[:2] == ["api", "script"]:
            job = self._job_with_project(parts[2])
            if not job:
                return
            self._json(script_view(core.load_project(job["dir"])))
        elif path == "/api/cutout-status":
            import cutout
            self._json(cutout.status())
        elif len(parts) == 3 and parts[:2] == ["api", "publish"]:
            job = self._job_with_project(parts[2])
            if not job:
                return
            pr = core.load_project(job["dir"])
            f = job["files"]
            self._json({"pack": assistant.load_pack(job["dir"]), "hooks": pr.get("hooks") or [],
                        "caption": assistant.load_caption(job["dir"]),
                        "variants": {k[4:]: v for k, v in f.items() if k.startswith("var_")},
                        "cover": f"/media/{job['id']}/cover?v={int((Path(job['dir']) / core.COVER_FILE).stat().st_mtime)}"
                                 if f.get("cover") and (Path(job["dir"]) / core.COVER_FILE).exists() else None,
                        "busy": job["status"] in ("running", "queued")})
        elif len(parts) == 3 and parts[:2] == ["api", "preview"]:
            job = self._job_with_project(parts[2])
            if not job:
                return
            try:
                ok = core.make_preview(job["dir"], core.load_project(job["dir"]))
            except Exception:
                ok = None
            self._json({"url": f"/media/{job['id']}/preview" if ok else f"/media/{job['id']}/source"})
        elif len(parts) == 3 and parts[:2] == ["api", "filmstrip"]:
            job = self._job_with_project(parts[2])
            if not job:
                return
            try:
                meta = core.filmstrip(job["dir"], core.load_project(job["dir"]))
            except Exception as e:
                return self._json({"error": str(e)[:300]}, 500)
            self._json({**meta, "url": f"/media/{job['id']}/filmstrip"})
        elif len(parts) == 3 and parts[:2] == ["api", "waveform"]:
            job = self._job_with_project(parts[2])
            if not job:
                return
            try:
                self._json(core.waveform(job["dir"], core.load_project(job["dir"])))
            except Exception as e:
                self._json({"error": str(e)[:300]}, 500)
        elif len(parts) == 3 and parts[0] == "asset":
            job = jobs.get(parts[1])
            name = Path(parts[2]).name
            if not job or not job["dir"] or name != parts[2]:
                return self._json({"error": "nu există"}, 404)
            self._send_file(Path(job["dir"]) / core.ASSETS / name)
        elif len(parts) == 3 and parts[0] == "material":                 # materialele unui video inca nepornit
            job = jobs.get(parts[1])
            name = Path(parts[2]).name
            if not job or name != parts[2]:
                return self._json({"error": "nu există"}, 404)
            self._send_file(material_dir(job) / name)
        elif len(parts) == 2 and parts[0] == "fonts" and parts[1] in core.FONT_FILES:
            self._send_file(core.FONT_DIR / parts[1], "font/ttf")
        elif len(parts) == 3 and parts[:2] == ["api", "captions"]:
            job = jobs.get(parts[2])
            f = Path(job["dir"]) / core.PROJECT_FILE if job and job["dir"] else None
            if not f or not f.is_file() or not job["files"].get("captions"):
                return self._json({"error": "Nu există subtitrări pentru acest video."}, 404)
            self._json(core.project_captions_out(job["dir"]))
        elif len(parts) == 3 and parts[0] == "media":
            job = jobs.get(parts[1])
            if not job:
                return self._json({"error": "job necunoscut"}, 404)
            if parts[2] == "input":
                p = Path(job["path"])
            elif parts[2] == "sound" and job["dir"] and (Path(job["dir"]) / core.PROJECT_FILE).exists():
                try:
                    p = core.processed_audio(job["dir"], core.load_project(job["dir"]))
                except Exception:
                    p = None
            elif parts[2] == "preview" and job["dir"] and (Path(job["dir"]) / core.PREVIEW_FILE).exists():
                p = Path(job["dir"]) / core.PREVIEW_FILE
            elif parts[2] == "filmstrip" and job["dir"]:
                p = Path(job["dir"]) / "_filmstrip.jpg"
            elif parts[2] == "source" and job["dir"] and (Path(job["dir"]) / core.PROJECT_FILE).exists():
                p = core.project_source(job["dir"], core.load_project(job["dir"]))
            elif (parts[2] in ("cut", "final", "cover") or parts[2].startswith("var_")) and job["dir"] and job["files"].get(parts[2]):
                p = Path(job["dir"]) / job["files"][parts[2]]
            elif parts[2] == "cut" and job["dir"]:
                p = Path(job["dir"]) / "video_taiat.mp4"
            else:
                return self._json({"error": "nu există"}, 404)
            self._send_file(p)
        elif len(parts) == 3 and parts[0] == "download":
            job = jobs.get(parts[1])
            key = parts[2]
            if not job or key not in job["files"]:
                return self._json({"error": "nu există"}, 404)
            fname = job["files"][key]
            stem = Path(job["name"]).stem
            ext = Path(fname).suffix
            nice = f"{stem}{ext}" if key in ("srt", "txt") else f"{stem} - {Path(fname).stem}{ext}"
            self._send_file(Path(job["dir"]) / fname, download_name=nice)
        else:
            self._json({"error": "nu există"}, 404)

    def _sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        q = hub.subscribe()
        snap = {"type": "snapshot", "jobs": [public(jobs[j], True) for j in order if j in jobs],
                "device": state["device"], "out_dir": str(OUT_DIR),
                "fonts": [{k: f[k] for k in ("id", "label", "ratio", "files")} for f in core.FONTS],
                "caption_default": core.load_default_style(), "engine": core.remotion_status(),
                "templates": core.TEMPLATES, "assistant": assistant.status()}
        try:
            self.wfile.write(f"data: {json.dumps(snap, ensure_ascii=False)}\n\n".encode("utf-8"))
            self.wfile.flush()
            while True:
                try:
                    ev = q.get(timeout=15)
                    data = f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                except queue.Empty:
                    data = ": ping\n\n"
                self.wfile.write(data.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            hub.unsubscribe(q)

    # -------- POST
    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        parts = [urllib.parse.unquote(p) for p in path.strip("/").split("/")]
        if path == "/api/upload":
            return self._upload()
        if len(parts) == 3 and parts[:2] == ["api", "open"]:
            job = jobs.get(parts[2])
            if not job or not job["dir"] or not Path(job["dir"]).exists():
                return self._json({"error": "Folderul nu există încă."}, 404)
            open_folder(job["dir"])
            return self._json({"ok": True})
        if path == "/api/open-output":
            OUT_DIR.mkdir(exist_ok=True)
            open_folder(OUT_DIR)
            return self._json({"ok": True})
        if len(parts) == 3 and parts[:2] == ["api", "remove"]:
            job = jobs.get(parts[2])
            if job and job["status"] != "running":
                if job.get("dir") and (Path(job["dir"]) / JOB_META).exists():
                    try:
                        m = json.loads((Path(job["dir"]) / JOB_META).read_text(encoding="utf-8"))
                        m["hidden"] = True
                        (Path(job["dir"]) / JOB_META).write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
                    except (OSError, ValueError):
                        pass
                job["status"] = "removed"
                jobs.pop(job["id"], None)
                if job["id"] in order: order.remove(job["id"])
                hub.publish({"type": "removed", "id": job["id"]})
            return self._json({"ok": True})
        if len(parts) == 3 and parts[:2] == ["api", "redo"]:
            job = jobs.get(parts[2])
            if not job or not Path(job["path"]).exists():
                return self._json({"error": "Nu mai găsesc fișierul original."}, 404)
            try:
                raw = json.loads(urllib.parse.unquote(self.headers.get("X-Settings", "")) or "{}")
            except Exception:
                raw = {}
            raw = {**raw, **{k: job["settings"].get(k) for k in
                             ("script", "script_captions", "script_retakes", "script_offscript")}}
            new_job = create_job(job["name"], Path(job["path"]), core.merge_settings(raw))
            emit(new_job)
            work_q.put(("process", new_job["id"], None))
            return self._json({"id": new_job["id"]})
        if len(parts) == 3 and parts[:2] == ["api", "captions"]:
            job = jobs.get(parts[2])
            if not job or not job["dir"] or job["status"] in ("running", "queued"):
                return self._json({"error": "Video-ul e încă în lucru."}, 409)
            body = self._read_json()
            if body is None:
                return self._json({"error": "Date invalide."}, 400)
            cap = core.clean_captions(body)
            if not cap["cues"]:
                return self._json({"error": "Nu a rămas nicio frază de ars."}, 400)
            job["status"] = "running"
            job["stage"] = 3
            job["stages"][2].update(status="active", progress=0, detail="La rând pentru randare…")
            emit(job)
            work_q.put(("reburn", job["id"], cap))
            return self._json({"ok": True})
        if len(parts) == 3 and parts[:2] == ["api", "timeline-draft"]:
            job = jobs.get(parts[2])
            if not job or not job["dir"]:
                return self._json({"error": "nu există"}, 404)
            df = Path(job["dir"]) / DRAFT_FILE
            body = self._read_json(limit=16 * 1024 * 1024)
            if body is None or body.get("discard"):
                df.unlink(missing_ok=True)
                return self._json({"ok": True, "discarded": True})
            body["saved_at"] = time.time()
            tmp = df.with_suffix(".tmp")
            tmp.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
            tmp.replace(df)                      # scriere sigura: niciodata o ciorna pe jumatate
            return self._json({"ok": True, "saved_at": body["saved_at"]})
        if len(parts) == 3 and parts[:2] == ["api", "timeline"]:
            job = jobs.get(parts[2])
            if not job or not job["dir"] or job["status"] in ("running", "queued"):
                return self._json({"error": "Video-ul e încă în lucru."}, 409)
            body = self._read_json()
            if not isinstance(body, dict):
                return self._json({"error": "Date invalide."}, 400)
            (Path(job["dir"]) / DRAFT_FILE).unlink(missing_ok=True)
            job["status"], job["stage"] = "running", 1
            job["stages"][0].update(status="active", progress=0, detail="La rând…")
            job["stages"][2].update(status="pending", progress=0, detail="")
            emit(job)
            work_q.put(("timeline", job["id"], body))
            return self._json({"ok": True})
        if len(parts) == 3 and parts[:2] == ["api", "draft"]:
            job = jobs.get(parts[2])
            body = self._read_json()
            if job and job["status"] == "draft" and isinstance(body, dict):
                if "script" in body:
                    job["draft"] = {**job["draft"], "script": str(body.get("script", ""))[:30000]}
                if isinstance(body.get("materials"), list):
                    job["draft"]["materials"] = clean_materials(job, body["materials"])
                    emit(job)
            return self._json({"ok": True})
        if path == "/api/start" or (len(parts) == 3 and parts[:2] == ["api", "start"]):
            body = self._read_json() or {}
            settings = body.get("settings") if isinstance(body.get("settings"), dict) else {}
            ids = [parts[2]] if len(parts) == 3 else [j for j in order if jobs.get(j, {}).get("status") == "draft"]
            started = []
            for jid in ids:
                job = jobs.get(jid)
                if not job or job["status"] != "draft":
                    continue
                script = body.get("script") if len(parts) == 3 and isinstance(body.get("script"), str) else job["draft"].get("script", "")
                cfg = core.merge_settings({**settings, "script": script})
                job.update(settings=cfg, settings_view=core.settings_summary(cfg), status="queued")
                job["draft"] = {**job["draft"], "script": cfg["script"]}
                emit(job)
                work_q.put(("process", jid, None))
                started.append(jid)
            if not started:
                return self._json({"error": "Nu e niciun video pregătit de pornit."}, 409)
            return self._json({"ok": True, "started": started})
        if len(parts) == 3 and parts[:2] == ["api", "asset"]:
            return self._upload_asset(parts[2])
        if len(parts) >= 3 and parts[0] == "api" and parts[1] in LIB_URL:      # /api/sfx/... si /api/medialib/...
            kind = LIB_URL[parts[1]]
            what = "sunete" if kind == "sfx" else "poze și clipuri"
            if parts[2] == "pick":
                p = pick_folder(f"Alege folderul cu {what}")
                return self._json({"path": p} if p else {"error": "Nu am putut deschide fereastra de alegere. Lipește calea folderului în căsuță."})
            if parts[2] == "folder":
                body = self._read_json() or {}
                p = str(body.get("path", "")).strip().strip('"')
                if not p or not Path(p).is_dir():
                    return self._json({"error": "Nu găsesc folderul acesta. Verifică calea."}, 400)
                d = libs_load()
                if str(Path(p)) not in [str(Path(x)) for x in d[kind]]:
                    d[kind].append(str(Path(p)))
                    libs_save(d)
                return self._json(lib_scan(kind))
            if parts[2] == "remove":
                body = self._read_json() or {}
                d = libs_load()
                try:
                    d[kind].pop(int(body.get("index")))
                    libs_save(d)
                except (ValueError, IndexError, TypeError):
                    pass
                return self._json(lib_scan(kind))
            if parts[2] == "use" and len(parts) == 4:
                job = jobs.get(parts[3])
                body = self._read_json() or {}
                f = lib_file(kind, body.get("lib", -1), str(body.get("rel", "")))
                if not job or not job["dir"] or not f:
                    return self._json({"error": "Nu găsesc fișierul în bibliotecă."}, 404)
                return self._json(core.asset_info(copy_to_assets(job, f)))
        if path == "/api/assistant/config":
            body = self._read_json() or {}
            try:
                st = assistant.save_config(body.get("key") if "key" in body else None, body.get("model"))
            except assistant.AssistantError as e:
                return self._json({"error": str(e)}, 400)
            hub.publish({"type": "assistant", "status": st})
            return self._json(st)
        if len(parts) == 3 and parts[:2] == ["api", "broll-prompt"]:
            job = jobs.get(parts[2])
            if not job or not job["dir"] or not (Path(job["dir"]) / core.PROJECT_FILE).exists():
                return self._json({"error": "Proiectul nu există încă."}, 404)
            body = self._read_json() or {}
            try:
                res = assistant.broll_prompt(core.load_project(job["dir"]), body.get("state") or {},
                                             str(body.get("idea", ""))[:300], body.get("start", 0), body.get("end", 0))
            except assistant.AssistantError as e:
                return self._json({"error": str(e)}, 400)
            return self._json(res)
        if len(parts) == 3 and parts[:2] in (["api", "publish-pack"], ["api", "hooks-propose"]):
            job = self._job_with_project(parts[2])
            if not job:
                return
            body = self._read_json() or {}
            try:
                pr = core.load_project(job["dir"])
                if parts[1] == "hooks-propose":
                    return self._json(assistant.propose_hooks(pr, body.get("state") or {}))
                res = assistant.publish_pack(pr, body.get("state") or {}, body.get("platforms"), str(body.get("note") or ""),
                                             assistant.load_caption(job["dir"]))
                res["pack"] = assistant.save_pack(job["dir"], res, job["name"])
                job["files"]["pack"] = "publicare.txt"
                save_job_meta(job)
                return self._json(res)
            except assistant.AssistantError as e:
                return self._json({"error": str(e)}, 400)
            except Exception as e:
                traceback.print_exc()
                return self._json({"error": f"Ceva n-a mers: {str(e)[:200]}"}, 500)
        if len(parts) == 3 and parts[:2] == ["api", "publish-save"]:
            job = self._job_with_project(parts[2])
            if not job:
                return
            body = self._read_json() or {}
            pack = assistant.save_pack(job["dir"], body.get("pack"), job["name"])
            job["files"]["pack"] = "publicare.txt"
            return self._json({"pack": pack})
        if len(parts) == 3 and parts[:2] == ["api", "script"]:
            # alegi alta dubla pentru o fraza din script (sau o scoti): bucatile si subtitrarile noi merg in Timeline
            job = self._job_with_project(parts[2])
            if not job:
                return
            body = self._read_json() or {}
            pr = core.load_project(job["dir"])
            if isinstance(body.get("chosen"), list) and pr.get("script_align"):    # alegerea curenta din Timeline (nesalvata)
                pr["script_align"]["chosen"] = {str(i): v for i, v in enumerate(body["chosen"]) if isinstance(v, int)}
            try:
                k = int(body.get("unit"))
                idx = None if body.get("take") is None else int(body.get("take"))
                pr = core.script_choose(pr, k, idx)
            except (TypeError, ValueError, RuntimeError) as e:
                return self._json({"error": str(e) if isinstance(e, RuntimeError) else "Date invalide."}, 400)
            return self._json({**script_view(pr), "segments": pr["segments"], "captions": pr.get("captions")})
        if len(parts) == 3 and parts[:2] == ["api", "autocut"]:
            # taie automat pauzele doar unde alegi (o bucata, un interval sau tot video-ul)
            job = self._job_with_project(parts[2])
            if not job:
                return
            body = self._read_json() or {}
            pr = core.load_project(job["dir"])
            try:
                segs = [[float(a), float(b)] for a, b in body.get("segments") or pr["segments"]]
                a, b = float(body.get("start", 0)), float(body.get("end", 1e9))
                cfg = core.merge_settings({**(pr.get("settings") or {}), **(body.get("settings") or {})})
                speech = core.speech_segments(job["dir"], pr, cfg)
            except (TypeError, ValueError):
                return self._json({"error": "Date invalide."}, 400)
            except Exception as e:
                traceback.print_exc()
                return self._json({"error": f"Nu am putut găsi pauzele: {str(e)[:200]}"}, 500)
            new = core.cut_pauses(segs, a, b, speech)
            return self._json({"segments": new, "removed": round(core.seg_total(segs) - core.seg_total(new), 2)})
        if len(parts) == 3 and parts[:2] == ["api", "cutout"]:
            # clipul cu tine decupat pentru o portiune (make = il face acum; altfel spune doar daca e gata)
            import cutout
            job = self._job_with_project(parts[2])
            if not job:
                return
            body = self._read_json() or {}
            pr = core.load_project(job["dir"])
            try:
                a, b = float(body.get("start", 0)), float(body.get("end", 0))
                segs = core.clean_segments(body.get("segments"), float(pr.get("source_duration") or 1e6)) or pr["segments"]
            except (TypeError, ValueError):
                return self._json({"error": "Date invalide."}, 400)
            f, _ = cutout.clip_for(job["dir"], pr, a, b, segs)
            if body.get("make") and not f.exists():
                st = cutout.status()
                if not st["ok"]:
                    return self._json({"error": st["hint"]}, 400)
                try:
                    f = cutout.make_clip(job["dir"], pr, a, b, segs)
                except Exception as e:
                    traceback.print_exc()
                    return self._json({"error": f"Decuparea n-a mers: {str(e)[:200]}"}, 500)
            return self._json({"ready": f.exists(), "url": f"/asset/{job['id']}/{urllib.parse.quote(f.name)}" if f.exists() else None})
        if len(parts) == 3 and parts[:2] == ["api", "caption-text"]:
            job = self._job_with_project(parts[2])
            if not job:
                return
            body = self._read_json() or {}
            text = assistant.save_caption(job["dir"], body.get("text"))
            if text:
                job["files"]["caption_txt"] = assistant.CAPTION_FILE
            else:
                job["files"].pop("caption_txt", None)
            pack = assistant.load_pack(job["dir"])
            if pack:                                  # publicare.txt are captionul sus
                assistant.save_pack(job["dir"], pack, job["name"])
            emit(job)
            return self._json({"ok": True, "text": text})
        if len(parts) == 3 and parts[:2] == ["api", "cover"]:
            job = self._job_with_project(parts[2])
            if not job:
                return
            body = self._read_json() or {}
            try:
                f = core.make_cover(job["dir"], core.load_project(job["dir"]), body.get("t", 0),
                                    str(body.get("title") or "")[:80], str(body.get("subtitle") or "")[:100])
            except Exception as e:
                traceback.print_exc()
                return self._json({"error": str(e)[:300]}, 500)
            job["files"]["cover"] = core.COVER_FILE
            save_job_meta(job)
            return self._json({"url": f"/media/{job['id']}/cover?v={int(f.stat().st_mtime * 1000)}"})
        if len(parts) == 3 and parts[:2] == ["api", "hooks"]:
            job = self._job_with_project(parts[2])
            if not job:
                return
            if job["status"] in ("running", "queued"):
                return self._json({"error": "Video-ul e încă în lucru. Așteaptă să se termine."}, 409)
            body = self._read_json() or {}
            pr = core.load_project(job["dir"])
            pr["hooks"] = core.clean_hooks(body.get("hooks"), float(pr.get("source_duration") or 1e6))
            core.save_project(job["dir"], pr)
            if body.get("render"):
                if not pr["hooks"]:
                    return self._json({"error": "Nu e nicio variantă de randat."}, 400)
                job["status"], job["stage"] = "running", 3
                job["stages"][2].update(status="active", progress=0, detail="La rând pentru variante…")
                emit(job)
                work_q.put(("variants", job["id"], None))
            return self._json({"hooks": pr["hooks"]})
        if len(parts) == 3 and parts[:2] == ["api", "propose"]:
            job = jobs.get(parts[2])
            if not job or not job["dir"] or not (Path(job["dir"]) / core.PROJECT_FILE).exists():
                return self._json({"error": "Proiectul nu există încă."}, 404)
            body = self._read_json() or {}
            names = [f"{it['cat']} / {it['name']}" for it in sfx_scan()["items"]]
            vision = str(body.get("vision") or "")[:3000]
            pr = core.load_project(job["dir"])
            if vision != (pr.get("vision") or ""):          # directia ramane la video (o regasesti cand revii)
                pr["vision"] = vision
                core.save_project(job["dir"], pr)
            if body.get("vision_default"):
                assistant.save_vision_default(vision)
            try:
                res = assistant.propose(pr, body.get("state") or {}, names, lib_names("media"), vision)
            except assistant.AssistantError as e:
                return self._json({"error": str(e)}, 400)
            except Exception as e:
                traceback.print_exc()
                return self._json({"error": f"Ceva n-a mers: {str(e)[:200]}"}, 500)
            return self._json(res)
        if len(parts) == 3 and parts[:2] == ["api", "assistant"]:
            job = jobs.get(parts[2])
            if not job or not job["dir"] or not (Path(job["dir"]) / core.PROJECT_FILE).exists():
                return self._json({"error": "Proiectul nu există încă."}, 404)
            body = self._read_json()
            if not isinstance(body, dict):
                return self._json({"error": "Date invalide."}, 400)
            try:
                res = assistant.ask(core.load_project(job["dir"]), body.get("state") or {}, body.get("messages") or [])
            except assistant.AssistantError as e:
                return self._json({"error": str(e)}, 400)
            except Exception as e:
                traceback.print_exc()
                return self._json({"error": f"Ceva n-a mers: {str(e)[:200]}"}, 500)
            return self._json(res)
        if len(parts) == 3 and parts[:2] == ["api", "look-audio"]:
            job = self._job_with_project(parts[2])
            if not job:
                return
            body = self._read_json() or {}
            pr = core.load_project(job["dir"])
            pr["look"] = core.clean_look({"color": (pr.get("look") or {}).get("color"), "audio": body.get("audio")})
            try:
                core.preview_audio_sync(job["dir"], pr)       # doar pentru ascultare; se salveaza in proiect la „Salveaza si randeaza”
            except Exception as e:
                return self._json({"error": str(e)[:300]}, 500)
            return self._json({"url": f"/media/{job['id']}/preview?v={int(time.time())}"})
        if path == "/api/look-default":
            body = self._read_json()
            if not isinstance(body, dict):
                return self._json({"error": "Date invalide."}, 400)
            return self._json({"ok": True, "look": core.save_default_look(body)})
        if path == "/api/caption-style-default":
            body = self._read_json()
            if body is None:
                return self._json({"error": "Date invalide."}, 400)
            st = core.save_default_style(body)
            hub.publish({"type": "caption_default", "style": st})
            return self._json({"ok": True, "style": st})
        if path == "/api/shutdown":
            self._json({"ok": True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        self._json({"error": "nu există"}, 404)

    def _read_json(self, limit=8 * 1024 * 1024):
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > limit:
                return None
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return None

    def _job_with_project(self, jid):
        job = jobs.get(jid)
        if not job or not job["dir"] or not (Path(job["dir"]) / core.PROJECT_FILE).exists():
            self._json({"error": "Proiectul nu există încă."}, 404)
            return None
        return job

    def _upload_asset(self, jid):
        job = jobs.get(jid)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        name = Path(urllib.parse.unquote(self.headers.get("X-Filename", "fisier")).replace("\\", "/")).name
        draft = bool(job) and job["status"] == "draft"          # materialele urcate odata cu video-ul, inainte de procesare
        ok = job and (job["dir"] or draft) and Path(name).suffix.lower() in core.ASSET_EXT and 0 < length < 4 * 1024 ** 3
        adir = (material_dir(job) if draft else Path(job["dir"]) / core.ASSETS) if ok else None
        if adir:
            adir.mkdir(parents=True, exist_ok=True)
        dst = unique_path(adir / safe_name(name, "fisier")) if ok else None
        left = length
        f = open(dst, "wb") if dst else None
        try:
            while left > 0:
                chunk = self.rfile.read(min(1 << 20, left))
                if not chunk:
                    break
                if f: f.write(chunk)
                left -= len(chunk)
        finally:
            if f: f.close()
        if not ok:
            return self._json({"error": f"„{name}” nu e o poză sau un video suportat."}, 400)
        if left > 0:
            dst.unlink(missing_ok=True)
            return self._json({"error": "Încărcarea s-a întrerupt."}, 400)
        try:
            return self._json(core.asset_info(dst))
        except Exception as e:
            return self._json({"error": f"Nu pot citi fișierul: {e}"}, 400)

    def _upload(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        raw = urllib.parse.unquote(self.headers.get("X-Filename", "video.mp4"))
        name = Path(raw.replace("\\", "/")).name or "video.mp4"
        try:
            cfg = core.merge_settings(json.loads(urllib.parse.unquote(self.headers.get("X-Settings", "")) or "{}"))
        except Exception:
            cfg = core.merge_settings({})
        ok_type = Path(name).suffix.lower() in core.VIDEO_EXT
        IN_DIR.mkdir(exist_ok=True)
        dst = unique_path(IN_DIR / safe_name(name, "video.mp4")) if ok_type else None
        left = length
        try:
            f = open(dst, "wb") if dst else None
            while left > 0:
                chunk = self.rfile.read(min(1 << 20, left))
                if not chunk:
                    break
                if f: f.write(chunk)
                left -= len(chunk)
            if f: f.close()
        except Exception as e:
            return self._json({"error": f"Nu am putut salva fișierul: {e}"}, 500)
        if not ok_type:
            return self._json({"error": f"„{name}” nu e un format video suportat."}, 400)
        if left > 0 or length == 0:
            dst.unlink(missing_ok=True)
            return self._json({"error": "Încărcarea s-a întrerupt."}, 400)
        auto = cfg.get("auto_start")
        job = create_job(name, dst, cfg, "queued" if auto else "draft")
        emit(job)
        if auto:
            work_q.put(("process", job["id"], None))
        self._json({"id": job["id"]})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # pe Windows SO_REUSEADDR ar lasa doua aplicatii pe acelasi port; pe Linux/Mac e sigur si evita blocajul la repornire
    allow_reuse_address = os.name != "nt"


def is_our_app(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=1.5) as r:
            return json.load(r).get("app") == APP_ID
    except Exception:
        return False

def main():
    IN_DIR.mkdir(exist_ok=True)
    OUT_DIR.mkdir(exist_ok=True)
    srv, port = None, None
    for p in range(BASE_PORT, BASE_PORT + 15):
        try:
            srv, port = Server(("127.0.0.1", p), Handler), p
            break
        except OSError:
            if is_our_app(p):
                print("Aplicatia ruleaza deja - deschid fereastra.", flush=True)
                webbrowser.open(f"http://127.0.0.1:{p}")
                return
    if not srv:
        print("Nu am gasit un port liber.", flush=True)
        return
    url = f"http://127.0.0.1:{port}"
    BASE["url"] = url
    n = load_existing_projects()
    if n:
        print(f"Am reincarcat {n} proiecte din output.", flush=True)
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=init_device, daemon=True).start()
    print(f"BioVitality Editor ruleaza la {url}", flush=True)
    if not os.environ.get("BV_NO_BROWSER"):
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    print("Aplicatia s-a oprit.", flush=True)

if __name__ == "__main__":
    main()
