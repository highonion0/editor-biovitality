import React, {useState} from 'react';
import {AbsoluteFill, Audio, Img, interpolate, OffthreadVideo, Sequence, Series, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {loadFont} from '@remotion/fonts';
import {Captions} from './Captions';
import {Graphic, TEMPLATES} from './Graphic';
import type {AudioItem, BgImg, FontDef, Keyframe, Overlay, Pip, Project, Zoom} from './types';

/* ---- miscarea: ACELEASI reguli ca in previzualizarea din editor (motion.js) ---- */
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// valoarea unui camp la momentul t (secunde de la inceputul elementului), intre keyframes
export const keyAt = (keys: Keyframe[] | undefined, field: keyof Keyframe, t: number, dflt: number): number => {
  const ks = (keys ?? []).filter((k) => k[field] != null);
  if (!ks.length) return dflt;
  if (t <= ks[0].t) return ks[0][field] as number;
  const last = ks[ks.length - 1];
  if (t >= last.t) return last[field] as number;
  for (let i = 0; i < ks.length - 1; i++) {
    if (t >= ks[i].t && t <= ks[i + 1].t) {
      const span = ks[i + 1].t - ks[i].t || 1;
      return (ks[i][field] as number) + ((ks[i + 1][field] as number) - (ks[i][field] as number)) * ease((t - ks[i].t) / span);
    }
  }
  return dflt;
};

// animatia de intrare / iesire -> deplasare, scara si opacitate suplimentare
export const animAt = (o: Overlay, t: number, dur: number) => {
  const d = Math.min(o.anim_dur ?? 0.35, dur / 2);
  const res = {dx: 0, dy: 0, k: 1, op: 1};
  const apply = (kind: string | undefined, p: number, out: boolean) => {
    if (!kind || kind === 'none') return;
    const e = ease(p), m = out ? 1 - e : 1 - e;   // p: 0 = inceputul animatiei
    if (kind === 'fade') res.op *= out ? 1 - e : e;
    else if (kind === 'pop') { res.k *= out ? 1 - 0.25 * e : 0.75 + 0.25 * e; res.op *= out ? 1 - e : e; }
    else {
      const dist = 0.18 * m;
      if (kind === 'slide_up') res.dy += dist; else if (kind === 'slide_down') res.dy -= dist;
      else if (kind === 'slide_left') res.dx += dist; else if (kind === 'slide_right') res.dx -= dist;
      res.op *= out ? 1 - e : e;
    }
  };
  if (d > 0 && o.anim_in && t < d) apply(o.anim_in, t / d, false);
  if (d > 0 && o.anim_out && t > dur - d) apply(o.anim_out, (t - (dur - d)) / d, true);
  return res;
};

// zoom pe video-ul principal la momentul t (secunde pe video-ul final)
export const zoomAt = (zooms: Zoom[] | undefined, t: number) => {
  for (const z of zooms ?? []) {
    if (t < z.start || t >= z.end) continue;
    const dur = z.end - z.start, p = (t - z.start) / dur;
    let k: number;
    if (z.style === 'punch') k = 1;
    else if (z.style === 'creep') k = p;
    else {const r = Math.min(0.25, dur / 3); k = Math.min(ease(Math.min(1, (t - z.start) / r)), ease(Math.min(1, (z.end - t) / r)));}
    const s = 1 + (z.scale - 1) * k;
    return {s, ox: (0.5 - z.x) * (s - 1) * 100, oy: (0.5 - z.y) * (s - 1) * 100};
  }
  return null;
};

// fereastra in care apari tu cand o poza / un clip e fundal (aceleasi formule ca core.pip_rect si timeline.js)
export const pipRect = (pip: Pip, W: number, H: number) => {
  const ar = pip.shape === 'circle' ? 1 : pip.shape === 'tall' ? H / W : 1.25;
  const h = Math.min(H, pip.w * W * ar), w = h / ar;
  const x = Math.min(Math.max(0, pip.x * W - w / 2), W - w), y = Math.min(Math.max(0, pip.y * H - h / 2), H - h);
  return {x, y, w, h, r: pip.shape === 'circle' ? Math.min(w, h) / 2 : Math.min(w, h) * 0.06};
};
// poza-fundal: intreaga (contain) sau umple ecranul (cover), cu marimea si pozitia ei (ca core.bg_rect)
export const bgRect = (b: BgImg, ar: number, W: number, H: number) => {
  const w = (b.fit === 'cover' ? Math.max(W, H / ar) : Math.min(W, H / ar)) * b.scale, h = w * ar;
  return {x: (W - w) / 2, y: b.y * H - h / 2, w, h};
};
// la momentul t: dreptunghiul tau (tot cadrul sau fereastra), cu intrare / iesire lina de 0,35 s
export const mainRect = (overlays: Overlay[], t: number, W: number, H: number) => {
  const o = overlays.find((x) => x.fit === 'bg' && x.pip && t >= x.start && t < x.end);
  if (!o || !o.pip) return null;
  const d = Math.min(0.35, (o.end - o.start) / 3);
  const k = ease(Math.min(1, (t - o.start) / d, (o.end - t) / d));
  const p = pipRect(o.pip, W, H), lerp = (a: number, b: number) => a + (b - a) * k;
  return {x: lerp(0, p.x), y: lerp(0, p.y), w: lerp(W, p.w), h: lerp(H, p.h), r: lerp(0, p.r)};
};

// fonturile aplicatiei: o singura data; loadFont opreste randarea pana sunt gata
const useFonts = (fonts: FontDef[]) => useState(() => {
  fonts.forEach((f) => f.files.forEach(([file, weight, fstyle]) =>
    loadFont({family: f.id, url: staticFile(`fonts/${file}`), weight: String(weight), style: fstyle}).catch(() => undefined)));
  return true;
});

const GraphicItem: React.FC<{o: Overlay; dur: number}> = ({o, dur}) => {
  const {width, fps} = useVideoConfig();
  const ar = TEMPLATES.find((t) => t.id === o.template)?.ar ?? 0.5;
  const t = useCurrentFrame() / fps, dsec = dur / fps;
  const a = animAt(o, t, dsec);
  const ox = keyAt(o.keys, 'x', t, o.x) + a.dx, oy = keyAt(o.keys, 'y', t, o.y) + a.dy;
  const wpx = keyAt(o.keys, 'w', t, o.w) * a.k * width;
  const orot = keyAt(o.keys, 'rotation', t, o.rotation ?? 0), oop = keyAt(o.keys, 'opacity', t, o.opacity ?? 1) * a.op;
  return (
    <div style={{position: 'absolute', left: `${ox * 100}%`, top: `${oy * 100}%`, width: wpx, height: wpx * ar,
      transform: `translate(-50%, -50%) rotate(${orot}deg)`, opacity: oop}}>
      <div style={{position: 'relative', width: 1000, height: 1000 * ar, transform: `scale(${wpx / 1000})`, transformOrigin: 'top left'}}>
        <Graphic template={o.template ?? ''} props={o.props ?? {}} dur={dur} />
      </div>
    </div>
  );
};

const OverlayItem: React.FC<{o: Overlay; dur: number}> = ({o, dur}) => {
  const {fps, width} = useVideoConfig();
  const t = useCurrentFrame() / fps, dsec = dur / fps;
  const a = animAt(o, t, dsec);
  const ox = keyAt(o.keys, 'x', t, o.x) + a.dx, oy = keyAt(o.keys, 'y', t, o.y) + a.dy;
  const ow = keyAt(o.keys, 'w', t, o.w) * a.k, orot = keyAt(o.keys, 'rotation', t, o.rotation ?? 0);
  const oop = keyAt(o.keys, 'opacity', t, o.opacity ?? 1) * a.op;
  const wpx = ow * width, hpx = wpx * (o.ar ?? 1);
  // cover = umple tot cadrul, decupat (B-roll pe tot ecranul)
  const br = o.fit === 'bg' && o.bgimg ? bgRect(o.bgimg, o.ar ?? 1, width, useVideoConfig().height) : null;
  const style: React.CSSProperties = br
    ? {position: 'absolute', left: br.x, top: br.y, width: br.w, height: br.h, objectFit: 'fill', opacity: oop}
    : o.fit === 'cover' || o.fit === 'bg'
    ? {position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: oop}
    : {
      position: 'absolute', left: `${ox * 100}%`, top: `${oy * 100}%`, width: wpx, height: hpx,
      transform: `translate(-50%, -50%) rotate(${orot}deg)`, opacity: oop,
      borderRadius: ((o.radius ?? 0) / 100) * Math.min(wpx, hpx), objectFit: 'fill',
    };
  return o.type === 'image'
    ? <Img src={o.src} style={style} />
    : <OffthreadVideo src={o.src} style={style} muted={o.muted ?? true}
        startFrom={Math.round((o.source_start ?? 0) * fps)} />;
};

const Track: React.FC<{a: AudioItem}> = ({a}) => {
  const {fps} = useVideoConfig();
  const dur = Math.max(1, Math.round((a.end - a.start) * fps));
  const fi = Math.min(a.fade_in * fps, dur / 2), fo = Math.min(a.fade_out * fps, dur / 2);
  return (
    <Audio src={a.src} startFrom={Math.round(a.source_start * fps)}
      volume={(f) => a.volume * Math.min(
        fi > 0 ? interpolate(f, [0, fi], [0, 1], {extrapolateRight: 'clamp'}) : 1,
        fo > 0 ? interpolate(f, [dur - fo, dur], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) : 1)} />
  );
};

/* Pista principala, cu zoom pe tot video-ul si tranzitii la taieturi.
   Tranzitia se face peste cadrele dinaintea taieturii, deci durata video-ului NU se schimba. */
const MainTrack: React.FC<{p: Project; windowed?: boolean}> = ({p, windowed}) => {
  const {fps} = p;
  const frame = useCurrentFrame();
  const t = frame / fps;
  const z = zoomAt(p.zooms, t);
  const starts: number[] = [];
  let acc = 0;
  for (const s of p.segments) {starts.push(acc); acc += s.to - s.from;}
  // tranzitia dintre bucata i si i+1
  let fx: React.CSSProperties = {}; let flash = 0;
  const trs = p.transitions ?? {};
  Object.keys(trs).forEach((k) => {
    const i = Number(k), tr = trs[k];
    if (i + 1 >= p.segments.length) return;
    const at = starts[i + 1], d = tr.dur;
    if (t < at - d || t > at + d) return;
    const half = t < at ? (at - t) / d : (t - at) / d;        // 1 -> 0 -> 1
    const e = 1 - ease(Math.min(1, half));                     // 0 la margini, 1 in punctul taieturii
    if (tr.kind === 'fade') fx = {...fx, opacity: 1 - e};
    else if (tr.kind === 'dissolve') fx = {...fx, opacity: 1 - 0.75 * e};
    else if (tr.kind === 'blur') fx = {...fx, filter: `${p.grade ? 'url(#bvgrade) ' : ''}blur(${(12 * e).toFixed(2)}px)`};
    else if (tr.kind === 'zoom') fx = {...fx, transform: `scale(${1 + 0.12 * e})`};
    else if (tr.kind === 'flash') flash = Math.max(flash, e);
  });
  const base: React.CSSProperties = p.grade && !fx.filter ? {filter: 'url(#bvgrade)'} : {};
  const inner: React.CSSProperties = z
    ? {transform: `scale(${z.s}) translate(${z.ox / z.s}%, ${z.oy / z.s}%)`, transformOrigin: 'center center', width: '100%', height: '100%'}
    : {width: '100%', height: '100%'};
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{...base, ...fx, overflow: 'hidden'}}>
        <div style={inner}>
          <Series>
            {p.segments.map((s, i) => {
              const a = Math.round(s.from * fps), b = Math.round(s.to * fps);
              return (
                <Series.Sequence key={i} durationInFrames={Math.max(1, b - a)}>
                  <OffthreadVideo src={p.source} startFrom={a} endAt={b} muted={!!p.main_audio}
                    style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: windowed ? '50% 30%' : '50% 50%'}} />
                  {p.main_audio ? <Audio src={p.main_audio} startFrom={a} endAt={b} /> : null}
                </Series.Sequence>
              );
            })}
          </Series>
        </div>
      </AbsoluteFill>
      {flash > 0 ? <AbsoluteFill style={{backgroundColor: '#FFFFFF', opacity: flash * 0.85}} /> : null}
    </AbsoluteFill>
  );
};

