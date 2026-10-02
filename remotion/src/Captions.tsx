import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CaptionStyle, Cue, FontDef, Word} from './types';

const hexA = (h: string, a: number) =>
  `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;

// Aceleasi reguli ca previzualizarea din editor -> ce vezi acolo iese identic aici.
const wordCss = (w: Word, st: CaptionStyle): React.CSSProperties => {
  const css: React.CSSProperties = {};
  if (w.color) css.color = w.color;
  const b = w.b ?? st.bold, it = w.i ?? st.italic;
  if (b !== st.bold) css.fontWeight = b ? 700 : 400;
  if (it !== st.italic) css.fontStyle = it ? 'italic' : 'normal';
  // sublinierea e pictata ca fundal: conturul textului (text-stroke) n-o mai acopera
  if (w.u) Object.assign(css, {
    backgroundImage: 'linear-gradient(currentColor, currentColor)', backgroundRepeat: 'no-repeat',
    backgroundSize: '100% .08em', backgroundPosition: '0 calc(100% - .12em)',
  });
  return css;
};

// animatia cuvant cu cuvant: ACELEASI reguli ca word_times() din core.py si capWordTimes() din editor
const wordTimes = (cue: Cue): [number, number][] => {
  const ws = cue.words, n = ws.length, out: [number, number][] = new Array(n);
  let i = 0;
  while (i < n) {
    const w = ws[i];
    if (w.s != null && w.e != null) { out[i] = [Math.max(cue.start, w.s), Math.min(cue.end, Math.max(w.s, w.e))]; i++; continue; }
    let j = i; while (j < n && (ws[j].s == null || ws[j].e == null)) j++;
    const a = i > 0 ? out[i - 1][1] : cue.start; let b = j < n ? (ws[j].s as number) : cue.end; if (b < a) b = a;
    const wts: number[] = []; for (let k = i; k < j; k++) wts.push(Math.max(1, ws[k].t.length));
    const tot = wts.reduce((x, y) => x + y, 0); let acc = a;
    for (let k = i; k < j; k++) { const d = ((b - a) * wts[k - i]) / tot; out[k] = [acc, acc + d]; acc += d; }
    i = j;
  }
  return out;
};
const ink = (h: string) => {
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? '#13211A' : '#FFFFFF';
};

export const Captions: React.FC<{style: CaptionStyle; cues: Cue[]; fonts: FontDef[]}> = ({style: st, cues, fonts}) => {
  const frame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  const t = frame / fps;
  const cue = cues.find((c) => !c.hidden && t >= c.start && t < c.end);
  if (!cue) return null;
  const f = fonts.find((x) => x.id === st.font) ?? {id: 'Arial', ratio: 1.117, files: []};
  const o = (st.outline / 100) * height;
  const box = st.mode === 'box';
  const pad = 0.18 * (st.size / 100) * height;
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute', left: `${st.pos_x * 100}%`, top: `${st.pos_y * 100}%`,
          transform: 'translate(-50%, -50%)', width: 'max-content', maxWidth: '84%', textAlign: 'center',
          overflowWrap: 'break-word', fontFamily: `'${f.id}', Arial, sans-serif`,
          fontSize: ((st.size / 100) * height) / f.ratio, lineHeight: f.ratio,
          fontWeight: st.bold ? 700 : 400, fontStyle: st.italic ? 'italic' : 'normal', color: st.color,
          textTransform: st.uppercase ? 'uppercase' : 'none',
          WebkitTextStroke: st.mode === 'outline' && o > 0 ? `${2 * o}px ${st.outline_color}` : '0px transparent',
          paintOrder: 'stroke fill',
        }}
      >
        <span
          style={box ? {
            background: hexA(st.box_color, st.box_opacity / 100), padding: pad,
            boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
          } : undefined}
        >
          {(() => {
            const anim = st.anim ?? 'none';
            if (anim === 'none') return cue.words.map((w, i) => (
              <React.Fragment key={i}>{i > 0 ? ' ' : null}<span style={wordCss(w, st)}>{w.t}</span></React.Fragment>
            ));
            const times = wordTimes(cue);
            let k = 0; for (let i = 0; i < times.length; i++) if (t >= times[i][0] - 1e-3) k = i;
            const ac = st.anim_color ?? '#E8A83B', ease = Math.min(1, Math.max(0, t - times[k][0]) / 0.08);
            const one = (w: Word, i: number) => {
              const css: React.CSSProperties = {...wordCss(w, st)};
              if (i === k) {
                if (anim === 'highlight' || anim === 'pop') css.color = ac;
                if (anim === 'pop') Object.assign(css, {display: 'inline-block', transform: `scale(${1 + 0.12 * ease})`});
                if (anim === 'pill') Object.assign(css, {background: ac, color: ink(ac), borderRadius: '.22em', padding: '0 .14em',
                  margin: '0 -.14em', WebkitTextStroke: '0 transparent'});
                if (anim === 'reveal') css.opacity = ease;
              } else if (anim === 'reveal' && i > k) css.opacity = 0;
              return <span style={css}>{w.t}</span>;
            };
            if (anim === 'single') return one(cue.words[k], k);
            return cue.words.map((w, i) => <React.Fragment key={i}>{i > 0 ? ' ' : null}{one(w, i)}</React.Fragment>);
          })()}
        </span>
      </div>
    </AbsoluteFill>
  );
};
