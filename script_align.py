# -*- coding: utf-8 -*-
"""
BioVitality Editor - potrivirea video-ului cu scriptul.

Ideea:
  1. Scriptul se imparte in fraze ("unitati").
  2. Pentru fiecare fraza caut in transcriere toate locurile unde ai spus-o ("dubluri").
  3. Aleg cate o dubla pe fraza, in ordinea scriptului, preferand ULTIMA dubla buna
     (reiei pana iese bine, deci ultima e cea pastrata).
  4. Ce nu apartine dublelor alese = reluari sau vorbe din afara scriptului -> se pot taia.
  5. Subtitrarile iau textul exact din script, cu timpii din transcriere.
"""

import re
import difflib
import unicodedata

MIN_SCORE = 0.55      # cat din fraza trebuie sa se regaseasca intr-o dubla
MIN_UNIT_WORDS = 4    # frazele mai scurte se lipesc de urmatoarea (potrivire mai sigura)


def norm(w):
    w = w.lower().replace("ş", "ș").replace("ţ", "ț")
    w = "".join(c for c in unicodedata.normalize("NFD", w) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^0-9a-z]", "", w)


def same(a, b):
    if not a or not b:
        return False
    if a == b:
        return True
    return min(len(a), len(b)) >= 4 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.8


def script_units(text):
    """Scriptul -> fraze, fiecare = lista de cuvinte asa cum sunt scrise (cu punctuatie)."""
    units = []
    for line in (text or "").replace("\r", "").split("\n"):
        line = re.sub(r"^\s*[-–—•*]+\s*", "", line).strip()
        if not line:
            continue
        for sent in re.split(r"(?<=[.!?…])\s+", line):
            words = [w for w in sent.split() if norm(w)]
            if words:
                units.append(words)
    merged = []
    for u in units:
        if merged and len(merged[-1]) < MIN_UNIT_WORDS:
            merged[-1] = merged[-1] + u
        else:
            merged.append(u)
    if len(merged) > 1 and len(merged[-1]) < MIN_UNIT_WORDS:
        merged[-2] = merged[-2] + merged.pop()
    return merged


def lcs_pairs(a, b):
    """Cea mai lunga potrivire in ordine intre doua liste de cuvinte normalizate -> perechi (i, j)."""
    n, m = len(a), len(b)
    L = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            L[i][j] = L[i + 1][j + 1] + 1 if same(a[i], b[j]) else max(L[i + 1][j], L[i][j + 1])
    out, i, j = [], 0, 0
    while i < n and j < m:
        if same(a[i], b[j]) and L[i][j] == L[i + 1][j + 1] + 1:
            out.append((i, j)); i += 1; j += 1
        elif L[i + 1][j] >= L[i][j + 1]:
            i += 1
        else:
            j += 1
    return out


def find_takes(unit_n, words_n):
    """Toate dublele unei fraze in transcriere (fara suprapuneri)."""
    L = len(unit_n)
    heads = unit_n[: min(3, L)]
    cands = []
    for i in range(len(words_n)):
        if not any(same(words_n[i], h) for h in heads):
            continue
        win = words_n[i: i + int(L * 1.5) + 3]
        pairs = lcs_pairs(unit_n, win)
        if not pairs:
            continue
        s, e = i + pairs[0][1], i + pairs[-1][1]
        spread = max(0, (e - s + 1) - L) / L                    # dubla "intinsa" peste alta dubla
        score = len(pairs) / L - 0.3 * spread
        if score >= MIN_SCORE:
            cands.append({"s": s, "e": e, "score": round(score, 3), "pairs": [(pu, i + pw) for pu, pw in pairs]})
    kept = []
    for c in sorted(cands, key=lambda c: (-c["score"], -c["s"])):
        if all(c["e"] < k["s"] or c["s"] > k["e"] for k in kept):
            kept.append(c)
    return sorted(kept, key=lambda c: c["s"])