const MainWindow: React.FC<{p: Project}> = ({p}) => {
  const {width, height, fps} = useVideoConfig();
  const r = mainRect(p.overlays, useCurrentFrame() / fps, width, height);
  if (!r) return <MainTrack p={p} />;
  return (
    <div style={{position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: r.r, overflow: 'hidden',
      boxShadow: '0 12px 40px rgba(0,0,0,.45)'}}>
      <MainTrack p={p} windowed />
    </div>
  );
};

export const Main: React.FC<Project> = (p) => {
  const {fps} = p;
  useFonts(p.fonts);
  return (
    <AbsoluteFill style={{backgroundColor: 'black'}}>
      {/* look-ul: aceeasi matrice de culoare ca previzualizarea */}
      {p.grade ? (
        <svg width="0" height="0" style={{position: 'absolute'}}>
          <filter id="bvgrade" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={p.grade.join(' ')} /></filter>
        </svg>
      ) : null}
      {/* fundalurile („tu peste el”): sub pista principala */}
      {p.overlays.map((o, i) => {
        if (o.fit !== 'bg') return null;
        const from = Math.round(o.start * fps), dur = Math.max(1, Math.round(o.end * fps) - from);
        return <Sequence key={`b${i}`} from={from} durationInFrames={dur}>
          <AbsoluteFill style={{backgroundColor: o.bgimg?.color ?? '#000000'}} /><OverlayItem o={o} dur={dur} /></Sequence>;
      })}
      {/* pista principala: bucatile pastrate din video-ul sursa, cu zoom si tranzitii (intr-o fereastra peste un fundal) */}
      <MainWindow p={p} />
      {/* poze si video-uri suprapuse */}
      {p.overlays.map((o, i) => {
        if (o.fit === 'bg') return null;
        const from = Math.round(o.start * fps), dur = Math.max(1, Math.round(o.end * fps) - from);
        return <Sequence key={`o${i}`} from={from} durationInFrames={dur}>
          {o.type === 'graphic' ? <GraphicItem o={o} dur={dur} /> : <OverlayItem o={o} dur={dur} />}</Sequence>;
      })}
      {/* muzica / sunete de fundal */}
      {(p.audio ?? []).map((a, i) => {
        const from = Math.round(a.start * fps), dur = Math.max(1, Math.round(a.end * fps) - from);
        return <Sequence key={`a${i}`} from={from} durationInFrames={dur}><Track a={a} /></Sequence>;
      })}
      {p.captions ? <Captions style={p.captions.style} cues={p.captions.cues} fonts={p.fonts} /> : null}
    </AbsoluteFill>
  );
};
