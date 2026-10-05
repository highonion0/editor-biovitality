# -*- coding: utf-8 -*-
"""
BioVitality Editor - decuparea (te scoate din fundal, ca efectul green screen de pe TikTok).

Modelul: RobustVideoMatting (MobileNetV3, ~15 MB, ONNX), facut pentru video cu oameni: marginile nu „palpaie”
de la un cadru la altul. Ruleaza local, pe placa NVIDIA daca e instalata (onnxruntime-gpu), altfel pe procesor.
Licenta modelului: GPL-3.0 (folosire libera, inclusiv comerciala; conteaza doar daca aplicatia ar fi distribuita altora).

Se decupeaza DOAR portiunea in care esti „🧍 Tu peste el” cu forma „✂ Decupat”, nu tot video-ul:
iese un clip WebM cu fundal transparent (VP9 + alfa), folosit de previzualizare, Remotion si motorul clasic.
"""

import hashlib
import json
import subprocess
import urllib.request
from pathlib import Path

import core

MODEL_DIR = core.APP_DIR / "modele"
MODEL = MODEL_DIR / "rvm_mobilenetv3_fp32.onnx"
MODEL_URL = "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx"
MAX_W = 1080                     # decupez la cel mult 1080 px latime (4K ar fi de 4 ori mai lent, fara folos in fereastra)
_session = {}


def download_model(progress=print):
    """Descarca modelul o singura data (folosit de instaleaza_decupare.bat)."""
    MODEL_DIR.mkdir(exist_ok=True)
    if MODEL.exists() and MODEL.stat().st_size > 1_000_000:
        progress("Modelul de decupare e deja descărcat.")
        return MODEL
    tmp = MODEL.with_suffix(".tmp")
    with urllib.request.urlopen(MODEL_URL, timeout=120) as r, open(tmp, "wb") as f:
        total, done = int(r.headers.get("Content-Length") or 0), 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if total:
                progress(f"  {done * 100 // total}%")
    tmp.replace(MODEL)
    progress("Modelul de decupare e gata.")
    return MODEL


def status():
    if not MODEL.exists():
        return {"ok": False, "hint": "Decuparea nu e instalată încă. Rulează „instaleaza_decupare.bat” (o singură dată)."}
    try:
        import onnxruntime as ort
    except Exception:
        return {"ok": False, "hint": "Lipsește onnxruntime. Rulează din nou „instaleaza_decupare.bat”."}
    gpu = "CUDAExecutionProvider" in ort.get_available_providers()
    return {"ok": True, "gpu": gpu, "label": "pe placa video" if gpu else "pe procesor (mai lent)"}


def _sess():
    if "s" not in _session:
        import onnxruntime as ort
        try:
            if hasattr(ort, "preload_dlls"):
                ort.preload_dlls()              # DLL-urile NVIDIA instalate prin pip (cuDNN, cuBLAS...)
        except Exception:
            pass
        provs = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
        try:
            _session["s"] = ort.InferenceSession(str(MODEL), providers=provs)
        except Exception:
            _session["s"] = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    return _session["s"]


def clip_name(project, pieces):
    key = json.dumps([str(project.get("source")), [[round(a, 3), round(b, 3)] for a, b in pieces]])
    return f"_decupat_{hashlib.md5(key.encode()).hexdigest()[:10]}.webm"


def clip_for(job_dir, project, start, end, segments=None):
    """Clipul decupat pentru intervalul [start, end] de pe timeline-ul final: (cale, bucatile din sursa)."""
    pieces = core.out_range_to_src(start, end, segments if segments is not None else project["segments"])
    return Path(job_dir) / core.ASSETS / clip_name(project, pieces), pieces