def choose_takes(all_takes):
    """Cate o dubla pe fraza, in ordinea scriptului si in timp. Maximizez: 1) cate fraze acopar,
    2) cat de tarzii sunt dublele (ultima dubla castiga), 3) cat de bine se potrivesc."""
    items = [(k, c) for k, takes in enumerate(all_takes) for c in takes]
    items.sort(key=lambda x: (x[0], x[1]["s"]))
    best, prev = [], []
    for x, (k, c) in enumerate(items):
        val = 1e6 + c["s"] + c["score"]
        b, p = val, -1
        for y in range(x):
            ky, cy = items[y]
            if ky < k and cy["e"] < c["s"] and best[y] + val > b:
                b, p = best[y] + val, y
        best.append(b); prev.append(p)
    if not items:
        return {}
    x = max(range(len(items)), key=lambda i: best[i])
    chosen = {}
    while x >= 0:
        k, c = items[x]
        chosen[k] = c
        x = prev[x]
    return chosen


def align(script_text, words):
    """words = [(start, end, text), ...] din transcriere, in timpul sursei."""
    units = script_units(script_text)
    words_n = [norm(w[2]) for w in words]
    units_n = [[norm(w) for w in u] for u in units]
    all_takes = [find_takes(u, words_n) for u in units_n]
    chosen = choose_takes(all_takes)
    used = set()
    for c in chosen.values():
        used.update(range(c["s"], c["e"] + 1))
    in_retake = set()
    for k, takes in enumerate(all_takes):
        for c in takes:
            if chosen.get(k) is not c:
                in_retake.update(i for i in range(c["s"], c["e"] + 1) if i not in used)
    return {"units": units, "all_takes": all_takes, "chosen": chosen, "used": used, "retake": in_retake}


def take_intervals(al, words):
    return sorted((words[c["s"]][0], words[c["e"]][1]) for c in al["chosen"].values())


def span_intervals(idx, words, pad=0.05):
    """Indici de cuvinte -> intervale de timp lipite (pentru reluari / vorbe din afara scriptului)."""
    out = []
    for i in sorted(idx):
        a, b = words[i][0] - pad, words[i][1] + pad
        if out and a <= out[-1][1] + 0.35:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def intersect(segs, keep):
    out = []
    for a, b in segs:
        for c, d in keep:
            s, e = max(a, c), min(b, d)
            if e - s > 0.08:
                out.append([round(s, 3), round(e, 3)])
    return out


def subtract(segs, cut):
    out = []
    for a, b in segs:
        parts = [[a, b]]
        for c, d in cut:
            nxt = []
            for s, e in parts:
                if d <= s or c >= e:
                    nxt.append([s, e]); continue
                if c - s > 0.08: nxt.append([s, c])
                if e - d > 0.08: nxt.append([d, e])
            parts = nxt
        out += [[round(s, 3), round(e, 3)] for s, e in parts]
    return out


def script_words(al, words):
    """Cuvintele din script (cum le-ai scris) cu timpi luati din transcriere, pentru dublele alese.
    Cuvintele din script care n-au fost recunoscute primesc timpi impartiti intre vecini."""
    out = []
    for k, c in al["chosen"].items():
        unit = al["units"][k]
        t = [None] * len(unit)
        for pu, pw in c["pairs"]:
            t[pu] = (words[pw][0], words[pw][1])
        a0, b0 = words[c["s"]][0], words[c["e"]][1]
        i = 0
        while i < len(unit):
            if t[i] is not None:
                i += 1; continue
            j = i
            while j < len(unit) and t[j] is None:
                j += 1
            lo = t[i - 1][1] if i > 0 else a0
            hi = t[j][0] if j < len(unit) else b0
            if hi < lo:
                hi = lo
            step = (hi - lo) / (j - i)
            for q in range(i, j):
                t[q] = (lo + step * (q - i), lo + step * (q - i + 1))
            i = j
        out += [(t[q][0], t[q][1], unit[q]) for q in range(len(unit))]
    return sorted(out)