def make_clip(job_dir, project, start, end, segments=None, report=None):
    """Face (o singura data) clipul cu tine decupat pe portiunea [start, end]. Intoarce calea lui."""
    import numpy as np
    job_dir = Path(job_dir)
    out, pieces = clip_for(job_dir, project, start, end, segments)
    if out.exists() and out.stat().st_size > 1000:
        return out
    if not pieces:
        raise RuntimeError("Porțiunea aleasă nu are video.")
    out.parent.mkdir(exist_ok=True)
    src = core.project_source(job_dir, project)
    W, H, fps = project["width"], project["height"], project.get("fps") or 30
    tw = min(W, MAX_W) // 2 * 2
    th = int(round(H * tw / W)) // 2 * 2
    ratio = 0.25 if th >= 1280 else 0.4          # cat de mic vede modelul cadrul pentru forma generala (recomandat RVM)
    sess = _sess()
    tmp = out.with_suffix(".tmp.webm")
    enc = subprocess.Popen([core.find_tool("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error",
                            "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{tw}x{th}", "-r", str(fps), "-i", "-",
                            "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30",
                            "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-auto-alt-ref", "0", str(tmp)],
                           stdin=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=core.NO_WINDOW)
    total = max(1, int(sum(b - a for a, b in pieces) * fps))
    done, size = 0, tw * th * 3
    try:
        for a, b in pieces:
            rec = [np.zeros((1, 1, 1, 1), np.float32)] * 4     # bucata noua din sursa: modelul o ia de la capat
            dec = subprocess.Popen([core.find_tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-ss", f"{a:.3f}",
                                    "-t", f"{b - a:.3f}", "-i", str(src), "-vf", f"fps={fps},scale={tw}:{th}",
                                    "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                                   stdout=subprocess.PIPE, creationflags=core.NO_WINDOW)
            while True:
                buf = dec.stdout.read(size)
                if len(buf) < size:
                    break
                img = np.frombuffer(buf, np.uint8).reshape(th, tw, 3)
                x = np.ascontiguousarray(img.transpose(2, 0, 1)[None], dtype=np.float32) / 255.0
                fgr, pha, *rec = sess.run(None, {"src": x, "r1i": rec[0], "r2i": rec[1], "r3i": rec[2], "r4i": rec[3],
                                                 "downsample_ratio": np.array([ratio], np.float32)})
                rgb = (fgr[0].transpose(1, 2, 0) * 255).clip(0, 255).astype(np.uint8)   # culoarea fara „scurgeri” din fundal
                alpha = (pha[0, 0] * 255).clip(0, 255).astype(np.uint8)
                enc.stdin.write(np.dstack([rgb, alpha]).tobytes())
                done += 1
                if report and done % 15 == 0:
                    report(min(99.0, done * 100 / total))
            dec.stdout.close()
            dec.wait()
        enc.stdin.close()
        err = enc.stderr.read().decode("utf-8", "replace")
        if enc.wait() != 0 or not tmp.exists():
            raise RuntimeError("Nu am putut salva clipul decupat. " + err[-300:])
    except Exception:
        try:
            enc.kill()
        except Exception:
            pass
        tmp.unlink(missing_ok=True)
        raise
    tmp.replace(out)
    for old in out.parent.glob("_decupat_*.webm"):     # pastrez doar decuparile folosite in proiect
        if old != out and not _in_use(job_dir, old.name):
            old.unlink(missing_ok=True)
    return out


def _in_use(job_dir, name):
    try:
        pr = core.load_project(job_dir)
    except Exception:
        return True
    for o in pr.get("overlays", []):
        if (o.get("pip") or {}).get("shape") == "cut" and clip_for(job_dir, pr, o["start"], o["end"])[0].name == name:
            return True
    return False


def prepare(job_dir, project, report):
    """Inainte de randare: clipurile decupate pentru toate fundalurile cu forma „✂ Decupat”.
    Fara decupare instalata, fereastra devine „▯ Vertical” (ca video-ul sa iasa oricum)."""
    cuts = [o for o in project.get("overlays", []) if o.get("fit") == "bg" and (o.get("pip") or {}).get("shape") == "cut"]
    if not cuts:
        return project
    st = status()
    for o in cuts:
        if not st["ok"]:
            o["pip"] = {**o["pip"], "shape": "tall"}
            continue
        report({"type": "log", "msg": f"Te decupez din fundal ({o['end'] - o['start']:.1f} s, {st['label']})..."})
        try:
            o["cut_clip"] = make_clip(job_dir, project, o["start"], o["end"],
                                      report=lambda v: report({"type": "stage_detail", "n": 3, "detail": f"Decupez · {v:.0f}%"})).name
        except Exception as e:
            report({"type": "log", "msg": f"Decuparea n-a mers ({str(e)[:200]}); apari în fereastră verticală."})
            o["pip"] = {**o["pip"], "shape": "tall"}
    if not st["ok"]:
        report({"type": "log", "msg": "Atenție: " + st["hint"] + " Până atunci apari într-o fereastră verticală."})
    return project
